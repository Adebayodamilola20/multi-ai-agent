import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createAgentLogger } from '../logger/logger';
import { osService } from '../services/os.service';
import { brainService, ChatMessage } from './brain.service';

const execFileAsync = promisify(execFile);
const logger = createAgentLogger('router');

export interface RouteResult {
  /** Short line Jarvis says/prints. */
  reply: string;
  /** Which agent/intent handled it — for logging. */
  intent: string;
  /** Optional detail produced by a local tool (folder listing, clipboard, etc). */
  detail?: string;
}

/** Apps we can launch by a spoken alias → osService app key. */
const APP_ALIASES: Record<string, string> = {
  'vs code': 'vscode',
  'vscode': 'vscode',
  'visual studio code': 'vscode',
  'code': 'vscode',
  'safari': 'safari',
  'chrome': 'chrome',
  'google chrome': 'chrome',
  'finder': 'finder',
  'terminal': 'terminal',
  'discord': 'discord',
  'spotify': 'spotify',
  'mail': 'mail',
  'notes': 'notes',
  'calendar': 'calendar',
  'messages': 'messages',
  'photos': 'photos',
  'settings': 'systemsettings',
  'system settings': 'systemsettings'
};

/** Common folders by spoken name → absolute path. */
const FOLDERS: Record<string, string> = {
  desktop: path.join(os.homedir(), 'Desktop'),
  downloads: path.join(os.homedir(), 'Downloads'),
  documents: path.join(os.homedir(), 'Documents'),
  home: os.homedir()
};

/** Known sites. `app` (if set) is a macOS app we try to open before the website. */
interface Site { name: string; url: string; app?: string }
const SITES: Record<string, Site> = {
  youtube: { name: 'YouTube', url: 'https://www.youtube.com' },
  github: { name: 'GitHub', url: 'https://github.com' },
  google: { name: 'Google', url: 'https://www.google.com' },
  gmail: { name: 'Gmail', url: 'https://mail.google.com' },
  twitter: { name: 'Twitter', url: 'https://twitter.com' },
  x: { name: 'X', url: 'https://x.com' },
  reddit: { name: 'Reddit', url: 'https://www.reddit.com' },
  whatsapp: { name: 'WhatsApp', url: 'https://web.whatsapp.com', app: 'WhatsApp' },
  netflix: { name: 'Netflix', url: 'https://www.netflix.com' },
  chatgpt: { name: 'ChatGPT', url: 'https://chat.openai.com', app: 'ChatGPT' },
  instagram: { name: 'Instagram', url: 'https://www.instagram.com' },
  linkedin: { name: 'LinkedIn', url: 'https://www.linkedin.com' },
  spotify: { name: 'Spotify', url: 'https://open.spotify.com', app: 'Spotify' }
};

/** Verbs that signal the user wants something done (vs. a plain question). */
const ACTION_VERB = /\b(open|launch|start|run|go to|bring up|search|find|play|watch|look ?up|show|list|read)\b/;

