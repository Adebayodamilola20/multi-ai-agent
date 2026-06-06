import { createAgentLogger } from '../logger/logger';
import { discordService } from '../services/discord.service';
import { projectScannerService } from '../services/project-scanner.service';
import { githubService } from '../services/github.service';
import { memoryService } from '../services/memory.service';
import { ProjectSummary } from '../types';

const logger = createAgentLogger('project-intel');

export class ProjectIntelAgent {
  async analyze(projectPathOrRepo: string): Promise<ProjectSummary | null> {
    const isLocalPath = projectPathOrRepo.startsWith('/') || projectPathOrRepo.startsWith('~') || projectPathOrRepo.startsWith('.');
    const name = projectPathOrRepo.split('/').pop() || projectPathOrRepo;

    await discordService.post(`🔍 Scanning project **${name}**... Let me look at the structure.`, 'Jim');

    let summary: ProjectSummary | null = null;

    if (isLocalPath) {
      const resolvedPath = projectPathOrRepo.replace(/^~/, process.env.HOME || '');
      if (!this.pathExists(resolvedPath)) {
        await discordService.post(`❌ Can't find local path \`${resolvedPath}\`.`, 'Jim');
        return null;
      }
      summary = await projectScannerService.scan(resolvedPath);
    } else {
      const repo = projectPathOrRepo.includes('/') ? projectPathOrRepo : `${process.env.GITHUB_USERNAME || ''}/${projectPathOrRepo}`;
      try {
        const readme = await githubService.getReadme(repo);
        const repoInfo = await githubService.getDefaultBranch(repo).then(() => true).catch(() => false);
        if (!repoInfo) {
          await discordService.post(`❌ Can't access repo \`${repo}\`.`, 'Jim');
          return null;
        }
        const localPath = `${process.env.HOME || '/tmp'}/Desktop/${repo.split('/')[1] || repo}`;
        if (this.pathExists(localPath)) {
          summary = await projectScannerService.scan(localPath);
        }
        if (!summary) {
          summary = {
            name: repo.split('/')[1] || repo,
            path: localPath,
            type: 'unknown',
            frontend: [],
            backend: [],
            apiRoutes: [],
            database: [],
            config: [],
            envVars: [],
            packageManager: 'unknown',
            scripts: {},
            dependencies: {},
            devDependencies: {},
            hasDockerfile: false,
            hasCiCd: false,
            hasTests: false,
            repoUrl: `https://github.com/${repo}`,
            readmePreview: readme.slice(0, 500)
          };
        }
        summary.repoUrl = `https://github.com/${repo}`;
      } catch {
        await discordService.post(`❌ Can't access repo \`${repo}\`. Check permissions.`, 'Jim');
        return null;
      }
    }

    memoryService.rememberProject(name, {
      repoUrl: summary.repoUrl,
      stack: [summary.type],
      notes: summary.readmePreview?.slice(0, 200)
    });

    await discordService.post(
      this.formatSummary(summary),
      'Jim'
    );

    return summary;
  }

  private formatSummary(s: ProjectSummary): string {
    const lines: string[] = [
      `📁 **${s.name}** — *${s.type}*`,
      `📂 \`${s.path}\``,
      '',
    ];

    if (s.repoUrl) lines.push(`🌐 ${s.repoUrl}`);
    if (Object.keys(s.scripts).length > 0) {
      const scriptList = Object.entries(s.scripts).slice(0, 8)
        .map(([k]) => `\`${k}\``).join(', ');
      lines.push(`📜 Scripts: ${scriptList}`);
    }
    if (Object.keys(s.dependencies).length > 0) {
      const top = Object.keys(s.dependencies).slice(0, 10).join(', ');
      lines.push(`📦 Dependencies: ${top}${Object.keys(s.dependencies).length > 10 ? ` +${Object.keys(s.dependencies).length - 10} more` : ''}`);
    }
    if (s.envVars.length > 0) {
      lines.push(`🔑 Env vars: ${s.envVars.join(', ')}`);
    }
    if (s.frontend.length > 0) lines.push(`🖥️ Frontend: ${s.frontend.length} file(s)`);
    if (s.backend.length > 0) lines.push(`⚙️ Backend: ${s.backend.length} file(s)`);
    if (s.database.length > 0) lines.push(`🗄️ Database: ${s.database.join(', ')}`);
    if (s.hasDockerfile) lines.push('🐳 Docker: yes');
    if (s.hasTests) lines.push('🧪 Tests: yes');
    if (s.hasCiCd) lines.push('🔄 CI/CD: yes');
    if (s.readmePreview) {
      lines.push('', '📖 README preview:');
      lines.push(s.readmePreview.length > 300 ? s.readmePreview.slice(0, 300) + '...' : s.readmePreview);
    }

    return lines.join('\n');
  }

  private pathExists(p: string): boolean {
    try {
      const fs = require('fs');
      return fs.existsSync(p);
    } catch { return false; }
  }
}

export const projectIntelAgent = new ProjectIntelAgent();
