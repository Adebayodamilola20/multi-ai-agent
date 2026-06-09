import { createAgentLogger } from '../logger/logger';
import { voiceService } from '../services/voice.service';
import { base44Agent } from './base44.agent';
import { suggestionAgent } from './suggestion.agent';
import { desktopAgent } from './desktop.agent';
import { safetyAgent } from './safety.agent';
import { ensureAudioTools } from '../services/audio-check';
import readline from 'readline';
import { config } from '../config';

/**
 * Primary Voice Interaction Agent – handles wake‑word, conversation, streaming LLM
 * responses, and proactive suggestions.
 */
export class VoiceAgent {
  private logger = createAgentLogger('voice-agent');
  private conversation: { role: string; content: string }[] = [];
  private active = false;
  private recentProjects = new Set<string>();

  async start(): Promise<void> {
    this.logger.info('VoiceAgent started');
  }

  /** Main loop – called repeatedly by the bootstrap */
   async runCycle(): Promise<void> {
    // Respect VOICE_ENABLED flag
    if (!config.voice.enabled) {
      this.logger.info('Voice disabled via config – exiting runCycle');
      return;
    }
    if (config.textInputMode) {
      this.logger.info('Text Input Mode Enabled');
    } else {
      this.logger.info('Waiting for wake word "Hey Jarvis"');
      await voiceService.waitForWakeWord('hey jarvis');
      await voiceService.speak('Yes, how can I assist you?');
    }
    this.active = true;
    while (this.active) {
if (!config.textInputMode) {
          const audioOk = await ensureAudioTools();
          if (!audioOk) {
            this.logger.warn('Audio tools missing – voice loop paused');
            await new Promise(res => setTimeout(res, 30000));
            continue;
          }
        }
       let cleaned: string;
       if (config.textInputMode) {
         const answer = await new Promise<string>((resolve) => {
           const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
           rl.question('You: ', (ans) => {
             rl.close();
             resolve(ans);
           });
         });
         cleaned = answer.trim();
       } else {
         const userInput = await voiceService.listen(12);
         if (!userInput) {
           await voiceService.speak('I didn\'t catch that. Please say that again.');
           continue;
         }
         cleaned = userInput.trim();
       }
       this.logger.info('User said', { text: cleaned });
        // Test command to verify LLM connectivity
        if (cleaned === 'test-llm') {
          const testPrompt = 'Reply with only OK';
const testResponse = await base44Agent.getResponse([{ role: 'user', content: testPrompt }]);
          const reply = testResponse.trim();
          this.logger.info('LLM test response', { reply });
          console.log('Jarvis:', reply);
          await voiceService.speak(reply);
          continue;
        }
      // Detect possible project name patterns (owner/repo)
      const projMatch = cleaned.match(/[\w-]+\/[\w-]+/);
      if (projMatch) {
        this.recentProjects.add(projMatch[0]);
      }

      // Exit keywords
      const lower = cleaned.toLowerCase();
      if (lower.includes('goodbye') || lower.includes('stop listening') || lower.includes('exit')) {
        await voiceService.speak('Goodbye.');
        this.active = false;
        this.conversation = [];
        break;
      }

      // Append user message to context
      this.conversation.push({ role: 'user', content: cleaned });

      // Try to handle desktop commands before invoking the LLM
      if (await this.handleDesktopCommand(cleaned)) {
        // Record the assistant action in the conversation for context continuity
        this.conversation.push({ role: 'assistant', content: '[executed desktop action]' });
        continue;
      }

// Ensure system prompt is present (Jarvis personality)
    if (!this.conversation.find(m => m.role === 'system')) {
      this.conversation.unshift({
        role: 'system',
        content: `You are Jarvis, an AI assistant modeled after Iron Man's Jarvis. You are calm, intelligent, professional, slightly witty, and direct. Provide concise responses (1‑3 sentences, max 150 words) unless the user explicitly asks for detail. Help with coding, desktop tasks, and general queries, offering brief suggestions when relevant.`
      });
    }

 // Get response from Base44
     this.logger.info('Sending prompt to Base44');
     let response = '';
     try {
       response = await base44Agent.getResponse(this.conversation);
       this.logger.info('Base44 response received');
     } catch (error) {
      const err: any = error;
      const status = err?.response?.status;
      const msg = err?.response?.data?.error?.message ?? err.message;
      this.logger.error('Base44 request failed', { status, message: msg });
      await voiceService.speak('Sorry, I encountered an error while processing your request.');
      continue;
    }
    // Append assistant response to context
    if (!response || response.trim().length === 0) {
      this.logger.warn('Empty Base44 response');
    }
    this.logger.info('Base44 response length');
    this.logger.info('Base44 response length', { length: response.length });
    this.conversation.push({ role: 'assistant', content: response });

    // Before speaking, check for interruption
    if (await this.checkForInterrupt()) {
      await voiceService.stopSpeaking();
      this.logger.info('Interrupted before speaking, restarting loop');
      continue;
    }

    // Speak the response
    console.log('Jarvis:', response);
    this.logger.info(`Speaking response with provider: ${config.ttsProvider}`);
    try {
      await voiceService.speak(response);
    } catch (e) {
      this.logger.error(`${config.ttsProvider} TTS failed`, { error: (e as Error).message });
    }

        // Proactive suggestion – use recent project context if available
        try {
          if (this.recentProjects.size > 0) {
            const projectPath = Array.from(this.recentProjects).join(', ');
            const suggestion = await suggestionAgent.suggest(projectPath);
            if (suggestion && suggestion.length > 0) {
              const snippet = suggestion.split('\n')[0];
              await voiceService.speak(`By the way, ${snippet}`);
            }
          }
        } catch (e) {
          this.logger.warn('Suggestion agent failed', { error: (e as Error).message });
        }
    }
  }

