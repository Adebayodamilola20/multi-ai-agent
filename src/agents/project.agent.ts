import { createAgentLogger } from '../logger/logger';
import { projectScannerService } from '../services/project-scanner.service';
import { llmService } from '../services/llm.service';
import { readFile } from 'fs/promises';
import path from 'path';
import { ProjectSummary } from '../types';

/**
 * Project Agent – provides high‑level insights about local codebases.
 * It can:
 *   • Scan a folder and return a structured summary (`analyze`).
 *   • Explain a specific file’s purpose (`explainFile`).
 *   • Generate improvement suggestions (`suggest`).
 */
export class ProjectAgent {
  private logger = createAgentLogger('project-agent');

  /** Scan a project directory and return the ProjectSummary */
  async analyze(projectPath: string): Promise<ProjectSummary> {
    this.logger.info('Analyzing project', { projectPath });
    return await projectScannerService.scan(projectPath);
  }

  /** Explain the contents of a file using the LLM */
  async explainFile(filePath: string): Promise<string> {
    try {
      const abs = path.resolve(filePath);
      const content = await readFile(abs, 'utf8');
      const prompt = `Explain the purpose and functionality of the following code file in clear, concise language suitable for a developer. Include key concepts, exported symbols, and any notable patterns.\n\nFile path: ${abs}\n\n${content}`;
      const response = await llmService.getClient().chat.completions.create({
        model: llmService.getModel(),
        temperature: 0.3,
        messages: [{ role: 'system', content: 'You are a helpful assistant that explains code.' }, { role: 'user', content: prompt }]
      });
      return response.choices[0]?.message.content?.trim() || 'No explanation available.';
    } catch (e) {
      this.logger.error('Failed to explain file', { error: (e as Error).message, filePath });
      return `Error explaining file: ${(e as Error).message}`;
    }
  }

  /** Generate improvement suggestions for a project */
  async suggest(projectPath: string): Promise<string> {
    const summary = await this.analyze(projectPath);
    const prompt = `Given the following project summary, suggest concrete improvements, best‑practice changes, and potential refactors. Keep suggestions actionable and concise.\n\n${JSON.stringify(summary, null, 2)}`;
    const response = await llmService.getClient().chat.completions.create({
      model: llmService.getModel(),
      temperature: 0.5,
      messages: [{ role: 'system', content: 'You are a senior engineer offering project improvement advice.' }, { role: 'user', content: prompt }]
    });
    return response.choices[0]?.message.content?.trim() || 'No suggestions.';
  }
}

export const projectAgent = new ProjectAgent();
