import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import { createAgentLogger } from '../logger/logger';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const logger = createAgentLogger('os-service');

export type AppName =
  | 'safari'
  | 'chrome'
  | 'finder'
  | 'terminal'
  | 'vscode'
  | 'discord'
  | 'spotify'
  | 'mail'
  | 'notes'
  | 'calendar'
  | 'messages'
  | 'photos'
  | 'systemsettings';

const APP_MAP: Record<AppName, string> = {
  safari: 'Safari',
  chrome: 'Google Chrome',
  finder: 'Finder',
  terminal: 'Terminal',
  vscode: 'Visual Studio Code',
  discord: 'Discord',
  spotify: 'Spotify',
  mail: 'Mail',
  notes: 'Notes',
  calendar: 'Calendar',
  messages: 'Messages',
  photos: 'Photos',
  systemsettings: 'System Settings'
};

export class OSService {
  async openApp(name: string): Promise<string> {
    const app = APP_MAP[name.toLowerCase() as AppName] || name;
    await execFileAsync('open', ['-a', app]);
    logger.info('Opened app', { app });
    return `Opened ${app}`;
  }

  async openUrl(url: string): Promise<string> {
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    await execFileAsync('open', [fullUrl]);
    logger.info('Opened URL', { url: fullUrl });
    return `Opened ${fullUrl}`;
  }

  async openFile(path: string): Promise<string> {
    await execFileAsync('open', [path]);
    logger.info('Opened file', { path });
    return `Opened ${path}`;
  }

  async runCommand(command: string): Promise<string> {
    const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
    const output = stdout || stderr || 'Command executed with no output.';
    logger.info('Ran command', { command, output: output.slice(0, 200) });
    return output;
  }

  async searchFiles(query: string, location = '~'): Promise<string> {
    const { stdout } = await execFileAsync('mdfind', ['-name', query, '-limit', '20']);
    const results = stdout.trim() || 'No files found.';
    logger.info('Searched files', { query, count: results.split('\n').length });
    return results;
  }

  async readFile(path: string): Promise<string> {
    const { stdout } = await execFileAsync('cat', [path]);
    return stdout;
  }

  async writeFile(path: string, content: string): Promise<string> {
    await execAsync(`cat > "${path}" << 'OPECONTENT'\n${content}\nOPECONTENT`);
    logger.info('Wrote file', { path });
    return `Written to ${path}`;
  }

  async getClipboard(): Promise<string> {
    const { stdout } = await execFileAsync('pbpaste');
    return stdout.trim();
  }

  async setClipboard(text: string): Promise<string> {
    const proc = execFile('pbcopy');
    proc.stdin?.write(text);
    proc.stdin?.end();
    await new Promise<void>((resolve, reject) => {
      proc.on('exit', () => resolve());
      proc.on('error', reject);
    });
    return 'Copied to clipboard.';
  }

  async takeScreenshot(): Promise<string> {
    const path = `/tmp/screenshot_${Date.now()}.png`;
    await execFileAsync('screencapture', ['-i', path]);
    logger.info('Screenshot taken', { path });
    return path;
  }

  async typeText(text: string): Promise<string> {
    const escaped = text.replace(/"/g, '\\"');
    await execAsync(`osascript -e 'tell application "System Events" to keystroke "${escaped}"'`);
    return `Typed: ${text}`;
  }

  async pressKey(key: string): Promise<string> {
    await execAsync(`osascript -e 'tell application "System Events" to key code ${this.keyCode(key)}'`);
    return `Pressed ${key}`;
  }

  async getSystemInfo(): Promise<string> {
    const info: string[] = [];
    const [{ stdout: hostname }, { stdout: osVersion }, { stdout: uptime }] = await Promise.all([
      execFileAsync('hostname'),
      execFileAsync('sw_vers', ['-productVersion']),
      execAsync('uptime')
    ]);
    info.push(`Hostname: ${hostname.trim()}`);
    info.push(`macOS: ${osVersion.trim()}`);
    info.push(`Uptime: ${uptime.trim()}`);
    return info.join('\n');
  }

  async openLocation(query: string): Promise<string> {
    const encoded = encodeURIComponent(query);
    await execFileAsync('open', [`https://maps.apple.com/?q=${encoded}`]);
    return `Opened maps for ${query}`;
  }

  async searchWeb(query: string): Promise<string> {
    const encoded = encodeURIComponent(query);
    await execFileAsync('open', [`https://www.google.com/search?q=${encoded}`]);
    return `Searched web for ${query}`;
  }

  private keyCode(key: string): string {
    const codes: Record<string, string> = {
      enter: '36', tab: '48', space: '49', delete: '51',
      escape: '53', 'left': '123', 'right': '124', 'down': '125', 'up': '126',
      cmd: '55', shift: '56', alt: '58', ctrl: '59'
    };
    return codes[key.toLowerCase()] || key;
  }
}

export const osService = new OSService();
