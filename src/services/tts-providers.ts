import { execFile, ChildProcess } from 'child_process';
import { promisify } from 'util';
import OpenAI from 'openai';
import { config } from '../config';
import { createAgentLogger } from '../logger/logger';
import { VoiceProvider } from './voice-provider';

const execFileAsync = promisify(execFile);

/** NVIDIA TTS – uses the same OpenAI‑compatible endpoint as the LLM */
export class NvidiaTtsProvider implements VoiceProvider {
  private logger = createAgentLogger('nvidia-tts');
  private client: OpenAI;
  private playProcess: ChildProcess | null = null;
  constructor() {
    this.client = new OpenAI({
      baseURL: 'https://integrate.api.nvidia.com/v1',
      apiKey: config.nvidia.apiKey
    });
    const ttsModel = process.env.NVIDIA_TTS_MODEL || 'chatterbox-multilingual-tts';
    this.logger.info('NVIDIA TTS initialized', { model: ttsModel });
  }
  async speak(text: string): Promise<void> {
    const ttsModel = process.env.NVIDIA_TTS_MODEL || 'chatterbox-multilingual-tts';
    const baseUrl = process.env.NVIDIA_TTS_BASE_URL;
    if (!baseUrl) {
      this.logger.error('NVIDIA TTS endpoint not configured');
      throw new Error('NVIDIA TTS endpoint not configured');
    }
    const url = `${baseUrl}`;
    this.logger.info('NVIDIA TTS request started', { url, model: ttsModel });
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.nvidia.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({ model: ttsModel, input: text })
      });
      this.logger.info('NVIDIA TTS response received', { status: resp.status });
      if (!resp.ok) {
        const errText = await resp.text();
        this.logger.error('NVIDIA TTS request failed', { status: resp.status, body: errText });
        throw new Error(`NVIDIA TTS failed: ${resp.status}`);
      }
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('audio')) {
        const errText = await resp.text();
        this.logger.error('Unexpected content type from NVIDIA TTS', { contentType, body: errText });
        throw new Error('NVIDIA TTS returned non-audio content');
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      const tmp = `/tmp/jarvis_nvidia_${Date.now()}.mp3`;
      require('fs').writeFileSync(tmp, buf);
      this.logger.info('NVIDIA TTS audio saved', { path: tmp });
      this.playProcess = execFile('afplay', [tmp]);
      await new Promise<void>((resolve, reject) => {
        this.playProcess!.on('exit', () => { require('fs').unlinkSync(tmp); resolve(); });
        this.playProcess!.on('error', reject);
      });
    } catch (e) {
      this.logger.error('NVIDIA TTS failed', { error: (e as Error).message });
      // fallback to macOS say if NVIDIA fails
      await execFileAsync('say', ['-v', 'Daniel', text]);
    }
  }
  async stop(): Promise<void> {
    if (this.playProcess) { this.playProcess.kill('SIGTERM'); this.playProcess = null; }
  }
}

/** Piper TTS – calls the local `tts_vibevoice.py` script with a specific speaker */
export class PiperTtsProvider implements VoiceProvider {
  private speaker = 'male'; // default male English voice if available
  async speak(text: string): Promise<void> {
    try {
      const { stdout } = await execFileAsync('python3', [
        'scripts/tts_vibevoice.py', '--text', text, '--speaker', this.speaker
      ]);
      const wav = stdout.trim();
      const dest = '/tmp/jarvis_piper.wav';
      // Copy generated wav to a stable path for playback
      const fs = require('fs');
      fs.copyFileSync(wav, dest);
      await execFileAsync('afplay', [dest]);
    } catch (e) {
      // Fallback to macOS say if Piper fails
      await execFileAsync('say', ['-v', 'Daniel', text]);
    }
  }
  async stop(): Promise<void> {
    await execFileAsync('pkill', ['afplay']).catch(() => {});
  }
  async setVoice(voiceId: string): Promise<void> { this.speaker = voiceId; }
}

/** ElevenLabs TTS – simple wrapper around their REST API */
export class ElevenLabsTtsProvider implements VoiceProvider {
  private apiKey: string;
  private voiceId: string;
  private logger = createAgentLogger('elevenlabs-tts');
  constructor() {
    this.apiKey = process.env.ELEVENLABS_API_KEY || '';
    this.voiceId = process.env.ELEVENLABS_VOICE_ID || '';
    const configured = this.apiKey && this.voiceId;
    this.logger.info('ElevenLabs configured', { configured });
    if (configured) {
      this.logger.info('ElevenLabs API key loaded: true');
      this.logger.info('Voice ID loaded: true');
    }
  }
  async speak(text: string): Promise<void> {
    if (!this.apiKey) {
      this.logger.error('ElevenLabs API key missing');
      throw new Error('ElevenLabs API key missing');
    }
    if (!this.voiceId) {
      this.logger.error('ElevenLabs voice ID missing');
      throw new Error('ElevenLabs voice ID missing');
    }
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' })
    });
    this.logger.info('ElevenLabs response', { status: res.status, contentType: res.headers.get('content-type') });
    if (!res.ok) {
      const errText = await res.text();
      this.logger.error('ElevenLabs TTS error', { status: res.status, body: errText });
      throw new Error(`ElevenLabs TTS failed: ${res.status}`);
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('audio')) {
      const errText = await res.text();
      this.logger.error('Unexpected content type from ElevenLabs', { contentType, body: errText });
      throw new Error('ElevenLabs returned non-audio content');
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const tmp = `/tmp/jarvis_eleven_${Date.now()}.mp3`;
    require('fs').writeFileSync(tmp, buf);
    await execFileAsync('afplay', [tmp]);
    require('fs').unlinkSync(tmp);
  }

  async stop(): Promise<void> { await execFileAsync('pkill', ['afplay']).catch(() => {}); }
  async setVoice(voiceId: string): Promise<void> { this.voiceId = voiceId; }
}

/** OpenAI TTS – uses the OpenAI endpoint (default tts-1) */
export class OpenAiVoiceProvider implements VoiceProvider {
  private client: OpenAI;
  private playProcess: ChildProcess | null = null;
  constructor() {
    this.client = new OpenAI({ apiKey: config.openai.apiKey });
  }
  async speak(text: string): Promise<void> {
    const resp = await this.client.audio.speech.create({ model: 'tts-1', voice: 'alloy', input: text });
    const tmp = `/tmp/jarvis_openai_${Date.now()}.mp3`;
    const fs = require('fs');
    const out = fs.createWriteStream(tmp);
    resp.body.pipe(out);
    await new Promise((res, rej) => { out.on('finish', res); out.on('error', rej); });
    this.playProcess = execFile('afplay', [tmp]);
    await new Promise<void>((resolve, reject) => {
      this.playProcess!.on('exit', () => { fs.unlinkSync(tmp); resolve(); });
      this.playProcess!.on('error', reject);
    });
  }
  async stop(): Promise<void> { if (this.playProcess) { this.playProcess.kill('SIGTERM'); this.playProcess = null; } }
}

/** macOS `say` – always available fallback */
export class MacOsSayProvider implements VoiceProvider {
  private proc: ChildProcess | null = null;
  async speak(text: string): Promise<void> {
    this.proc = execFile('say', ['-v', 'Daniel', text]);
    await new Promise<void>((resolve, reject) => {
      this.proc!.on('exit', () => { this.proc = null; resolve(); });
      this.proc!.on('error', reject);
    });
  }
  async stop(): Promise<void> { if (this.proc) { this.proc.kill('SIGTERM'); this.proc = null; } }
}
