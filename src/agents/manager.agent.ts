import { Job } from 'bullmq';
import { createAgentLogger } from '../logger/logger';
import { taskQueue } from '../queue/task-queue';
import { Task } from '../types';
import { codeReviewAgent } from './code-review.agent';
import { emailAgent } from './email.agent';
import { emailReportAgent } from './email-report.agent';
import { fixerAgent } from './fixer.agent';
import { memoryAgent } from './memory.agent';
import { projectIntelAgent } from './project-intel.agent';
import { pullRequestAgent } from './pull-request.agent';
import { repoImportAgent } from './repo-import.agent';
import { serverMonitorAgent } from './server-monitor.agent';
import { suggestionAgent } from './suggestion.agent';
import { securityAgent } from './security.agent';
import { devOpsAgent } from './devops.agent';
import { testAgent } from './test.agent';
import { discordService } from '../services/discord.service';

const logger = createAgentLogger('tom-manager');

export class ManagerAgent {
  start(): void {
    taskQueue.start((task, job) => this.process(task, job));
    logger.info('Manager worker started');
  }

  private async process(task: Task, job: Job<Task>): Promise<void> {
    task.status = 'in-progress';
    task.updatedAt = new Date();
    await job.updateData(task);
    await emailAgent.notifyLifecycle('Tom', task, 'started');

    try {
      switch (task.type) {
        case 'review':
          await this.handleReview(task);
          break;
        case 'fix':
          await this.handleFix(task);
          break;
        case 'test':
          await this.handleTest(task);
          break;
        case 'pr':
          await this.handlePullRequest(task);
          break;
        case 'email':
          await emailAgent.sendSummary(task);
          break;
        case 'notify':
          await emailAgent.notifyLifecycle('Joe', task, task.payload.summary ?? 'notification sent');
          break;
        case 'project-scan':
          await this.handleProjectScan(task);
          break;
        case 'repo-import':
          await this.handleRepoImport(task);
          break;
        case 'server-monitor':
          await this.handleServerMonitor(task);
          break;
        case 'suggestion':
          await this.handleSuggestion(task);
          break;
        case 'security-scan':
          await this.handleSecurityScan(task);
          break;
        case 'devops':
          await this.handleDevOps(task);
          break;
        default:
          throw new Error(`Unsupported task type ${(task as Task).type}`);
      }

      task.status = 'completed';
      task.updatedAt = new Date();
      await job.updateData(task);
      await emailAgent.notifyLifecycle('Tom', task, 'completed ✅');
    } catch (error) {
      task.status = 'failed';
      task.updatedAt = new Date();
      task.result = {
        success: false,
        error: (error as Error).message
      };
      await job.updateData(task);
      await emailAgent.notifyLifecycle('Tom', task, `failed ❌ — ${(error as Error).message}`);
      await emailAgent.sendSummary(task, `Multi-AI-Agent failure: ${task.payload.repository}`);
      throw error;
    }
  }

  private async handleReview(task: Task): Promise<void> {
    const fileCount = task.payload.files?.length ?? 0;
    await discordService.post(`📋 Reviewing **${fileCount}** file(s) in \`${task.payload.repository}\`. Jim, please check for bugs and issues!`, 'Tom');
    await discordService.post(`🔍 On it! Pulling **${fileCount}** file(s) from \`${task.payload.repository}\` for review...`, 'Jim');

    const reviewResults = await codeReviewAgent.review(task);
    task.result = { success: true, reviewResults };

    const errorCount = reviewResults.filter(r => r.severity === 'error').length;
    const warningCount = reviewResults.filter(r => r.severity === 'warning').length;

    if (errorCount + warningCount > 0) {
      const details = reviewResults.slice(0, 8)
        .map(r => `   \`${r.file}:${r.line}\` [${r.severity}] ${r.message}`)
        .join('\n');
      await discordService.post(
        `🔵 **Jim** found **${errorCount} error(s)** and **${warningCount} warning(s)** in \`${task.payload.repository}\`:\n${details}\n\nSay **fix ${task.payload.repository}** if you want me to resolve these.`,
        'Jim'
      );
    } else {
      await discordService.post(`✅ **Jim** No issues found in \`${task.payload.repository}\`. Looking clean!`, 'Jim');
    }

    await emailAgent.notifyLifecycle('Jim', task, `reviewed ${fileCount} file(s) in ${task.payload.repository}: ${errorCount} errors, ${warningCount} warnings`);
  }

  private async handleFix(task: Task): Promise<void> {
    await discordService.post(`🛠️ Creating fix branch for \`${task.payload.repository}\`. I'll never push to main!`, 'Sammy');

    const result = await fixerAgent.fix(task);
    task.result = {
      success: true,
      branchName: result.branchName,
      commitSha: result.commitSha,
      confidence: result.confidence
    };

    await discordService.post(`✅ Sammy committed the fix to \`${result.branchName}\` (confidence: ${result.confidence}%). Alexa, please test this!`, 'Sammy');
    await discordService.post(`🧪 Testing **${result.branchName}** — running install → build → lint → test...`, 'Alexa');

    await taskQueue.addNext('test', task, {
      fixBranch: result.branchName,
      branch: result.branchName,
      baseBranch: task.payload.branch,
      commitSha: result.commitSha,
      files: result.files,
      confidence: result.confidence
    }, 1);
  }

