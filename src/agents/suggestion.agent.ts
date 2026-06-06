import { createAgentLogger } from '../logger/logger';
import { discordService } from '../services/discord.service';
import { llmService } from '../services/llm.service';
import { projectScannerService } from '../services/project-scanner.service';

const logger = createAgentLogger('suggestion');

export class SuggestionAgent {
  private get client() {
    return llmService.getClient();
  }

  async suggest(projectPath: string): Promise<string> {
    await discordService.post(`💡 Analyzing **${projectPath.split('/').pop()}** for improvement suggestions...`, 'Sammy');

    const summary = await projectScannerService.scan(projectPath);

    const response = await this.client.chat.completions.create({
      model: llmService.getModel(),
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: [
            'You are a senior software engineer reviewing a project. Analyze the project details and suggest improvements.',
            'Be specific and actionable. Focus on:',
            '- Missing features or incomplete setup',
            '- Code quality and structure issues',
            '- Missing error handling, logging, validation',
            '- Missing tests, CI/CD, documentation',
            '- Security concerns (without changing code)',
            '- Performance improvements',
            '- Architecture suggestions',
            '',
            'Format: start each suggestion with a bold category, then the suggestion.',
            'Do NOT suggest changing code directly — just identify issues.',
            'Keep it concise (3-6 suggestions).',
            'Example:',
            '**Security**: No rate limiting detected on API routes.',
            '**Testing**: No test framework configured.',
          ].join('\n')
        },
        {
          role: 'user',
          content: [
            `Project: ${summary.name}`,
            `Type: ${summary.type}`,
            `Package manager: ${summary.packageManager}`,
            `Scripts: ${JSON.stringify(summary.scripts)}`,
            `Dependencies: ${Object.keys(summary.dependencies).slice(0, 20).join(', ')}`,
            `Has Dockerfile: ${summary.hasDockerfile}`,
            `Has CI/CD: ${summary.hasCiCd}`,
            `Has Tests: ${summary.hasTests}`,
            `Env vars needed: ${summary.envVars.join(', ')}`,
            `Frontend files: ${summary.frontend.length}`,
            `Backend files: ${summary.backend.length}`,
            '',
            'Suggest improvements for this project:'
          ].join('\n')
        }
      ]
    });

    const suggestions = response.choices[0]?.message.content || 'No suggestions generated.';
    const formatted = `💡 **Suggestions for ${summary.name}:**\n\n${suggestions}`;

    await discordService.post(formatted, 'Sammy');
    return suggestions;
  }
}

export const suggestionAgent = new SuggestionAgent();
