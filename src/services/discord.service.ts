import { randomUUID } from 'crypto';
import { Client, GatewayIntentBits, Partials, TextChannel, Message, REST, Routes, SlashCommandBuilder, Interaction } from 'discord.js';
import type OpenAI from 'openai';
import { config } from '../config';
import { createAgentLogger } from '../logger/logger';
import { llmService } from './llm.service';
import { taskQueue } from '../queue/task-queue';
import { githubService } from './github.service';
import { obsidianService } from './obsidian.service';
import { Task, TaskType } from '../types';
import { memoryAgent } from '../agents/memory.agent';
import { projectIntelAgent } from '../agents/project-intel.agent';
import { securityAgent } from '../agents/security.agent';
import { suggestionAgent } from '../agents/suggestion.agent';
import { serverMonitorAgent } from '../agents/server-monitor.agent';
import { devOpsAgent } from '../agents/devops.agent';
import { repoImportAgent } from '../agents/repo-import.agent';
import { emailReportAgent } from '../agents/email-report.agent';

const logger = createAgentLogger('discord-service');

const AGENTS = ['Tom', 'Jim', 'Sammy', 'Alexa', 'Joe'] as const;
type AgentName = (typeof AGENTS)[number];
const ACTIONS = ['none', 'health', 'check', 'review', 'fix', 'test', 'email', 'list', 'revert', 'delegate'] as const;

interface AIResponse {
  agent: AgentName;
  reply: string;
  action: (typeof ACTIONS)[number];
  repository: string | null;
  branch: string | null;
  files: string[] | null;
  taskType?: string;
}

const EMOJIS: Record<string, string> = {
  Tom: '🟢',
  Jim: '🔵',
  Sammy: '🟠',
  Alexa: '🟣',
  Joe: '🔴'
};

export class DiscordService {
  private readonly client: Client;
  private ready = false;
  private readonly conversationHistory: Map<string, Array<{ role: 'user' | 'assistant' | 'system'; content: string }>> = new Map();
  private readonly MAX_HISTORY = 20;

  private get ai() {
    return llmService.getClient();
  }

