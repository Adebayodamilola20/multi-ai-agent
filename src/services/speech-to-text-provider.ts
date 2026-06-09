/**
 * Interface for Speech‑to‑Text providers.
 */
export interface SpeechToTextProvider {
  /** Transcribe the audio file at `audioPath` and return the detected text */
  transcribe(audioPath: string): Promise<string>;
}

import { config } from '../config';
import { createAgentLogger } from '../logger/logger';
import { spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import OpenAI from 'openai';
import { createReadStream } from 'fs';

const logger = createAgentLogger('stt-service');

/** Faster‑Whisper local transcription provider */
export class FasterWhisperProvider implements SpeechToTextProvider {
  private static modelLoaded = false;

  async transcribe(audioPath: string): Promise<string> {
    logger.info('Attempting STT with Faster‑Whisper via Python', { audioPath });
    const scriptPath = path.join(process.cwd(), 'scripts', 'transcribe_faster_whisper.py');
    const pythonBin = process.env.PYTHON_BIN || 'python3';
    const timeoutMs = FasterWhisperProvider.modelLoaded ? 30000 : 300000; // extend to 5 min for first‑run model download

    return new Promise<string>((resolve, reject) => {
      const proc = spawn(pythonBin, [scriptPath, audioPath]);
      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        logger.error('Faster‑Whisper STT timed out after 120s');
        // fallback to OpenAI Whisper if possible
        if (config.openai.apiKey) {
          logger.warn('Falling back to OpenAI Whisper STT after timeout');
          const client = new OpenAI({ apiKey: config.openai.apiKey });
          client.audio.transcriptions.create({
            model: config.openai.model,
            file: createReadStream(audioPath),
            language: 'en'
          }).then(r => {
            resolve(r.text?.trim() ?? '');
          }).catch(err => {
            reject(err);
          });
          return;
        }
        reject(new Error('Faster‑Whisper STT timed out'));
      }, timeoutMs);

      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        logger.info('Faster‑Whisper stdout', { chunk: chunk.trim() });
        stdout += chunk;
      });

      proc.stderr.on('data', (data) => {
        const chunk = data.toString();
        logger.warn('Faster‑Whisper stderr', { chunk: chunk.trim() });
        stderr += chunk;
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          FasterWhisperProvider.modelLoaded = true;
          const transcript = stdout.trim();
          logger.info('Faster‑Whisper transcription result', { transcript });
          resolve(transcript);
        } else {
          const errMsg = `Faster‑Whisper exited with code ${code}`;
          logger.error(errMsg, { stderr });
          reject(new Error(errMsg));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        logger.error('Faster‑Whisper process error', { error: err.message });
        reject(err);
      });
    });
  }
}
