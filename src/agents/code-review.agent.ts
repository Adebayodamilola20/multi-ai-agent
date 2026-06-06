import { createAgentLogger } from '../logger/logger';
import { llmService } from '../services/llm.service';
import { githubService } from '../services/github.service';
import { ReviewResult, Task } from '../types';

const logger = createAgentLogger('jim');

export class CodeReviewAgent {
  private get client() {
    return llmService.getClient();
  }

  async review(task: Task): Promise<ReviewResult[]> {
    logger.info('Review started', { files: task.payload.files }, task.id);

    const diffs = await githubService.getDiffs(
      task.payload.repository,
      task.payload.commitSha,
      task.payload.files
    );

    const findings: ReviewResult[] = [];
    for (const diff of diffs) {
      if (!diff.patch.trim()) {
        continue;
      }

      const response = await this.client.chat.completions.create({
        model: llmService.getModel(),
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content:
              'You are Jim, a strict TypeScript code reviewer. Return only valid JSON with a top-level "findings" array.'
          },
          {
            role: 'user',
            content: [
              'Review this GitHub diff for logic bugs, TypeScript errors, missing imports, lint issues, security vulnerabilities, performance issues, and broken error handling.',
              'Each finding must include: file, line, severity ("error"|"warning"|"info"), category, message, suggestion.',
              'If there are no findings, return {"findings":[]}.',
              `File: ${diff.file}`,
              'Diff:',
              diff.patch
            ].join('\n\n')
          }
        ],
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message.content ?? '{"findings":[]}';
      findings.push(...this.parseFindings(content, diff.file));
    }

    logger.info('Review completed', { findingCount: findings.length }, task.id);
    return findings;
  }

  private parseFindings(content: string, fallbackFile: string): ReviewResult[] {
    try {
      const parsed = JSON.parse(content) as { findings?: Partial<ReviewResult>[] };
      return (parsed.findings ?? []).map(item => ({
        file: item.file ?? fallbackFile,
        line: Number(item.line ?? 1),
        severity: item.severity === 'error' || item.severity === 'warning' || item.severity === 'info'
          ? item.severity
          : 'warning',
        category: item.category ?? 'general',
        message: item.message ?? 'Review finding',
        suggestion: item.suggestion ?? 'Inspect this code path manually.'
      }));
    } catch (error) {
      logger.warn('Failed to parse OpenAI review JSON', { error: (error as Error).message, content });
      return [
        {
          file: fallbackFile,
          line: 1,
          severity: 'warning',
          category: 'ai-review',
          message: 'OpenAI returned an unparsable review response.',
          suggestion: 'Run a manual review for this file.'
        }
      ];
    }
  }
}

export const codeReviewAgent = new CodeReviewAgent();