  private resolveRepository(repo: string | null): string | null {
    if (!repo) return null;
    if (repo === 'null' || repo === 'owner' || repo === 'your-username') return null;
    if (repo.includes('/')) return repo;
    if (config.github.username) return `${config.github.username}/${repo}`;
    return repo;
  }

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
      ],
      partials: [Partials.Channel],
      rest: { timeout: 30000 }
    });

    this.client.once('clientReady', () => {
      this.ready = true;
      logger.info('Discord client ready', { user: this.client.user?.tag });
      this.registerSlashCommands().catch(error => {
        logger.warn('Slash command registration failed', { error: (error as Error).message });
      });
    });

    this.client.on('error', error => {
      logger.error('Discord client error', { error: error.message });
    });

    this.client.on('messageCreate', message => {
      void this.handleMessage(message).catch(error => {
        logger.error('Discord command failed', { error: (error as Error).message });
        void message.reply(`*error: ${(error as Error).message}*`).catch(() => {});
      });
    });

    this.client.on('interactionCreate', interaction => {
      if (interaction.isChatInputCommand()) {
        void this.handleSlashCommand(interaction).catch(error => {
          logger.error('Slash command failed', { error: (error as Error).message });
        });
      }
    });
  }

  private async registerSlashCommands(): Promise<void> {
    const commands = [
      new SlashCommandBuilder()
        .setName('project-scan')
        .setDescription('Scan a project and get a full intelligence report')
        .addStringOption(opt => opt.setName('project').setDescription('Project name or path').setRequired(true)),
      new SlashCommandBuilder()
        .setName('project-health')
        .setDescription('Check project health — stack, deps, env, deployment')
        .addStringOption(opt => opt.setName('project').setDescription('Project name').setRequired(true)),
      new SlashCommandBuilder()
        .setName('render-status')
        .setDescription('Check Render deployment status for all services'),
      new SlashCommandBuilder()
        .setName('render-logs')
        .setDescription('Fetch logs from a Render service')
        .addStringOption(opt => opt.setName('service').setDescription('Service name').setRequired(true)),
      new SlashCommandBuilder()
        .setName('github-clone')
        .setDescription('Clone a public GitHub repo into Desktop/Imported-Repos')
        .addStringOption(opt => opt.setName('repo').setDescription('Repo URL or owner/repo').setRequired(true)),
      new SlashCommandBuilder()
        .setName('github-summary')
        .setDescription('Get a summary of a GitHub repo from README')
        .addStringOption(opt => opt.setName('repo').setDescription('Repo name or owner/repo').setRequired(true)),
      new SlashCommandBuilder()
        .setName('security-scan')
        .setDescription('Scan a project for security issues')
        .addStringOption(opt => opt.setName('project').setDescription('Project path or name').setRequired(true)),
      new SlashCommandBuilder()
        .setName('suggest-improvements')
        .setDescription('Get AI suggestions for improving a project')
        .addStringOption(opt => opt.setName('project').setDescription('Project path or name').setRequired(true)),
      new SlashCommandBuilder()
        .setName('run-tests')
        .setDescription('Run tests for a project')
        .addStringOption(opt => opt.setName('project').setDescription('Project name').setRequired(true)),
      new SlashCommandBuilder()
        .setName('send-report')
        .setDescription('Send an email report for a project')
        .addStringOption(opt => opt.setName('project').setDescription('Project name').setRequired(true)),
      new SlashCommandBuilder()
        .setName('project-memory')
        .setDescription('Recall what we know about a project')
        .addStringOption(opt => opt.setName('project').setDescription('Project name').setRequired(true)),
      new SlashCommandBuilder()
        .setName('watch-project')
        .setDescription('Start watching a project for changes')
        .addStringOption(opt => opt.setName('project').setDescription('Project name').setRequired(true)),
    ];

    const rest = new REST({ version: '10' }).setToken(config.discord.botToken);
    await rest.put(Routes.applicationCommands(this.client.user!.id), { body: commands });
    logger.info('Slash commands registered', { count: commands.length });
  }

  async start(): Promise<void> {
    if (!config.discord.botToken) {
      logger.warn('Discord bot token is missing; Discord notifications disabled');
      return;
    }

    if (this.ready) {
      return;
    }

    const maxRetries = 5;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.client.login(config.discord.botToken);
        return;
      } catch (error) {
        this.client.destroy();
        const isLast = attempt === maxRetries;
        logger.warn(`Discord login attempt ${attempt}/${maxRetries} failed`, {
          error: (error as Error).message,
          retrying: !isLast
        });
        if (isLast) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, attempt * 5000));
      }
    }
  }

  async post(message: string, agent?: string): Promise<void> {
    if (!config.discord.botToken || !config.discord.channelId) {
      logger.warn('Discord credentials are missing; message not sent', { message, agent });
      return;
    }

    if (!this.ready) {
      await this.start();
    }

    const channel = await this.client.channels.fetch(config.discord.channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Discord channel ${config.discord.channelId} is not text based or was not found.`);
    }

    const emoji = agent ? (EMOJIS[agent] ?? '') : '';
    await (channel as TextChannel).send(emoji ? `${emoji} **${agent}** ${message}` : message);
  }

  async stop(): Promise<void> {
    if (this.ready) {
      this.client.destroy();
      this.ready = false;
    }
  }

  private async handleSlashCommand(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) return;

    await interaction.deferReply();

    const commandName = interaction.commandName;
    const project = interaction.options.getString('project');
    const repo = interaction.options.getString('repo');
    const service = interaction.options.getString('service');

    const currentPath = process.cwd();

    try {
      switch (commandName) {
        case 'project-scan':
        case 'project-health':
          if (project) {
            await interaction.editReply(`🟢 **Tom** Scanning **${project}**...`);
            const result = await projectIntelAgent.analyze(project);
            if (!result) await interaction.editReply(`❌ **Tom** Couldn't scan **${project}**.`);
          }
          break;

        case 'render-status':
          await interaction.editReply(`🟢 **Tom** Checking Render services...`);
          await serverMonitorAgent.checkAll();
          await interaction.editReply(`✅ **Tom** Render status check complete.`);
          break;

        case 'render-logs':
          if (service) {
            await interaction.editReply(`🟢 **Tom** Fetching logs for **${service}**...`);
            await devOpsAgent.checkLogs(service);
            await interaction.editReply(`✅ **Tom** Logs fetched for **${service}**.`);
          }
          break;

        case 'github-clone':
          if (repo) {
            await interaction.editReply(`🟢 **Tom** Cloning **${repo}**...`);
            const importResult = await repoImportAgent.import(repo);
            if (importResult?.success) {
              await interaction.editReply(`✅ **Tom** Cloned **${importResult.repoName}** to \`${importResult.localPath}\``);
            } else {
              await interaction.editReply(`❌ **Tom** Clone failed for **${repo}**.`);
            }
          }
          break;

        case 'github-summary':
          if (repo) {
            await interaction.editReply(`🟢 **Tom** Fetching summary for **${repo}**...`);
            await projectIntelAgent.analyze(repo);
          }
          break;

        case 'security-scan':
          if (project) {
            await interaction.editReply(`🟢 **Tom** Scanning **${project}** for security issues...`);
            await securityAgent.scan(project);
            await interaction.editReply(`✅ **Tom** Security scan complete for **${project}**.`);
          }
          break;

        case 'suggest-improvements':
          if (project) {
            await interaction.editReply(`🟢 **Tom** Analyzing **${project}** for improvements...`);
            const result = await suggestionAgent.suggest(project);
            await interaction.editReply(`✅ **Tom** Suggestions generated for **${project}**.`);
          }
          break;

        case 'run-tests':
          if (project) {
            await interaction.editReply(`🟢 **Tom** Running tests for **${project}**...`);
            const repo = project.includes('/') ? project : `${config.github.username}/${project}`;
            try {
              const branch = await githubService.getDefaultBranch(repo);
              const sha = await githubService.getBranchSha(repo, branch);
              const files = await githubService.getCommitFiles(repo, sha);
              const task = {
                id: randomUUID(),
                type: 'test' as TaskType,
                priority: 3,
                payload: { repository: repo, branch, commitSha: sha, files, eventType: 'slash_command' },
                status: 'pending' as const,
                createdAt: new Date(),
                updatedAt: new Date()
              };
              await taskQueue.add(task);
              await interaction.editReply(`🟢 **Tom** Tests queued for **${repo}**. I'll report back!`);
            } catch {
              await interaction.editReply(`❌ **Tom** Couldn't access **${repo}**. Check the name.`);
            }
          }
          break;

        case 'send-report':
          if (project) {
            await interaction.editReply(`🟢 **Tom** Sending report for **${project}**...`);
            await emailReportAgent.sendReport({
              projectName: project,
              action: 'Manual Report',
              summary: 'Report requested via slash command'
            });
            await interaction.editReply(`✅ **Tom** Report sent for **${project}**.`);
          }
          break;

        case 'project-memory':
          if (project) {
            await interaction.editReply(`🟢 **Tom** Looking up memory for **${project}**...`);
            await memoryAgent.recall(project);
            await interaction.editReply(`✅ **Tom** Memory retrieved for **${project}**.`);
          }
          break;

        case 'watch-project':
          if (project) {
            await interaction.editReply(`🟢 **Tom** Watching **${project}** for changes...`);
            await this.post(`👀 **Tom** is now watching **${project}**. I'll monitor for updates!`, 'Tom');
          }
          break;
      }
    } catch (error) {
      await interaction.editReply(`❌ **Tom** Error: ${(error as Error).message}`);
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    if (message.author.bot) return;

    const currentPath = process.cwd();
    logger.info('Message received', { content: message.content, author: message.author.tag, channelId: message.channelId });

    const historyKey = `${message.channelId}:${message.author.id}`;
    const history = this.conversationHistory.get(historyKey) ?? [];

    history.push({ role: 'user' as const, content: message.content });

    const aiResponse = await this.understandMessage(history);
    const resolvedRepo = this.resolveRepository(aiResponse.repository);

    logger.info('AI response ready', { agent: aiResponse.agent, action: aiResponse.action, reply: aiResponse.reply.slice(0, 80) });

    history.push({ role: 'assistant' as const, content: `[${aiResponse.agent}] ${aiResponse.reply}` });

    if (history.length > this.MAX_HISTORY * 2) {
      history.splice(0, 2);
    }
    this.conversationHistory.set(historyKey, history);

    try {
      await message.reply(`${EMOJIS[aiResponse.agent]} **${aiResponse.agent}** ${aiResponse.reply}\n📁 \`${currentPath}\``);
      logger.info('Discord reply sent', { agent: aiResponse.agent });
    } catch (replyError) {
      logger.error('Discord reply failed', { error: (replyError as Error).message });
    }

    void obsidianService.logDiscordMessage(message.author.username, message.content, aiResponse.agent, aiResponse.reply);

    if (aiResponse.action === 'health') {
      const counts = await taskQueue.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
      await message.reply(`📊 **Queue Status** — waiting: ${counts.waiting}, active: ${counts.active}, failed: ${counts.failed}`);
      return;
    }

    if (aiResponse.action === 'list') {
      try {
        const repos = await githubService.listRepos();
        const header = `${EMOJIS.Tom} **Tom** Here are your repos:\n\n`;
        const footer = '\n\nWhich one should I work on?';
        const lines: string[] = [];
        let totalLen = header.length;
        for (let i = 0; i < repos.length; i++) {
          const r = repos[i];
          const line = `**${i + 1}.** ${r.private ? '🔒' : '📂'} \`${r.name}\``;
          if (totalLen + line.length + 1 + footer.length > 2000) {
            const hidden = repos.length - i;
            if (lines.length > 0) lines[lines.length - 1] += ` *(+${hidden} more)*`;
            break;
          }
          lines.push(line);
          totalLen += line.length + 1;
        }
        await message.reply(`${header}${lines.join('\n')}${footer}`);
      } catch (error) {
        logger.error('Failed to list repos', { error: (error as Error).message });
        await message.reply(`${EMOJIS.Tom} **Tom** Repo fetch error: ${(error as Error).message}. Try again or check my GitHub token.`);
      }
      return;
    }

    if (aiResponse.action === 'check') {
      if (!resolvedRepo) {
        await message.reply(`${EMOJIS.Tom} **Tom** I need a repository name like \`owner/repo\` to check. Which repo?`);
        return;
      }

      let repo = resolvedRepo;
      const repoUrl = `https://github.com/${repo}`;

      async function tryGetReadme(r: string): Promise<string | null> {
        try {
          return await githubService.getReadme(r);
        } catch {
          if (!r.endsWith('/') && !r.endsWith('-')) {
            try {
              return await githubService.getReadme(r + '-');
            } catch {
              return null;
            }
          }
          return null;
        }
      }

      const readme = await tryGetReadme(repo);
      if (readme) {
        const summary = await this.summarizeReadme(repo, readme.slice(0, 10000));
        await message.reply(`${EMOJIS.Tom} **Tom** Here's what I found about \`${repo}\`:\n\n${summary}\n\n${repoUrl}`);
      } else {
        await message.reply(`${EMOJIS.Tom} **Tom** Found \`${repo}\` but couldn't fetch its README. Here's the link: ${repoUrl}`);
      }
      return;
    }

    if (aiResponse.action === 'review') {
      if (!resolvedRepo) {
        await message.reply(`${EMOJIS.Tom} **Tom** I need a repository name like \`owner/repo\` to review. Which repo?`);
        return;
      }

      let repo = resolvedRepo;

      try {
        const branch = aiResponse.branch || (await githubService.getDefaultBranch(repo));
        const commitSha = await githubService.getBranchSha(repo, branch);
        const files = await githubService.getCommitFiles(repo, commitSha);
        const task = this.createTask('review', repo, branch, commitSha, files, `Review request for ${repo}`);

        await taskQueue.add(task);

        await this.post(`📋 Task #${task.id.slice(0, 8)} created. I found **${files.length}** file(s) changed in \`${repo}@${branch}\`. Jim, please review!`, 'Tom');
        await this.post(`🔍 On it! Pulling **${files.length}** file(s) from \`${repo}\` for review...`, 'Jim');
      } catch (error) {
        await message.reply(`❌ **Tom** Couldn't access \`${resolvedRepo}\`. Check the repo name and make sure my GitHub token has access.`);
      }
      return;
    }

    if (aiResponse.action === 'fix') {
      if (!resolvedRepo) {
        await message.reply(`${EMOJIS.Sammy} **Sammy** I need a repo to fix. Example: \`fix owner/repo\``);
        return;
      }

      try {
        const repo = resolvedRepo;
        const branch = aiResponse.branch || (await githubService.getDefaultBranch(repo));
        const sha = await githubService.getBranchSha(repo, branch);
        let fixFiles = aiResponse.files ?? [];

        if (fixFiles.length === 0) {
          await this.post(`🔍 Scanning \`${repo}\` to find files that need fixing...`, 'Sammy');
          fixFiles = await githubService.getCommitFiles(repo, sha);
        }

        if (fixFiles.length === 0) {
          await message.reply(`${EMOJIS.Sammy} **Sammy** No recently changed files found in \`${repo}\`. Can you tell me which files have the issue?`);
          history.push({ role: 'assistant' as const, content: `[Sammy] No recently changed files found in ${repo}.` });
          return;
        }

        const task = this.createTask('fix', repo, branch, sha, fixFiles, `Fix request for ${repo}`);
        task.payload.summary = message.content;
        await taskQueue.add(task);
        await this.post(`🛠️ Found **${fixFiles.length}** file(s) to fix in \`${branch}\`. Creating fix branch now!`, 'Sammy');
      } catch (error) {
        await message.reply(`❌ **Sammy** Couldn't access \`${resolvedRepo}\`. Check the repo name and permissions.`);
      }
      return;
    }

    if (aiResponse.action === 'revert') {
      if (!resolvedRepo) {
        await message.reply(`${EMOJIS.Tom} **Tom** I need a repo name to revert. Example: \`revert owner/repo\``);
        return;
      }

      try {
        const repo = resolvedRepo;
        const pr = await githubService.getLatestPullRequest(repo, 'open');
        if (!pr) {
          await message.reply(`${EMOJIS.Tom} **Tom** No open pull requests found for \`${repo}\` to revert.`);
          return;
        }

        await this.post(`⏪ Reverting the latest PR #${pr.number} in \`${repo}\`...`, 'Tom');
        await githubService.closePullRequest(repo, pr.number);
        await this.post(`✅ PR #${pr.number} **${pr.title}** closed.`, 'Tom');

        try {
          await githubService.deleteBranch(repo, pr.head.ref);
          await this.post(`🧹 Branch \`${pr.head.ref}\` deleted.`, 'Tom');
        } catch {
          await this.post(`⚠️ Couldn't delete branch \`${pr.head.ref}\` (may already be deleted or protected).`, 'Tom');
        }

        await message.reply(`${EMOJIS.Tom} **Tom** Done! PR #${pr.number} closed and branch \`${pr.head.ref}\` deleted. ${pr.html_url}`);
      } catch (error) {
        await message.reply(`❌ **Tom** Couldn't revert for \`${resolvedRepo}\`. Check my GitHub token.`);
      }
      return;
    }

    if (aiResponse.action === 'test') {
      if (!resolvedRepo) {
        await message.reply(`${EMOJIS.Alexa} **Alexa** I need a repo to test. Example: \`test owner/repo branch\``);
        return;
      }
      try {
        const repo = resolvedRepo;
        const branch = aiResponse.branch || (await githubService.getDefaultBranch(repo));
        const sha = await githubService.getBranchSha(repo, branch);
        const task = this.createTask('test', repo, branch, sha, [], `Test request for ${repo}`);
        task.payload.fixBranch = branch;
        await taskQueue.add(task);
        await this.post(`🧪 Running install → build → lint → test on \`${repo}@${branch}\`. I'll report back!`, 'Alexa');
      } catch (error) {
        await message.reply(`❌ **Alexa** Couldn't access that repo.`);
      }
      return;
    }

    if (aiResponse.action === 'email') {
      if (!resolvedRepo) {
        await message.reply(`${EMOJIS.Joe} **Joe** I need a repo to send a summary about. Example: \`email owner/repo\``);
        return;
      }
      try {
        const repo = resolvedRepo;
        const branch = aiResponse.branch || (await githubService.getDefaultBranch(repo));
        const sha = await githubService.getBranchSha(repo, branch);
        const task = this.createTask('email', repo, branch, sha, [], `Email summary for ${repo}`);
        await taskQueue.add(task);
        await this.post(`📧 I'll send a summary email about \`${repo}\` to the team.`, 'Joe');
      } catch (error) {
        await message.reply(`❌ **Joe** Couldn't access that repo for the summary.`);
      }
      return;
    }

    if (aiResponse.action === 'delegate') {
      const taskType = aiResponse.taskType || '';
      const projectName = resolvedRepo || aiResponse.repository || message.content.replace(/^(scan|analyze|check)\s+/i, '').trim();

      await this.post(`Let me work on that. I'll coordinate the team.`, 'Tom');

      try {
        let task: Task | null = null;

        if (taskType === 'project-scan' || taskType === 'project-health' || message.content.toLowerCase().includes('scan') || message.content.toLowerCase().includes('intel')) {
          task = this.createTask('project-scan', projectName, 'main', '', [], `Project intelligence for ${projectName}`);
          task.payload.projectPath = projectName;
          await taskQueue.add(task);
          await this.post(`📋 Task queued — scanning **${projectName}**.`, 'Tom');
        } else if (taskType === 'security' || message.content.toLowerCase().includes('security')) {
          task = this.createTask('security-scan', projectName, 'main', '', [`Security scan for ${projectName}`], `Security scan for ${projectName}`);
          task.payload.projectPath = projectName;
          await taskQueue.add(task);
          await this.post(`🔒 Security scan queued for **${projectName}**.`, 'Tom');
        } else if (taskType === 'suggestion' || message.content.toLowerCase().includes('suggest') || message.content.toLowerCase().includes('improve')) {
          task = this.createTask('suggestion', projectName, 'main', '', [`Suggestions for ${projectName}`], `Suggestions for ${projectName}`);
          task.payload.projectPath = projectName;
          await taskQueue.add(task);
          await this.post(`💡 Suggestion analysis queued for **${projectName}**.`, 'Tom');
        } else if (taskType === 'render' || message.content.toLowerCase().includes('render') || message.content.toLowerCase().includes('deploy') || message.content.toLowerCase().includes('server')) {
          task = this.createTask('server-monitor', projectName, 'main', '', [`Server monitoring for ${projectName}`], `Server monitoring for ${projectName}`);
          task.payload.projectPath = projectName;
          await taskQueue.add(task);
          await this.post(`📊 Server monitoring check queued.`, 'Tom');
        } else if (taskType === 'memory' || message.content.toLowerCase().includes('remember') || message.content.toLowerCase().includes('memory') || message.content.toLowerCase().includes('recall')) {
          await memoryAgent.recall(projectName);
        } else if (taskType === 'import' || message.content.toLowerCase().includes('clone') || message.content.toLowerCase().includes('import')) {
          task = this.createTask('repo-import', projectName, 'main', '', [`Import ${projectName}`], `Import ${projectName}`);
          task.payload.repoUrl = projectName;
          await taskQueue.add(task);
          await this.post(`📥 Import queued for **${projectName}**.`, 'Tom');
        } else if (taskType === 'report' || message.content.toLowerCase().includes('report') || message.content.toLowerCase().includes('email')) {
          await emailReportAgent.sendReport({
            projectName,
            action: 'Report',
            summary: aiResponse.reply
          });
          await this.post(`📧 Report sent for **${projectName}**.`, 'Joe');
        } else {
          task = this.createTask('project-scan', projectName, 'main', '', [`Analysis for ${projectName}`], `Analysis for ${projectName}`);
          task.payload.projectPath = projectName;
          await taskQueue.add(task);
          await this.post(`📋 Analysis queued for **${projectName}**.`, 'Tom');
        }
      } catch (error) {
        await message.reply(`❌ **Tom** Error: ${(error as Error).message}`);
      }
      return;
    }
  }

  private async understandMessage(history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>): Promise<AIResponse> {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const agentList = AGENTS.join(', ');

    const messages = [
      {
        role: 'system' as const,
        content: [
          `You are a JSON router for a DevOps Discord server. Agents: ${agentList}. Today: ${today}.`,
          '',
          'RULES:',
          `1. "agent" — pick ONE bare name: ${agentList}. No descriptions.`,
          '2. "repository" — repo name ONLY (e.g. "Telegram-Agent-Automation"). NO "owner/" prefix. null if none.',
          '3. "action" — "list" for repos, "check" for README, "review" for scanning bugs, "fix" for changes, "delegate" for complex tasks (scan, security, deploy, suggest, import, memory, report), "none" for chat.',
          '4. "taskType" — only for "delegate" action. Values: "project-scan", "security", "suggestion", "render", "memory", "import", "report".',
          '5. When user says "add X file" or "create Y file", set "files" to ["X"] or ["Y"] so Sammy knows which file to create.',
          '6. NEVER make up data. Say "I don\'t have access" instead of inventing numbers.',
          '7. When unsure, use "none" and just chat.',
          '',
          'EXAMPLES:',
          'User: "give me my repos" → {"agent":"Tom","reply":"Here are your repos:","action":"list","repository":null,"branch":null,"files":null}',
          'User: "what does cool-project do" → {"agent":"Tom","reply":"Let me check","action":"check","repository":"cool-project","branch":null,"files":null}',
          'User: "scan my-repo for bugs" → {"agent":"Tom","reply":"Let me scan it","action":"review","repository":"my-repo","branch":null,"files":null}',
          'User: "fix the token in my-repo" → {"agent":"Tom","reply":"Which file has the token?","action":"fix","repository":"my-repo","branch":null,"files":null}',
          'User: "add a gitignore file to my-repo" → {"agent":"Tom","reply":"Creating .gitignore","action":"fix","repository":"my-repo","branch":null,"files":[".gitignore"]}',
          'User: "add .env.example to my-repo" → {"agent":"Tom","reply":"Creating .env.example","action":"fix","repository":"my-repo","branch":null,"files":[".env.example"]}',
          'User: "edit src/index.ts in my-repo and change port to 8080" → {"agent":"Tom","reply":"Editing src/index.ts","action":"fix","repository":"my-repo","branch":null,"files":["src/index.ts"]}',
          'User: "change the api url in my-repo/.env to https://api.example.com" → {"agent":"Tom","reply":"Editing .env","action":"fix","repository":"my-repo","branch":null,"files":[".env"]}',
          'User: "scan Telegram-Agent-Automation" → {"agent":"Tom","reply":"Let me scan that project","action":"delegate","repository":"Telegram-Agent-Automation","branch":null,"files":null,"taskType":"project-scan"}',
          'User: "security check my app" → {"agent":"Tom","reply":"Running security scan","action":"delegate","repository":"my-app","branch":null,"files":null,"taskType":"security"}',
          'User: "suggest improvements for my app" → {"agent":"Tom","reply":"Analyzing for improvements","action":"delegate","repository":"my-app","branch":null,"files":null,"taskType":"suggestion"}',
          'User: "check render status" → {"agent":"Tom","reply":"Checking Render","action":"delegate","repository":null,"branch":null,"files":null,"taskType":"render"}',
          'User: "recall my-app" → {"agent":"Tom","reply":"Let me check memory","action":"delegate","repository":"my-app","branch":null,"files":null,"taskType":"memory"}',
          'User: "clone https://github.com/foo/bar" → {"agent":"Tom","reply":"Cloning repo","action":"delegate","repository":"foo/bar","branch":null,"files":null,"taskType":"import"}',
          'User: "hello" → {"agent":"Tom","reply":"Hello! How can I help?","action":"none","repository":null,"branch":null,"files":null}',
          'User: "how many collaborators" → {"agent":"Tom","reply":"I don\'t have access to that data","action":"none","repository":null,"branch":null,"files":null}',
          'User: "send report for my-app" → {"agent":"Tom","reply":"Sending report","action":"delegate","repository":"my-app","branch":null,"files":null,"taskType":"report"}',
        ].join('\n')
      },
      ...history.slice(-this.MAX_HISTORY)
    ];

    const response = await this.ai.chat.completions.create({
      model: llmService.getModel(),
      temperature: 0.05,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      response_format: { type: 'json_object' }
    });

    const raw = response.choices[0]?.message.content ?? '{}';

    try {
      const parsed = JSON.parse(raw) as AIResponse;
      const agent = AGENTS.includes(parsed.agent as AgentName) ? (parsed.agent as AgentName) : 'Tom';
      const action = ACTIONS.includes(parsed.action) ? parsed.action : 'none';
      let repo = parsed.repository ?? null;
      if (repo && (repo === 'null' || repo === 'owner' || repo === 'your-username' || repo.startsWith('your-') || repo.startsWith('owner/'))) {
        repo = null;
      }
      return {
        agent,
        reply: parsed.reply ?? 'Got it!',
        action,
        repository: repo,
        branch: parsed.branch ?? null,
        files: parsed.files ?? null,
        taskType: parsed.taskType
      };
    } catch {
      logger.warn('Failed to parse AI response as JSON', { raw });
      return {
        agent: 'Tom',
        reply: 'Hey! I understand you sent a message but I had trouble processing it. Could you rephrase that?',
        action: 'none',
        repository: null,
        branch: null,
        files: null
      };
    }
  }

  private async summarizeReadme(repo: string, readme: string): Promise<string> {
    const response = await this.ai.chat.completions.create({
      model: llmService.getModel(),
      temperature: 0.5,
      messages: [
        { role: 'system', content: 'You summarize GitHub README files concisely. Cover: what the project does, key features, tech stack. Keep it 3-5 sentences, no markdown except bold for emphasis.' },
        { role: 'user', content: `README for ${repo}:\n\n${readme}` }
      ]
    });
    return response.choices[0]?.message.content ?? `Here's the repository: https://github.com/${repo}`;
  }

  private createTask(type: TaskType, repository: string, branch: string, commitSha: string, files: string[], title: string): Task {
    return {
      id: randomUUID(),
      type,
      priority: 3,
      payload: {
        repository,
        branch,
        commitSha,
        files,
        eventType: 'discord_command',
        title
      },
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

export const discordService = new DiscordService();
