import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { createAgentLogger } from '../logger/logger';
import { discordService } from '../services/discord.service';
import { projectScannerService } from '../services/project-scanner.service';
import { memoryService } from '../services/memory.service';
import { config } from '../config';

const execAsync = promisify(execFile);
const logger = createAgentLogger('repo-import');

interface ImportResult {
  repoName: string;
  localPath: string;
  projectType: string;
  setupReport: string;
  success: boolean;
}

export class RepoImportAgent {
  async import(repoUrlOrName: string): Promise<ImportResult | null> {
    let repoUrl = repoUrlOrName;
    let repoName = '';

    if (!repoUrl.includes('github.com') && !repoUrl.includes('/')) {
      repoUrl = `https://github.com/${config.github.username}/${repoUrl}`;
    } else if (!repoUrl.includes('github.com')) {
      repoUrl = `https://github.com/${repoUrl}`;
    }

    repoName = repoUrl.replace(/\.git$/, '').split('/').pop() || 'unknown-repo';
    const destDir = config.projects.importedReposPath;
    const destPath = path.join(destDir, repoName);

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    await discordService.post(`📥 Cloning **${repoName}** into \`${destPath}\`...`, 'Sammy');

    try {
      if (fs.existsSync(destPath)) {
        await discordService.post(`⚠️ **${repoName}** already exists at \`${destPath}\`. Pulling latest...`, 'Sammy');
        await execAsync('git', ['-C', destPath, 'pull'], { timeout: 60000 });
      } else {
        await execAsync('git', ['clone', repoUrl, destPath], { timeout: 120000 });
      }
    } catch (error) {
      const msg = `❌ Clone failed: ${(error as Error).message}`;
      await discordService.post(msg, 'Sammy');
      return { repoName, localPath: '', projectType: 'unknown', setupReport: msg, success: false };
    }

    await discordService.post(`✅ Cloned **${repoName}**. Analyzing project structure...`, 'Sammy');

    const summary = await projectScannerService.scan(destPath);

    const setupReport = this.buildSetupReport(summary);

    await discordService.post(setupReport, 'Sammy');

    if (summary.packageManager === 'npm' || summary.packageManager === 'yarn') {
      await discordService.post(`📦 Installing dependencies for **${repoName}**...`, 'Sammy');
      try {
        const cmd = summary.packageManager === 'yarn' ? 'yarn' : 'npm';
        await execAsync(cmd, ['install'], { cwd: destPath, timeout: 120000 });
        await discordService.post(`✅ Dependencies installed for **${repoName}**.`, 'Sammy');
      } catch (error) {
        await discordService.post(`⚠️ Install had issues: ${(error as Error).message}. You may need to install manually.`, 'Sammy');
      }
    }

    memoryService.rememberProject(repoName, {
      repoUrl,
      stack: [summary.type],
      notes: `Imported to ${destPath}`,
      tasks: ['repo-import']
    });

    return {
      repoName,
      localPath: destPath,
      projectType: summary.type,
      setupReport,
      success: true
    };
  }

  private buildSetupReport(summary: { name: string; type: string; scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string>; packageManager: string }): string {
    const lines: string[] = [
      `📋 **${summary.name}** setup report:`,
      `   Type: \`${summary.type}\``,
      `   Package manager: \`${summary.packageManager}\``,
    ];

    const depCount = Object.keys(summary.dependencies).length;
    const devDepCount = Object.keys(summary.devDependencies).length;
    lines.push(`   Dependencies: ${depCount} production + ${devDepCount} dev`);

    const scripts = Object.keys(summary.scripts);
    if (scripts.length > 0) {
      lines.push(`   Scripts: ${scripts.slice(0, 6).join(', ')}${scripts.length > 6 ? ` +${scripts.length - 6} more` : ''}`);
    }

    return lines.join('\n');
  }
}

export const repoImportAgent = new RepoImportAgent();
