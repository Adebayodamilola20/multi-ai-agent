import { execFile, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { createReadStream, unlinkSync } from 'fs';
import { config } from '../config';
import { createAgentLogger } from '../logger/logger';
import { VoiceProvider } from './voice-provider';
import { MacOsSayProvider, NvidiaTtsProvider, PiperTtsProvider, ElevenLabsTtsProvider, OpenAiVoiceProvider } from './tts-providers';
import { SpeechToTextProvider, FasterWhisperProvider } from './speech-to-text-provider';

// No‑op STT provider for text‑only mode
class NoOpSttProvider implements SpeechToTextProvider {
  async transcribe(_audioPath: string): Promise<string> {
    // No transcription needed when using text input mode
    return '';
  }
}
const logger = createAgentLogger('voice-service');

const execFileAsync = promisify(execFile);

// -------------------------------------------------------
// Configuration – choose providers via env vars (fallbacks provided)
// -------------------------------------------------------
const AUDIO_PATH = '/tmp/jarvis_input.wav';

// TTS provider selection (default: macOS Say)
let ttsProvider: VoiceProvider;
switch (config.ttsProvider) {
  case 'nvidia':
    ttsProvider = new NvidiaTtsProvider();
    break;
  case 'piper':
    ttsProvider = new PiperTtsProvider();
    break;
  case 'elevenlabs':
    ttsProvider = new ElevenLabsTtsProvider();
    break;
  case 'openai':
    ttsProvider = new OpenAiVoiceProvider();
    break;
  case 'macos':
  default:
    ttsProvider = new MacOsSayProvider();
}

// Speech‑to‑Text provider (default: Faster‑Whisper)
let sttProvider: SpeechToTextProvider;
switch (config.sttProvider) {
  case 'parakeet':
    logger.warn('NVIDIA Parakeet API endpoint not configured. Use Faster-Whisper or provide official endpoint.');
    // fallthrough to faster-whisper as fallback
  case 'faster-whisper':
    sttProvider = new FasterWhisperProvider();
    break;
  case 'text':
    sttProvider = new NoOpSttProvider();
    break;
  default:
    sttProvider = new FasterWhisperProvider();
    break;
}



export class VoiceService {
  private audioAvailable = false;
  private audioCheckPerformed = false;

  // -----------------------------------------------------------------
  // Text‑to‑Speech
  // -----------------------------------------------------------------
  async speak(text: string): Promise<void> {
    try {
      await ttsProvider.speak(text);
    } catch (e) {
      logger.warn('Primary TTS provider failed, falling back to macOS say', { error: (e as Error).message });
      // fallback – ensure we always have a voice
      const fallback = new MacOsSayProvider();
      await fallback.speak(text);
    }
  }

  async stopSpeaking(): Promise<void> {
    await ttsProvider.stop();
  }

  // -----------------------------------------------------------------
  // Speech‑to‑Text (record → transcribe)
  // -----------------------------------------------------------------
   private async recordAudio(maxSeconds: number): Promise<string | null> {
     try {
       // Try SoX `rec` first; if unavailable fall back to ffmpeg
       try {
         await execFileAsync('rec', [
           '-r', '16000', '-c', '1', '-b', '16',
           AUDIO_PATH,
           'trim', '0', String(maxSeconds)
         ], { timeout: (maxSeconds + 2) * 1000 });
       } catch (recErr) {
         const recMsg = (recErr as Error).message;
         logger.warn('rec failed, falling back to ffmpeg', { error: recMsg });
         // ffmpeg command for macOS capture via avfoundation
         const ffmpegCmd = `ffmpeg -y -f avfoundation -i ":0" -t ${maxSeconds} -ar 16000 -ac 1 -ab 16k ${AUDIO_PATH}`;
         await execFileAsync('bash', ['-c', ffmpegCmd], { timeout: (maxSeconds + 5) * 1000 });
       }

       const text = await sttProvider.transcribe(AUDIO_PATH);
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

  async listen(maxSeconds = 7): Promise<string | null> {
    return this.recordAudio(maxSeconds);
  }

  async listenShort(maxSeconds = 2): Promise<string | null> {
    return this.recordAudio(maxSeconds);
  }

  // ---------------------------------------------------------------
  // Wake‑word detection – simple polling loop using short recordings
  // ---------------------------------------------------------------
  async waitForWakeWord(wakeWord = 'jarvis'): Promise<void> {
    while (true) {
      const text = await this.listenShort(2);
      if (text && text.toLowerCase().includes(wakeWord.toLowerCase())) {
        return;
      }
    }
  }
}

export const voiceService = new VoiceService();
