import fs from 'fs';
import path from 'path';
import { createAgentLogger } from '../logger/logger';
import { MemoryEntry } from '../types';

const logger = createAgentLogger('memory-service');

export class MemoryService {
  private filePath: string;
  private data: Record<string, MemoryEntry[]> = {};

  constructor() {
    this.filePath = path.join(process.env.HOME || '/tmp', '.multi-agent-memory.json');
    this.load();
    logger.info('Memory service initialized', { filePath: this.filePath });
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch {
      this.data = {};
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      logger.warn('Failed to save memory', { error: (error as Error).message });
    }
  }

  rememberProject(name: string, entry: Partial<MemoryEntry>): void {
    if (!this.data[name]) this.data[name] = [];
    this.data[name].push({
      projectName: name,
      timestamp: new Date().toISOString(),
      ...entry
    } as MemoryEntry);
    if (this.data[name].length > 100) this.data[name] = this.data[name].slice(-100);
    this.save();
  }

  getProjectMemory(name: string): MemoryEntry[] | null {
    return this.data[name] || null;
  }

  getAllProjects(): string[] {
    return Object.keys(this.data);
  }

  getLatest(project: string): MemoryEntry | null {
    const entries = this.data[project];
    if (!entries || entries.length === 0) return null;
    return entries[entries.length - 1];
  }

  searchByRepo(repoUrl: string): MemoryEntry | null {
    for (const entries of Object.values(this.data)) {
      for (const entry of entries) {
        if (entry.repoUrl === repoUrl) return entry;
      }
    }
    return null;
  }
}

export const memoryService = new MemoryService();
