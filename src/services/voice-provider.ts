/**
 * Abstract interface for Text‑to‑Speech providers.
 * Implementations must be interchangeable – the rest of the system only calls these methods.
 */
export interface VoiceProvider {
  /** Speak the given text out loud */
  speak(text: string): Promise<void>;
  /** Stop any ongoing speech */
  stop(): Promise<void>;
  /** Pause the current speech (if supported) */
  pause?(): Promise<void>;
  /** Resume paused speech (if supported) */
  resume?(): Promise<void>;
  /** Change voice (e.g., different speaker ID) */
  setVoice?(voiceId: string): Promise<void>;
}
