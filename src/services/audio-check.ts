import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../logger/logger';

const execFileAsync = promisify(execFile);

/**
 * Verify that audio capture tools are installed (sox's `rec` and ffmpeg).
 * Returns true if at least one of them is available.
 * Logs a single warning the first time they are missing.
 */
export async function ensureAudioTools(): Promise<boolean> {
  try {
    await execFileAsync('which', ['rec']);
  } catch {
    // rec missing
    try {
      await execFileAsync('which', ['ffmpeg']);
    } catch {
      logger.warn('Audio capture tools missing. Install with: brew install sox ffmpeg');
      return false;
    }
  }
  return true;
}