export class CommandRouter {
  /**
   * Route a single utterance.
   *
   * 1. Fast path: clear desktop commands matched by rules and executed
   *    locally — these NEVER touch the LLM (instant).
   * 2. Planner fallback: anything else goes to the brain, which returns a
   *    STRUCTURED action we then execute locally (so it actually does things,
   *    instead of just talking about them). Plain questions come back as chat.
   */
  async route(input: string, history: ChatMessage[] = []): Promise<RouteResult> {
    const text = input.trim();
    const lower = text.toLowerCase();
    logger.info('Input received', { text });

    // ---- 1. YouTube (search or open) — checked first so "go to youtube and
    //         search X" doesn't get swallowed by the generic open rule. -------
    if (/\byoutube\b/.test(lower) && ACTION_VERB.test(lower)) {
      // Peel off the command framing without touching the query words:
      // strip a leading verb, "and/then <verb>" connectors, and the word
      // "youtube" (with its on/in/for glue). Keep everything else intact.
      const query = lower
        .replace(/https?:\/\/\S+/g, '')
        .replace(/^(open|launch|start|run|go to|bring up|search( for)?|find|play|watch|look ?up)\s+/, '')
        .replace(/\b(and|then)\s+(search( for)?|find|play|watch|look ?up)\b/g, '')
        .replace(/\b(on|in|to)\s+(the\s+)?youtube\b/g, '')
        .replace(/\byoutube\s+(for|search)\b/g, '')
        .replace(/\byoutube\b/g, '')
        .replace(/\b(on|in)\s+(my\s+|the\s+)?(browser|brower)\b/g, '')
        .replace(/^\s*(for|and|search)\s+/, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (query) {
        logger.info('Intent detected', { intent: 'youtube_search', agent: 'DesktopAgent', query });
        await osService.openUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
        return { reply: `Searching YouTube for ${query}.`, intent: 'youtube_search' };
      }
      logger.info('Intent detected', { intent: 'open_url', agent: 'DesktopAgent', site: 'YouTube' });
      await this.openSite(SITES.youtube);
      return { reply: 'Opening YouTube.', intent: 'open_url' };
    }

    // ---- 2. Open an application or website --------------------------------
    const appMatch = lower.match(/^(?:open|launch|start|run|go to|bring up)\s+(.+)$/);
    if (appMatch) {
      const target = appMatch[1]
        .replace(/\b(on|in|using|with)\s+(my\s+|the\s+)?(default\s+)?(browser|brower|chrome|safari)\b/g, '')
        .replace(/\b(app|application|please|for me|now)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      const site = this.detectSite(target);
      if (site) {
        logger.info('Intent detected', { intent: 'open_url', agent: 'DesktopAgent', site: site.name });
        await this.openSite(site);
        return { reply: `Opening ${site.name}.`, intent: 'open_url' };
      }

      const appKey = this.matchApp(target);
      if (appKey) {
        logger.info('Intent detected', { intent: 'open_app', agent: 'DesktopAgent', app: appKey });
        await osService.openApp(appKey);
        return { reply: `Opening ${this.pretty(target)}.`, intent: 'open_app' };
      }

      if (/\.(com|io|org|net|dev|ai|co|tv)\b/.test(target)) {
        logger.info('Intent detected', { intent: 'open_url', agent: 'DesktopAgent' });
        await osService.openUrl(target.startsWith('http') ? target : `https://${target}`);
        return { reply: `Opening ${target}.`, intent: 'open_url' };
      }
    }

    // ---- 3. Web / Google search -------------------------------------------
    if (/^(search|google|look ?up)\b/.test(lower)) {
      const q = lower
        .replace(/^(search for|search|google for|google|look ?up)\b/, '')
        .replace(/\bon\s+(the\s+)?(web|google|internet)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (q) {
        logger.info('Intent detected', { intent: 'web_search', agent: 'DesktopAgent', query: q });
        await osService.searchWeb(q);
        return { reply: `Searching the web for ${q}.`, intent: 'web_search' };
      }
    }

    // ---- 4. Read a folder --------------------------------------------------
    const folder = lower.match(/(?:read|list|show|what'?s in|open)\s+(?:my\s+|the\s+)?(\w+)\s*(?:folder|directory)?$/);
    if (folder && FOLDERS[folder[1]]) {
      return this.readFolder(folder[1]);
    }

    // ---- 5. Volume control -------------------------------------------------
    if (/\b(volume|sound)\b/.test(lower) && /\b(up|down|mute|unmute|max|set|to|\d)\b/.test(lower)) {
      return this.controlVolume(lower);
    }

    // ---- 6. Clipboard ------------------------------------------------------
    if (/(read|what'?s on|show|get)\s+(?:my\s+)?clipboard/.test(lower)) {
      logger.info('Intent detected', { intent: 'clipboard_read', agent: 'DesktopAgent' });
      const clip = await osService.getClipboard();
      return {
        reply: clip ? 'Here is your clipboard.' : 'Your clipboard is empty.',
        intent: 'clipboard_read',
        detail: clip
      };
    }

    // ---- 7. System info ----------------------------------------------------
    if (/(system info|system status|what mac|os version|uptime)/.test(lower)) {
      logger.info('Intent detected', { intent: 'system_info', agent: 'DesktopAgent' });
      const info = await osService.getSystemInfo();
      return { reply: 'Here is your system info.', intent: 'system_info', detail: info };
    }

    // ---- 8. Planner fallback → let the brain choose an action -------------
    return this.planAndExecute(text, history);
  }

  // --------------------------------------------------------------------- //

  /**
   * Ask the brain to map fuzzy input to a structured action, then run it.
   * This is what makes Jarvis "smart" about phrasing without sending every
   * simple command through the LLM.
   */
  private async planAndExecute(text: string, history: ChatMessage[]): Promise<RouteResult> {
    logger.info('Intent detected', { intent: 'planner', agent: 'BrainService' });

    const planner: ChatMessage = {
      role: 'system',
      content: [
        'You are the intent planner for Jarvis, a macOS assistant. Convert the user message into ONE JSON action.',
        'Valid actions (use exactly one):',
        '{"action":"open_app","app":"vscode|safari|chrome|finder|terminal|spotify|discord|notes|calendar|messages|mail|systemsettings","reply":"..."}',
        '{"action":"open_url","url":"https://...","reply":"..."}',
        '{"action":"youtube_search","query":"...","reply":"..."}',
        '{"action":"web_search","query":"...","reply":"..."}',
        '{"action":"read_folder","folder":"desktop|downloads|documents|home","reply":"..."}',
        '{"action":"volume","level":"up|down|mute|unmute|max|<0-100>","reply":"..."}',
        '{"action":"clipboard_read","reply":"..."}',
        '{"action":"system_info","reply":"..."}',
        '{"action":"chat","reply":"<short, witty, 1-sentence answer>"}',
        'Rules: pick the single best action. If it is a question or conversation, use "chat" and answer briefly.',
        'The "reply" is what Jarvis says — calm, direct, max one sentence. Output ONLY the JSON object.'
      ].join('\n')
    };

    // Fold recent context into ONE user message. Passing history as separate
    // chat turns confuses gpt-oss's JSON mode into returning empty content.
    const recent = history.slice(-6)
      .map(m => `${m.role === 'user' ? 'User' : 'Jarvis'}: ${m.content}`)
      .join('\n');
    const userContent = recent
      ? `Recent conversation:\n${recent}\n\nCurrent message: ${text}`
      : text;

    let plan: any;
    try {
      const raw = await brainService.completeJSON([planner, { role: 'user', content: userContent }]);
      plan = JSON.parse(raw);
    } catch (error) {
      logger.warn('Planner failed, falling back to chat', { error: (error as Error).message });
      const reply = await brainService.ask(text, history);
      return { reply, intent: 'general_question' };
    }

    return this.executePlan(plan, text, history);
  }

  private async executePlan(plan: any, text: string, history: ChatMessage[]): Promise<RouteResult> {
    const reply: string = plan?.reply || 'Done.';
    logger.info('Plan resolved', { action: plan?.action });

    switch (plan?.action) {
      case 'open_app': {
        const appKey = this.matchApp(String(plan.app || '')) || String(plan.app || '');
        await osService.openApp(appKey);
        return { reply, intent: 'open_app' };
      }
      case 'open_url':
        await osService.openUrl(String(plan.url || ''));
        return { reply, intent: 'open_url' };
      case 'youtube_search':
        await osService.openUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(String(plan.query || ''))}`);
        return { reply, intent: 'youtube_search' };
      case 'web_search':
        await osService.searchWeb(String(plan.query || ''));
        return { reply, intent: 'web_search' };
      case 'read_folder':
        if (FOLDERS[plan.folder]) return this.readFolder(plan.folder);
        return { reply: `I don't know that folder.`, intent: 'read_folder' };
      case 'volume':
        return this.applyVolume(String(plan.level || ''));
      case 'clipboard_read': {
        const clip = await osService.getClipboard();
        return { reply: clip ? 'Here is your clipboard.' : 'Your clipboard is empty.', intent: 'clipboard_read', detail: clip };
      }
      case 'system_info': {
        const info = await osService.getSystemInfo();
        return { reply, intent: 'system_info', detail: info };
      }
      case 'chat':
      default:
        return { reply, intent: 'general_question' };
    }
  }

  private async openSite(site: Site): Promise<void> {
    if (site.app) {
      try {
        await osService.openApp(site.app);
        return;
      } catch {
        // App not installed → fall back to the website.
      }
    }
    await osService.openUrl(site.url);
  }

  private matchApp(raw: string): string | null {
    const key = raw.toLowerCase().trim();
    if (APP_ALIASES[key]) return APP_ALIASES[key];
    for (const alias of Object.keys(APP_ALIASES)) {
      if (key.includes(alias)) return APP_ALIASES[alias];
    }
    return null;
  }

  /** Find a known site mentioned anywhere in the phrase. */
  private detectSite(text: string): Site | null {
    const words = text.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (SITES[word]) return SITES[word];
    }
    return null;
  }

  private async readFolder(name: string): Promise<RouteResult> {
    const dir = FOLDERS[name];
    logger.info('Intent detected', { intent: 'read_folder', agent: 'DesktopAgent', dir });
    try {
      const entries = fs.readdirSync(dir).filter(e => !e.startsWith('.'));
      const detail = entries.slice(0, 30).join('\n');
      const reply = entries.length === 0
        ? `Your ${name} folder is empty.`
        : `I found ${entries.length} item${entries.length === 1 ? '' : 's'} in your ${name} folder.`;
      return { reply, intent: 'read_folder', detail };
    } catch (error) {
      return { reply: `I couldn't read your ${name} folder.`, intent: 'read_folder', detail: (error as Error).message };
    }
  }

  private async controlVolume(lower: string): Promise<RouteResult> {
    let spec = '';
    const setTo = lower.match(/(?:to|set|at)\D*(\d{1,3})/);
    if (/\bmute\b/.test(lower)) spec = 'mute';
    else if (/\bunmute\b/.test(lower)) spec = 'unmute';
    else if (/\bmax\b/.test(lower)) spec = 'max';
    else if (setTo) spec = setTo[1];
    else if (/\bup\b/.test(lower)) spec = 'up';
    else if (/\bdown\b/.test(lower)) spec = 'down';
    return this.applyVolume(spec);
  }

  private async applyVolume(spec: string): Promise<RouteResult> {
    logger.info('Intent detected', { intent: 'volume', agent: 'DesktopAgent', spec });
    let script = '';
    let reply = '';

    if (spec === 'mute') { script = 'set volume output muted true'; reply = 'Muted.'; }
    else if (spec === 'unmute') { script = 'set volume output muted false'; reply = 'Unmuted.'; }
    else if (spec === 'max') { script = 'set volume output volume 100'; reply = 'Volume maxed.'; }
    else if (/^\d{1,3}$/.test(spec)) {
      const v = Math.min(100, Math.max(0, parseInt(spec, 10)));
      script = `set volume output volume ${v}`; reply = `Volume set to ${v}.`;
    }
    else if (spec === 'up') { script = 'set volume output volume (output volume of (get volume settings) + 15)'; reply = 'Volume up.'; }
    else if (spec === 'down') { script = 'set volume output volume (output volume of (get volume settings) - 15)'; reply = 'Volume down.'; }
    else return { reply: "I'm not sure how to change the volume there.", intent: 'volume' };

    await execFileAsync('osascript', ['-e', script]);
    return { reply, intent: 'volume' };
  }

  private pretty(raw: string): string {
    const map: Record<string, string> = { vscode: 'VS Code', 'vs code': 'VS Code', 'code': 'VS Code' };
    return map[raw.toLowerCase()] || raw.replace(/\b\w/g, c => c.toUpperCase());
  }
}

export const commandRouter = new CommandRouter();
