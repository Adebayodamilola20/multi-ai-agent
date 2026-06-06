import { execFile } from 'child_process';
import { promisify } from 'util';
import { createAgentLogger } from '../logger/logger';
import { CommandResult, Task, TestResults } from '../types';

const execFileAsync = promisify(execFile);
const logger = createAgentLogger('alexa-test');

export class TestAgent {
  async run(task: Task): Promise<TestResults> {
    logger.info('Test pipeline started', { repository: task.payload.repository }, task.id);

    const install = await this.runCommand('npm', ['install']);
    if (install.exitCode !== 0) {
      return this.results(install);
    }

    const build = await this.runCommand('npm', ['run', 'build']);
    if (build.exitCode !== 0) {
      return this.results(install, build);
    }

    const lint = await this.runCommand('npm', ['run', 'lint']);
    if (lint.exitCode !== 0) {
      return this.results(install, build, lint);
    }

    const test = await this.runCommand('npm', ['test']);
    return this.results(install, build, lint, test);
  }

  private async runCommand(command: string, args: string[]): Promise<CommandResult> {
    const started = Date.now();
    const label = [command, ...args].join(' ');

    try {
      const result = await execFileAsync(command, args, {
        cwd: process.cwd(),
        maxBuffer: 1024 * 1024 * 10,
        timeout: 1000 * 60 * 10
      });

      return {
        command: label,
        exitCode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: Date.now() - started
      };
    } catch (error) {
      const failed = error as { code?: number; stdout?: string; stderr?: string; message: string };
      return {
        command: label,
        exitCode: typeof failed.code === 'number' ? failed.code : 1,
        stdout: failed.stdout ?? '',
        stderr: failed.stderr ?? failed.message,
        durationMs: Date.now() - started
      };
    }
  }

  private results(
    install?: CommandResult,
    build?: CommandResult,
    lint?: CommandResult,
    test?: CommandResult
  ): TestResults {
    const skipped = (command: string): CommandResult => ({
      command,
      exitCode: 1,
      stdout: '',
      stderr: 'Skipped because an earlier pipeline step failed.',
      durationMs: 0
    });

    const finalResults = {
      install: install ?? skipped('npm install'),
      build: build ?? skipped('npm run build'),
      lint: lint ?? skipped('npm run lint'),
      test: test ?? skipped('npm test'),
      passed: Boolean(install && build && lint && test && test.exitCode === 0)
    };

    logger.info('Test pipeline completed', { passed: finalResults.passed });
    return finalResults;
  }
}

export const testAgent = new TestAgent();
