/**
 * VoiceManager – a thin façade that allows the rest of the app to change the
 * active TTS provider (or speech‑to‑text provider) at runtime without touching
 * the higher‑level logic.
 *
 * The manager holds a reference to the singleton `voiceService` (which already
 * delegates to the concrete providers) and forwards configuration changes.
 */
import { VoiceProvider } from './voice-provider';
import { voiceService } from './voice.service';

export class VoiceManager {
  /** Swap the underlying TTS provider – useful for user‑driven changes */
  setTtsProvider(provider: VoiceProvider): void {
    // @ts-ignore – we replace the private variable in the service instance.
    (voiceService as any).ttsProvider = provider;
  }

  /** Convenience helpers for the built‑in providers */
  useNvidia(): void { this.setTtsProvider(new (require('./tts-providers')).NvidiaTtsProvider()); }
  usePiper(): void { this.setTtsProvider(new (require('./tts-providers')).PiperTtsProvider()); }
  useElevenLabs(): void { this.setTtsProvider(new (require('./tts-providers')).ElevenLabsTtsProvider()); }
  useOpenAi(): void { this.setTtsProvider(new (require('./tts-providers')).OpenAiVoiceProvider()); }
  useMacOs(): void { this.setTtsProvider(new (require('./tts-providers')).MacOsSayProvider()); }
}

export const voiceManager = new VoiceManager();
