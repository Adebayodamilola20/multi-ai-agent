import { execFile, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { createReadStream, unlinkSync } from 'fs';
import OpenAI from 'openai';
import { config } from '../config';
import { createAgentLogger } from '../logger/logger';

const execFileAsync = promisify(execFile);

const logger = createAgentLogger('voice-service');

const AUDIO_PATH = '/tmp/jarvis_input.wav';
const TTS_SPEAKER = process.env.JARVIS_VOICE || 'Carter';

let currentPlayProcess: ChildProcess | null = null;

export class VoiceService {
  // groq client retained for audio transcription — local LLM models don't support whisper/audio
  private openai: OpenAI | null = null;

  private get client(): OpenAI {
    if (!this.openai) {
      this.openai = new OpenAI({ apiKey: config.groq.apiKey, baseURL: config.groq.baseUrl });
    }
    return this.openai;
  }

  async speak(text: string): Promise<void> {
    this.stopSpeaking();

    try {
      // Generate audio via VibeVoice
      const { stdout } = await execFileAsync('python3', [
        'scripts/tts_vibevoice.py',
        '--text', text,
        '--speaker', TTS_SPEAKER
      ]);
      const wavPath = stdout.trim();

      // Play the generated WAV
      await new Promise<void>((resolve, reject) => {
        currentPlayProcess = execFile('afplay', [wavPath]);
        currentPlayProcess!.on('exit', () => {
          currentPlayProcess = null;
          // Cleanup temp file
          try { unlinkSync(wavPath); } catch { /* ignore */ }
          resolve();
        });
        currentPlayProcess!.on('error', (err) => {
          currentPlayProcess = null;
          try { unlinkSync(wavPath); } catch { /* ignore */ }
          reject(err);
        });
      });
    } catch (error) {
      logger.warn('TTS failed (VibeVoice). Falling back to macOS say.', { error: (error as Error).message });
      try {
        await execFileAsync('say', ['-v', 'Daniel', text]);
      } catch { /* silent fallback */ }
    }
  }

  stopSpeaking(): void {
    if (currentPlayProcess) {
      currentPlayProcess.kill('SIGTERM');
      currentPlayProcess = null;
    }
  }

  async listen(maxSeconds = 7): Promise<string | null> {
    try {
      await execFileAsync('rec', [
        '-r', '16000', '-c', '1', '-b', '16',
        AUDIO_PATH,
        'trim', '0', String(maxSeconds)
      ], { timeout: (maxSeconds + 2) * 1000 });

      const text = await this.transcribe(AUDIO_PATH);
      try { unlinkSync(AUDIO_PATH); } catch { /* ignore */ }
      return text;
    } catch (error) {
      const msg = (error as Error).message;
      if (!msg.includes('timed out')) {
        logger.error('Failed to capture audio', { error: msg });
      }
      return null;
    }
  }

  async listenShort(maxSeconds = 2): Promise<string | null> {
    try {
      await execFileAsync('rec', [
        '-r', '16000', '-c', '1', '-b', '16',
        AUDIO_PATH,
        'trim', '0', String(maxSeconds)
      ], { timeout: (maxSeconds + 2) * 1000 });

      const text = await this.transcribe(AUDIO_PATH);
      try { unlinkSync(AUDIO_PATH); } catch { /* ignore */ }
      return text;
    } catch {
      return null;
    }
  }

  private async transcribe(audioPath: string): Promise<string> {
    try {
      const response = await this.client.audio.transcriptions.create({
        model: 'whisper-large-v3',
        file: createReadStream(audioPath),
        language: 'en'
      });
      return (response.text || '').trim().toLowerCase();
    } catch (error) {
      logger.error('Transcription failed', { error: (error as Error).message });
      return '';
    }
  }

  async waitForWakeWord(wakeWord = 'tom'): Promise<void> {
    while (true) {
      const text = await this.listenShort(2);
      if (text && text.includes(wakeWord)) {
        return;
      }
    }
  }
}

export const voiceService = new VoiceService();