  /**
   * Parses a spoken phrase and, if it matches a known desktop command,
   * asks the SafetyAgent for confirmation and then executes it.
   * Returns true when a command was handled.
   */
  private async handleDesktopCommand(text: string): Promise<boolean> {
  // ... existing code remains ...
    const lower = text.toLowerCase();

    const exec = async (desc: string, fn: () => Promise<void>) => {
      if (await safetyAgent.confirm(desc)) {
        await fn();
        return true;
      }
      return false;
    };

    if (lower.includes('open safari')) {
      return exec('Open Safari', () => desktopAgent.openSafari());
    }
    if (lower.includes('open finder')) {
      return exec('Open Finder', () => desktopAgent.openFinder());
    }
if (lower.includes('open visual studio code') || lower.includes('open vscode') || lower.includes('open vs code') || lower.includes('open code') || lower.includes('launch visual studio code') || lower.includes('launch vscode') || lower.includes('launch vs code')) {
        return exec('Open Visual Studio Code', () => desktopAgent.openVSCode());
      }
    if (lower.includes('open terminal')) {
      return exec('Open Terminal', () => desktopAgent.openTerminal());
    }
    if (lower.includes('search youtube for')) {
      const m = text.match(/search youtube for (.+)/i);
      const query = m?.[1]?.trim();
      if (query) {
        return exec(`Search YouTube for "${query}"`, () => desktopAgent.searchYouTube(query));
      }
    }
    if (lower.includes('search google for')) {
      const m = text.match(/search google for (.+)/i);
      const query = m?.[1]?.trim();
      if (query) {
        return exec(`Search Google for "${query}"`, () => desktopAgent.searchGoogle(query));
      }
    }
    if (lower.startsWith('open ') && lower.includes('http')) {
      const url = text.replace(/^open\s+/i, '').trim();
      return exec(`Open URL ${url}`, () => desktopAgent.openUrl(url));
    }
    if (lower.includes('read my desktop') || lower.includes('read desktop folder')) {
      return exec('Read Desktop folder', () => desktopAgent.readFolder('~/Desktop'));
    }
    return false;
  }

  /** Detect if user interrupted with wake word while idle */
  private async checkForInterrupt(): Promise<boolean> {
    const text = await voiceService.listenShort(1);
    return !!text && text.toLowerCase().includes('hey jarvis');
  }
}

export const voiceAgent = new VoiceAgent();
