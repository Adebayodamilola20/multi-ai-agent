import { createAgentLogger } from '../logger/logger';
import { llmService } from '../services/llm.service';
import { githubService } from '../services/github.service';
import { Task } from '../types';

const logger = createAgentLogger('sammy');

interface FixFile {
  path: string;
  content: string;
}

export class FixerAgent {
  private get client() {
    return llmService.getClient();
  }

  async fix(task: Task): Promise<{ branchName: string; commitSha: string; confidence: number; files: string[] }> {
    const baseBranch = task.payload.branch || task.payload.baseBranch || 'main';
    const branchName = this.createSafeBranchName(task);

    if (baseBranch === 'main' || baseBranch === 'master') {
      logger.info('Creating fix branch from protected base branch', { baseBranch, branchName }, task.id);
    }

    await githubService.createBranch(task.payload.repository, baseBranch, branchName);

    const targetFiles = task.payload.files?.slice(0, 5) ?? [];
    if (targetFiles.length === 0) {
      throw new Error('No files were supplied for Sammy to fix.');
    }

    const fixedFiles: FixFile[] = [];
    let confidence = 60;

    for (const filePath of targetFiles) {
      try {
        const file = await githubService.getFile(task.payload.repository, filePath, baseBranch);
        const fix = await this.generateFix(task, file.path, file.content);
        fixedFiles.push({ path: file.path, content: fix.content });
        confidence = Math.max(0, Math.min(100, Math.round((confidence + fix.confidence) / 2)));
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 404) {
          logger.info('File not found — creating new file', { filePath }, task.id);
          const fix = await this.generateNewFile(task, filePath);
          fixedFiles.push({ path: filePath, content: fix.content });
          confidence = Math.max(0, Math.min(100, Math.round((confidence + fix.confidence) / 2)));
        } else {
          logger.warn('Skipping file — could not read or fix', { filePath, error: (error as Error).message }, task.id);
        }
      }
    }

    if (fixedFiles.length === 0) {
      throw new Error(`None of the ${targetFiles.length} target file(s) could be read or created in ${task.payload.repository}@${baseBranch}.`);
    }

    const commitSha = await githubService.commitFiles(
      task.payload.repository,
      branchName,
      fixedFiles,
      this.createCommitMessage(task)
    );

    logger.info('Fix committed', { branchName, commitSha, files: fixedFiles.map(file => file.path), confidence }, task.id);
    return { branchName, commitSha, confidence, files: fixedFiles.map(file => file.path) };
  }

  private async generateFix(task: Task, path: string, content: string): Promise<{ content: string; confidence: number }> {
    const reviewText = (task.payload.reviewResults ?? [])
      .filter(result => result.file === path)
      .map(result => `${result.severity} line ${result.line}: ${result.message} Suggestion: ${result.suggestion}`)
      .join('\n');

    const userRequest = task.payload.summary || task.payload.title || 'Fix issues in this file';

    const response = await this.client.chat.completions.create({
      model: llmService.getModel(),
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: [
            'You are Sammy, a careful autonomous fixer. Return only JSON with "content" (complete fixed file) and "confidence" (0-100).',
            'Fix bugs, errors, and issues based on the user\'s request. Preserve all existing functionality. Only make necessary changes.'
          ].join('\n')
        },
        {
          role: 'user',
          content: [
            `Repository: ${task.payload.repository}`,
            `File: ${path}`,
            `User request: ${userRequest}`,
            `Errors:\n${(task.payload.errors ?? []).join('\n') || 'None provided'}`,
            `Review findings:\n${reviewText || 'None provided'}`,
            'Current complete file content:',
            content
          ].join('\n\n')
        }
      ],
      response_format: { type: 'json_object' }
    });

    const raw = response.choices[0]?.message.content ?? '{}';
    const parsed = JSON.parse(raw) as Partial<{ content: string; confidence: number }>;
    if (!parsed.content) {
      throw new Error(`OpenAI did not return replacement content for ${path}`);
    }

    return {
      content: parsed.content,
      confidence: Number(parsed.confidence ?? 60)
    };
  }

  private async generateNewFile(task: Task, path: string): Promise<{ content: string; confidence: number }> {
    const response = await this.client.chat.completions.create({
      model: llmService.getModel(),
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: [
            'You are Sammy, an autonomous file creator. Return only JSON with "content" (complete file) and "confidence" (0-100).',
            'Generate a complete, production-quality file based on the request.',
            'The file does not exist yet — you are creating it from scratch.',
            `Repository: ${task.payload.repository}`,
            `Context: ${task.payload.title || task.payload.summary || ''}`,
            `Errors/Issues to address:\n${(task.payload.errors ?? []).join('\n') || 'Create a well-structured file'}`
          ].join('\n')
        },
        {
          role: 'user',
          content: `Create a new file at path "${path}" for the repository ${task.payload.repository}. Generate the complete file content.`
        }
      ],
      response_format: { type: 'json_object' }
    });

    const raw = response.choices[0]?.message.content ?? '{}';
    const parsed = JSON.parse(raw) as Partial<{ content: string; confidence: number }>;
    if (!parsed.content) {
      throw new Error(`OpenAI did not return content for new file ${path}`);
    }

    return {
      content: parsed.content,
      confidence: Number(parsed.confidence ?? 70)
    };
  }

  private createSafeBranchName(task: Task): string {
    const description = (task.payload.title || task.payload.eventType || 'fix')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);

    return `fix/${task.id}-${description || 'issue'}`;
  }

  private createCommitMessage(task: Task): string {
    return [
      `fix(${task.payload.repository}): automated repair for ${task.payload.eventType}`,
      '',
      `Task: ${task.id}`,
      'Agent: Sammy',
      'Safeguard: committed to fix branch only'
    ].join('\n');
  }
}

export const fixerAgent = new FixerAgent();
