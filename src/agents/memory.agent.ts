import { createAgentLogger } from '../logger/logger';
import { discordService } from '../services/discord.service';
import { memoryService } from '../services/memory.service';

const logger = createAgentLogger('memory-agent');

export class MemoryAgent {
  async recall(projectName: string): Promise<string> {
    const entries = memoryService.getProjectMemory(projectName);
    if (!entries || entries.length === 0) {
      await discordService.post(`I don't have any memory of **${projectName}**.`, 'Tom');
      return 'No memory found';
    }

    const latest = entries[entries.length - 1];
    const lines: string[] = [
      `📝 **Memory for ${projectName}:**`,
      `   Last activity: ${new Date(latest.timestamp).toLocaleString()}`,
    ];

    if (latest.repoUrl) lines.push(`   Repo: ${latest.repoUrl}`);
    if (latest.deployUrl) lines.push(`   Deploy: ${latest.deployUrl}`);
    if (latest.stack?.length) lines.push(`   Stack: ${latest.stack.join(', ')}`);
    if (latest.errors?.length) lines.push(`   Errors: ${latest.errors.slice(0, 3).join('; ')}`);
    if (latest.fixes?.length) lines.push(`   Fixes: ${latest.fixes.slice(0, 3).join('; ')}`);
    if (latest.tasks?.length) lines.push(`   Tasks: ${latest.tasks.join(', ')}`);
    if (latest.notes) lines.push(`   Notes: ${latest.notes.slice(0, 200)}`);

    lines.push('', `Total entries: ${entries.length}`);

    const result = lines.join('\n');
    await discordService.post(result, 'Tom');
    return result;
  }

  async listProjects(): Promise<string> {
    const projects = memoryService.getAllProjects();
    if (projects.length === 0) {
      await discordService.post('No projects in memory yet.', 'Tom');
      return 'No projects';
    }

    const lines = projects.map(name => {
      const latest = memoryService.getLatest(name);
      const lastTime = latest ? new Date(latest.timestamp).toLocaleDateString() : 'unknown';
      return `• **${name}** — last seen ${lastTime}`;
    });

    const result = `📚 **Projects in memory (${projects.length}):**\n${lines.join('\n')}`;
    await discordService.post(result, 'Tom');
    return result;
  }

  remember(projectName: string, data: { repoUrl?: string; deployUrl?: string; stack?: string[]; errors?: string[]; fixes?: string[]; notes?: string }): void {
    memoryService.rememberProject(projectName, data);
    logger.info('Memory updated', { projectName });
  }
}

export const memoryAgent = new MemoryAgent();
