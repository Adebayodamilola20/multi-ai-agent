import { createAgentLogger } from '../logger/logger';
import { osService } from '../services/os.service';
import { voiceService } from '../services/voice.service';
import { discordService } from '../services/discord.service';
import fs from 'fs';
import path from 'path';

/**
 * DesktopAgent – safe wrapper around OS actions usable via voice or Discord.
 * All actions are non‑destructive; destructive actions should call `confirmAction`
 * before proceeding (currently a stub that auto‑approves). Future work can hook
 * into Discord reactions or a UI to obtain explicit user consent.
 */
export class DesktopAgent {
  private logger = createAgentLogger('desktop-agent');

  private async confirmAction(message: string): Promise<boolean> {
    // Simple stub: log and auto‑approve. Replace with real user confirmation later.
    this.logger.info('Confirmation requested', { message });
    await discordService.post(`❓ Confirmation needed: ${message}\n(Automatically approved for now)`, 'Jarvis');
    return true;
  }

  // ---------- Application launch ----------
  async openSafari(): Promise<void> {
    if (await this.confirmAction('Open Safari')) {
      await osService.openApp('safari');
      await voiceService.speak('Safari opened');
    }
  }

  async openFinder(): Promise<void> {
    if (await this.confirmAction('Open Finder')) {
      await osService.openApp('finder');
      await voiceService.speak('Finder opened');
    }
  }

  async openVSCode(): Promise<void> {
    if (await this.confirmAction('Open Visual Studio Code')) {
      await osService.openApp('vscode');
      await voiceService.speak('Visual Studio Code opened');
    }
  }

  async openTerminal(): Promise<void> {
    if (await this.confirmAction('Open Terminal')) {
      await osService.openApp('terminal');
      await voiceService.speak('Terminal opened');
    }
  }

  // ---------- Search & URL ----------
  async searchYouTube(query: string): Promise<void> {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    if (await this.confirmAction(`Search YouTube for "${query}"`)) {
      await osService.openUrl(url);
      await voiceService.speak(`Here are YouTube results for ${query}`);
    }
  }

  async searchGoogle(query: string): Promise<void> {
    if (await this.confirmAction(`Search Google for "${query}"`)) {
      await osService.searchWeb(query);
      await voiceService.speak(`Google search for ${query} opened`);
    }
  }

  async openUrl(url: string): Promise<void> {
    if (await this.confirmAction(`Open URL ${url}`)) {
      await osService.openUrl(url);
      await voiceService.speak(`Opened ${url}`);
    }
  }

  // ---------- Folder inspection ----------
  async readFolder(folderPath: string): Promise<void> {
    const absPath = path.resolve(folderPath);
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
      await voiceService.speak('Folder does not exist or is not a directory');
      return;
    }
    const entries = fs.readdirSync(absPath);
    const summary = entries.length
      ? `Folder contains ${entries.length} item${entries.length > 1 ? 's' : ''}: ${entries.slice(0, 10).join(', ')}`
      : 'Folder is empty';
    await voiceService.speak(summary);
  }
}

export const desktopAgent = new DesktopAgent();
