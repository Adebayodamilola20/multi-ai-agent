import { execFile } from 'child_process';
import { promisify } from 'util';
import { createAgentLogger } from '../logger/logger';
import { llmService } from '../services/llm.service';
import { osService } from '../services/os.service';
import { voiceService } from '../services/voice.service';
import { discordService } from '../services/discord.service';
import { githubService } from '../services/github.service';
import { taskQueue } from '../queue/task-queue';
import { randomUUID } from 'crypto';

const execAsync = promisify(execFile);
const logger = createAgentLogger('jarvis');

interface CommandPlan {
  action: string;
  target: string;
  reply: string;
}

export class JarvisAgent {
  private active = false;

  private get client() {
    return llmService.getClient();
  }

  async start(): Promise<void> {
    logger.info('JARVIS agent started', { voice: process.env.JARVIS_VOICE || 'Daniel', model: llmService.getModel() });
  }

  async listenForCommand(): Promise<void> {
    console.log('\n🎧 JARVIS is listening... Say "Tom"');
    logger.info('Waiting for wake word...');
    await voiceService.waitForWakeWord('tom');

    console.log('✅ Wake word detected! Listening for command...');
    voiceService.stopSpeaking();
    await voiceService.speak('Yes sir?');

    const command = await voiceService.listen(7);
    if (!command || command.trim().length === 0) {
      console.log('❌ No command heard, going back to sleep');
      await voiceService.speak('I did not catch that. Try again.');
      return;
    }

    console.log(`🗣️ Command: "${command}"`);
    logger.info('Command received', { command });
    await this.processVoiceCommand(command);
  }

  async processVoiceCommand(text: string): Promise<void> {
    if (this.active) return;
    this.active = true;

    try {
      const plan = await this.planCommand(text);

      if (plan.reply) {
        voiceService.stopSpeaking();
        await voiceService.speak(plan.reply);
      }

      await this.executePlan(plan);
    } catch (error) {
      const msg = `I encountered an error: ${(error as Error).message}`;
      logger.error('Command failed', { error: (error as Error).message });
      voiceService.stopSpeaking();
      await voiceService.speak(msg);
    } finally {
      this.active = false;
    }
  }

  private async planCommand(text: string): Promise<CommandPlan> {
    const response = await this.client.chat.completions.create({
      model: llmService.getModel(),
      temperature: 0.05,
      messages: [
        {
          role: 'system',
          content: [
            'You are JARVIS, an AI assistant on macOS. Respond concisely (1-2 sentences).',
            '',
            'ACTIONS (choose the MOST specific match):',
            '- open_url: open a website. Use for ANY web link.',
            '  → "github.com/owner/repo" for GitHub repos',
            '  → "google.com/search?q=X" for web searches',
            '- open_app: launch app (safari, chrome, vscode, discord, terminal, finder, spotify)',
            '- open_file: open a file path',
            '- run_command: execute a shell command (target is the full command)',
            '- search_files: find files by name',
            '- search_web: open Google search in browser',
            '- system_info: get macOS version, uptime, hostname',
            '- screenshot: take a screenshot',
            '- type_text: simulate typing',
            '- clipboard_copy: copy text',
            '- clipboard_get: read clipboard',
            '- speak: just say something back',
            '- recent_updates: show recent git changes and task history',
            '- none: do nothing',
            '',
            'IMPORTANT: If user mentions "review" + a repo name like "owner/repo", use open_url with "https://github.com/owner/repo"',
            'IMPORTANT: If user says "search for X on Google" or "look up X", use open_url with "https://www.google.com/search?q=X"',
            'IMPORTANT: If user says "open" + app name, use open_app',
            '',
            'The "reply" field is what you say BEFORE doing the action. Keep it brief.',
            '',
            'Format: {"action":"...","target":"...","reply":"..."}'
          ].join('\n')
        },
        {
          role: 'user',
          content: `User said: "${text}"`
        }
      ],
      response_format: { type: 'json_object' }
    });

    const raw = response.choices[0]?.message.content ?? '{}';
    try {
      return JSON.parse(raw) as CommandPlan;
    } catch {
      return { action: 'speak', target: '', reply: 'I did not understand that.' };
    }
  }

  private async executePlan(plan: CommandPlan): Promise<string | undefined> {
    const { action, target } = plan;

    switch (action) {
      case 'speak':
        return plan.reply;

      case 'open_url':
        return osService.openUrl(target);

      case 'open_app':
        return osService.openApp(target);

      case 'open_file':
        return osService.openFile(target);

      case 'run_command':
        return osService.runCommand(target);

      case 'search_files':
        return osService.searchFiles(target);

      case 'search_web':
        return osService.searchWeb(target);

      case 'system_info':
        return osService.getSystemInfo();

      case 'screenshot':
        return osService.takeScreenshot();

      case 'type_text':
        return osService.typeText(target);

      case 'clipboard_copy':
        return osService.setClipboard(target);

      case 'clipboard_get':
        return osService.getClipboard();

      case 'recent_updates': {
        const updates = await this.getRecentUpdates();
        voiceService.stopSpeaking();
        await voiceService.speak(updates);
        return updates;
      }

      case 'github_review':
        await this.triggerGitHubReview(target);
        return `Review queued for ${target}.`;

      default:
        return plan.reply;
    }
  }

  private async getRecentUpdates(): Promise<string> {
    const parts: string[] = [];

    try {
      const { stdout } = await execAsync('git', ['log', '--oneline', '-10', '--no-decorate']);
      const commits = stdout.trim().split('\n').filter(Boolean);
      if (commits.length > 0) {
        parts.push(`Recent commits:\n${commits.join('\n')}`);
      }
    } catch { /* not a git repo */ }

    try {
      const counts = await taskQueue.queue.getJobCounts();
      const total = counts.waiting + counts.active + counts.completed + counts.failed;
      parts.push(`Task queue: ${total} total. Waiting: ${counts.waiting}, Failed: ${counts.failed}.`);
    } catch { /* queue not available */ }

    const joined = parts.join('\n\n');
    return joined || 'No recent updates available.';
  }

  private async triggerGitHubReview(repo: string): Promise<void> {
    const branch = await githubService.getDefaultBranch(repo);
    const sha = await githubService.getBranchSha(repo, branch);
    const files = await githubService.getCommitFiles(repo, sha);

    const task = {
      id: randomUUID(),
      type: 'review' as const,
      priority: 2,
      payload: {
        repository: repo,
        branch,
        commitSha: sha,
        files,
        eventType: 'jarvis_voice_command'
      },
      status: 'pending' as const,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await taskQueue.add(task);
  }
}

export const jarvisAgent = new JarvisAgent();
