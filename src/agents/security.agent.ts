import fs from 'fs';
import path from 'path';
import { createAgentLogger } from '../logger/logger';
import { discordService } from '../services/discord.service';

const logger = createAgentLogger('security');

interface SecurityFinding {
  severity: '🔴' | '🟠' | '🟡';
  category: string;
  message: string;
  file?: string;
}

export class SecurityAgent {
  async scan(projectPath: string): Promise<SecurityFinding[]> {
    const name = projectPath.split('/').pop() || projectPath;
    await discordService.post(`🔒 Running security scan on **${name}**...`, 'Alexa');

    const findings: SecurityFinding[] = [];

    this.checkEnvFiles(projectPath, findings);
    this.checkPackageJson(projectPath, findings);
    this.checkCors(projectPath, findings);
    this.checkGitignore(projectPath, findings);
    this.checkSensitiveFiles(projectPath, findings);

    if (findings.length === 0) {
      await discordService.post(`✅ Security scan complete — no issues found in **${name}**.`, 'Alexa');
    } else {
      const grouped = this.groupBySeverity(findings);
      let report = `🔒 **Security Scan — ${name}:**\n`;
      for (const [severity, items] of Object.entries(grouped)) {
        report += `\n${severity} **${items.length}** issue(s):\n`;
        for (const item of items) {
          report += `   • ${item.message}`;
          if (item.file) report += ` (\`${item.file}\`)`;
          report += '\n';
        }
      }
      await discordService.post(report, 'Alexa');
    }

    return findings;
  }

  private checkEnvFiles(projectPath: string, findings: SecurityFinding[]): void {
    const envPath = path.join(projectPath, '.env');
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        const hasKeys = content.split('\n')
          .filter(l => l.includes('=') && !l.startsWith('#'))
          .some(l => {
            const val = l.split('=')[1]?.trim();
            return val && val.length > 5 && !['true', 'false', '1', '0', 'localhost'].includes(val.toLowerCase());
          });
        if (hasKeys) {
          findings.push({
            severity: '🔴',
            category: 'exposed-secrets',
            message: 'Live `.env` file with potential secrets committed. Add to `.gitignore`.',
            file: '.env'
          });
        }
      } catch { /* skip */ }
    }

    const envExample = path.join(projectPath, '.env.example');
    if (!fs.existsSync(envExample)) {
      findings.push({
        severity: '🟡',
        category: 'missing-env-example',
        message: 'No `.env.example` file. Add one to document required env vars.',
      });
    }
  }

  private checkPackageJson(projectPath: string, findings: SecurityFinding[]): void {
    const pkgPath = path.join(projectPath, 'package.json');
    if (!fs.existsSync(pkgPath)) return;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      const risky = ['ejs', 'pug', 'lodash', 'moment'];
      for (const dep of risky) {
        if (deps[dep]) {
          findings.push({
            severity: '🟡',
            category: 'risky-dependency',
            message: `Package \`${dep}\` has known security concerns. Consider alternatives.`,
            file: 'package.json'
          });
        }
      }

      if (deps['cors']) {
        findings.push({
          severity: '🟠',
          category: 'dependency',
          message: 'CORS middleware detected. Verify it\'s configured with specific origins, not `*` in production.',
          file: 'package.json'
        });
      }
    } catch { /* skip */ }
  }

  private checkCors(projectPath: string, findings: SecurityFinding[]): void {
    const files = this.findFiles(projectPath, /\.(ts|js)$/);
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        if (content.includes('cors') && (content.includes('origin: "*"') || content.includes("origin: '*'") || content.includes('Access-Control-Allow-Origin: *'))) {
          findings.push({
            severity: '🔴',
            category: 'unsafe-cors',
            message: 'Unsafe CORS configuration detected (wildcard origin).',
            file: path.relative(projectPath, file)
          });
        }
      } catch { /* skip */ }
    }
  }

  private checkGitignore(projectPath: string, findings: SecurityFinding[]): void {
    const gitignorePath = path.join(projectPath, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      findings.push({
        severity: '🟠',
        category: 'missing-gitignore',
        message: 'No `.gitignore` file. Risk of committing secrets.',
      });
      return;
    }

    try {
      const content = fs.readFileSync(gitignorePath, 'utf8');
      const required = ['.env', 'node_modules', '.DS_Store', 'dist', 'build'];
      const missing = required.filter(item => !content.includes(item));
      if (missing.length > 0) {
        findings.push({
          severity: '🟡',
          category: 'incomplete-gitignore',
          message: `.gitignore missing entries: ${missing.join(', ')}`,
          file: '.gitignore'
        });
      }
    } catch { /* skip */ }
  }

  private checkSensitiveFiles(projectPath: string, findings: SecurityFinding[]): void {
    const sensitive = ['credentials.json', 'service-account.json', 'id_rsa', 'id_rsa.pub', '.npmrc', '.netrc'];
    for (const file of sensitive) {
      if (fs.existsSync(path.join(projectPath, file))) {
        findings.push({
          severity: '🔴',
          category: 'sensitive-file',
          message: `Sensitive file \`${file}\` detected. Remove and add to .gitignore.`,
          file
        });
      }
    }
  }

  private findFiles(dir: string, pattern: RegExp, maxDepth = 4): string[] {
    const results: string[] = [];
    if (maxDepth <= 0) return results;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist'
          || entry.name === 'build' || entry.name === '.git') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.findFiles(fullPath, pattern, maxDepth - 1));
        } else if (pattern.test(entry.name)) {
          results.push(fullPath);
        }
      }
    } catch { /* skip */ }
    return results;
  }

  private groupBySeverity(findings: SecurityFinding[]): Record<string, SecurityFinding[]> {
    const grouped: Record<string, SecurityFinding[]> = {};
    for (const f of findings) {
      if (!grouped[f.severity]) grouped[f.severity] = [];
      grouped[f.severity].push(f);
    }
    return grouped;
  }
}

export const securityAgent = new SecurityAgent();
