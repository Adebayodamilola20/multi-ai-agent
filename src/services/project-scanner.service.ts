import fs from 'fs';
import path from 'path';
import { createAgentLogger } from '../logger/logger';
import { ProjectSummary } from '../types';

const logger = createAgentLogger('project-scanner');

export class ProjectScannerService {
  async scan(projectPath: string): Promise<ProjectSummary> {
    const name = path.basename(projectPath);
    const summary: ProjectSummary = {
      name,
      path: projectPath,
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
      hasDockerfile: fs.existsSync(path.join(projectPath, 'Dockerfile')),
      hasCiCd: false,
      hasTests: false,
      readmePreview: ''
    };

    this.detectProjectType(projectPath, summary);
    this.scanDirectory(projectPath, projectPath, summary, 3);
    this.readEnvFiles(projectPath, summary);
    this.readReadme(projectPath, summary);

    summary.hasTests = summary.scripts?.test !== undefined
      || fs.existsSync(path.join(projectPath, '__tests__'))
      || fs.existsSync(path.join(projectPath, 'test'))
      || fs.existsSync(path.join(projectPath, 'tests'))
      || fs.existsSync(path.join(projectPath, 'jest.config.js'))
      || fs.existsSync(path.join(projectPath, 'jest.config.ts'));
    summary.hasCiCd = fs.existsSync(path.join(projectPath, '.github'))
      || fs.existsSync(path.join(projectPath, '.gitlab-ci.yml'))
      || fs.existsSync(path.join(projectPath, 'bitbucket-pipelines.yml'));

    return summary;
  }

  private detectProjectType(projectPath: string, summary: ProjectSummary): void {
    const hasPackageJson = fs.existsSync(path.join(projectPath, 'package.json'));
    const hasFlutter = fs.existsSync(path.join(projectPath, 'pubspec.yaml'));
    const hasPython = fs.existsSync(path.join(projectPath, 'requirements.txt'))
      || fs.existsSync(path.join(projectPath, 'setup.py'))
      || fs.existsSync(path.join(projectPath, 'Pipfile'));

    if (hasPackageJson) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8'));
        summary.dependencies = pkg.dependencies || {};
        summary.devDependencies = pkg.devDependencies || {};
        summary.scripts = pkg.scripts || {};
        summary.packageManager = fs.existsSync(path.join(projectPath, 'yarn.lock')) ? 'yarn' : 'npm';

        const deps = Object.keys(summary.dependencies).join(' ');
        const hasReact = deps.includes('react') || deps.includes('react-dom');
        const hasExpress = deps.includes('express');
        const hasNext = deps.includes('next');
        const hasVite = deps.includes('vite') || deps.includes('@vitejs');

        if (hasNext) summary.type = 'node';
        else if (hasVite && hasReact) summary.type = 'react';
        else if (hasReact) summary.type = 'react';
        else if (hasExpress) summary.type = 'express';
        else summary.type = 'node';
      } catch { /* ignore */ }
    } else if (hasFlutter) {
      summary.type = 'flutter';
      summary.packageManager = 'flutter';
    } else if (hasPython) {
      summary.type = 'python';
      summary.packageManager = 'pip';
    }
  }

  private scanDirectory(basePath: string, currentPath: string, summary: ProjectSummary, depth: number): void {
    if (depth <= 0) return;
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.git'
          || entry.name === 'build' || entry.name === 'dist' || entry.name === '.next'
          || entry.name === '__pycache__' || entry.name === '.dart_tool') continue;

        const fullPath = path.join(currentPath, entry.name);
        const relativePath = path.relative(basePath, fullPath);

        if (entry.isDirectory()) {
          this.scanDirectory(basePath, fullPath, summary, depth - 1);
        } else if (entry.isFile()) {
          this.classifyFile(relativePath, entry.name, summary);
        }
      }
    } catch { /* permission denied, skip */ }
  }

  private classifyFile(relativePath: string, fileName: string, summary: ProjectSummary): void {
    if (/\.(tsx?|jsx?)$/.test(fileName) && (relativePath.includes('/pages/') || relativePath.includes('/src/pages/')
      || relativePath.includes('/components/') || relativePath.includes('/views/')
      || relativePath.includes('/screens/') || relativePath.startsWith('pages/')
      || relativePath.startsWith('src/pages/'))) {
      summary.frontend.push(relativePath);
    }
    if (/\.(ts|js)$/.test(fileName) && (relativePath.includes('/api/') || relativePath.includes('/routes/')
      || relativePath.includes('/controllers/') || relativePath.includes('/middleware/'))) {
      summary.backend.push(relativePath);
    }
    if (relativePath.includes('/routes/') || relativePath.includes('/api/')) {
      summary.apiRoutes.push(relativePath);
    }
    if (/\.(sqlite|db|sql)$/.test(fileName) || relativePath.includes('/models/')
      || relativePath.includes('/migrations/') || relativePath.includes('/prisma/')
      || relativePath.includes('/schema')) {
      summary.database.push(relativePath);
    }
    if (/\.(json|yaml|yml|toml|ini|conf)$/.test(fileName) && !relativePath.includes('package-lock')
      && !relativePath.includes('yarn.lock')) {
      summary.config.push(relativePath);
    }
  }

  private readEnvFiles(projectPath: string, summary: ProjectSummary): void {
    const envFiles = ['.env', '.env.example', '.env.local', '.env.development', '.env.production'];
    for (const file of envFiles) {
      const filePath = path.join(projectPath, file);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const vars = content.split('\n')
            .filter(line => line.trim() && !line.startsWith('#'))
            .map(line => line.split('=')[0].trim())
            .filter(Boolean);
          summary.envVars.push(...vars.map(v => `${v} (from ${file})`));
        } catch { /* skip */ }
      }
    }
  }

  private readReadme(projectPath: string, summary: ProjectSummary): void {
    const readmeFiles = ['README.md', 'README.txt', 'README', 'Readme.md'];
    for (const file of readmeFiles) {
      const filePath = path.join(projectPath, file);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          summary.readmePreview = content.slice(0, 500);
          return;
        } catch { /* skip */ }
      }
    }
  }
}

export const projectScannerService = new ProjectScannerService();