  private async handleTest(task: Task): Promise<void> {
    const branch = task.payload.fixBranch || task.payload.branch;

    const testResults = await testAgent.run(task);
    task.result = { success: testResults.passed, testResults };

    const steps = [
      `install: ${testResults.install.exitCode === 0 ? '✅' : '❌'}`,
      `build: ${testResults.build.exitCode === 0 ? '✅' : '❌'}`,
      `lint: ${testResults.lint.exitCode === 0 ? '✅' : '❌'}`,
      `test: ${testResults.test.exitCode === 0 ? '✅' : '❌'}`
    ];

    if (!testResults.passed) {
      await discordService.post(`❌ **Alexa** Tests failed on \`${branch}\`. ${steps.join(' | ')}`, 'Alexa');
      return;
    }

    await discordService.post(`✅ **Alexa** All tests passed! ${steps.join(' | ')}. Opening PR...`, 'Alexa');
    await discordService.post(`📝 Creating pull request for \`${branch}\`...`, 'Alexa');

    await taskQueue.addNext('pr', task, { testResults }, 1);
  }

  private async handlePullRequest(task: Task): Promise<void> {
    const prUrl = await pullRequestAgent.create(task);
    task.result = { success: true, prUrl };

    await discordService.post(`✅ **Pull request created!** ${prUrl}`, 'Alexa');
    await discordService.post(`🎉 Pipeline complete for \`${task.payload.repository}\`. ${prUrl}`, 'Tom');
  }

  private async handleProjectScan(task: Task): Promise<void> {
    const projectPath = task.payload.projectPath || task.payload.repository || task.payload.title || '';
    const result = await projectIntelAgent.analyze(projectPath);
    task.result = { success: !!result, output: result ? `Scanned ${result.name}` : 'Failed' };

    if (result) {
      memoryAgent.remember(projectPath, {
        repoUrl: result.repoUrl,
        stack: [result.type],
        notes: result.readmePreview?.slice(0, 200)
      });
      await discordService.post('📧 Sending email report...', 'Joe');
      await emailReportAgent.sendReport({
        projectName: result.name,
        action: 'Project Scan',
        summary: `Type: ${result.type}, Stack: ${result.type}`,
        repoUrl: result.repoUrl
      });
    }
  }

  private async handleRepoImport(task: Task): Promise<void> {
    const repoUrl = task.payload.repoUrl || task.payload.repository || '';
    const result = await repoImportAgent.import(repoUrl);
    task.result = { success: result?.success ?? false, output: result?.localPath };

    if (result?.success) {
      await discordService.post(`📧 Report sent: **${result.repoName}** imported to \`${result.localPath}\``, 'Joe');
      await emailReportAgent.sendReport({
        projectName: result.repoName,
        action: 'Repo Import',
        summary: `Cloned to ${result.localPath}`,
        changes: `Type: ${result.projectType}`
      });
    }
  }

  private async handleServerMonitor(task: Task): Promise<void> {
    const result = await serverMonitorAgent.checkAll();
    task.result = { success: true, output: result };
  }

  private async handleSuggestion(task: Task): Promise<void> {
    const projectPath = task.payload.projectPath || task.payload.repository || task.payload.title || '';
    const result = await suggestionAgent.suggest(projectPath);
    task.result = { success: true, output: result };

    await emailReportAgent.sendReport({
      projectName: projectPath.split('/').pop() || projectPath,
      action: 'Project Suggestions',
      summary: 'Improvement suggestions generated',
      suggestions: result.slice(0, 500)
    });
  }

  private async handleSecurityScan(task: Task): Promise<void> {
    const projectPath = task.payload.projectPath || task.payload.repository || task.payload.title || process.cwd();
    const findings = await securityAgent.scan(projectPath);
    task.result = { success: true, output: `${findings.length} finding(s)` };

    if (findings.length > 0) {
      const critical = findings.filter(f => f.severity === '🔴').length;
      await emailReportAgent.sendReport({
        projectName: projectPath.split('/').pop() || projectPath,
        action: 'Security Scan',
        summary: `${findings.length} issues found (${critical} critical)`,
        errors: findings.map(f => `${f.severity} ${f.message}`).join('\n')
      });
    }
  }

  private async handleDevOps(task: Task): Promise<void> {
    const action = task.payload.eventType;
    const serviceName = task.payload.repository || task.payload.title || '';

    let result = '';
    if (action === 'redeploy') {
      result = await devOpsAgent.redeploy(serviceName);
    } else if (action === 'logs') {
      result = await devOpsAgent.checkLogs(serviceName);
    } else {
      result = await serverMonitorAgent.checkAll();
    }

    task.result = { success: true, output: result };
  }
}

export const managerAgent = new ManagerAgent();
