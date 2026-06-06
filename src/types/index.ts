export type TaskType = 'review' | 'fix' | 'test' | 'pr' | 'email' | 'notify' | 'project-scan' | 'repo-import' | 'server-monitor' | 'suggestion' | 'security-scan' | 'devops';

export type TaskStatus = 'pending' | 'in-progress' | 'completed' | 'failed';

export type EventType = 'push' | 'pull_request' | 'check_run' | 'workflow_run' | 'issues' | 'ping' | 'slash_command' | 'delegate';

export interface TaskPayload {
  repository: string;
  branch: string;
  commitSha: string;
  files?: string[];
  errors?: string[];
  eventType: string;
  issueNumber?: number;
  prNumber?: number;
  title?: string;
  description?: string;
  baseBranch?: string;
  fixBranch?: string;
  reviewResults?: ReviewResult[];
  testResults?: TestResults;
  prUrl?: string;
  summary?: string;
  confidence?: number;
  projectPath?: string;
  repoUrl?: string;
  serviceId?: string;
  agentResponse?: string;
  userMessage?: string;
}

export interface Task {
  id: string;
  type: TaskType;
  priority: number;
  payload: TaskPayload;
  status: TaskStatus;
  createdAt: Date;
  updatedAt: Date;
  result?: TaskResult;
}

export interface TaskResult {
  success: boolean;
  output?: string;
  error?: string;
  branchName?: string;
  commitSha?: string;
  prUrl?: string;
  reviewResults?: ReviewResult[];
  confidence?: number;
  testResults?: TestResults;
}

export interface ReviewResult {
  file: string;
  line: number;
  severity: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  suggestion: string;
}

export interface WebhookEvent {
  type: EventType;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  signature: string;
}

export interface DiscordEvent {
  event: 'agent:start' | 'agent:complete' | 'agent:error';
  agent: 'tom' | 'jim' | 'sammy' | 'alexa' | 'joe';
  taskId: string;
  repository: string;
  branch: string;
  message: string;
  timestamp: Date;
}

export interface EmailData {
  subject: string;
  html: string;
  text: string;
  to: string[];
}

export interface GitHubRepository {
  owner: string;
  repo: string;
  defaultBranch: string;
}

export interface GitHubFile {
  path: string;
  content: string;
  sha: string;
}

export interface GitHubDiff {
  file: string;
  patch: string;
  additions: number;
  deletions: number;
}

export interface CheckRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
  output?: {
    title: string;
    summary: string;
    text: string;
  };
}

export interface TestResults {
  install: CommandResult;
  build: CommandResult;
  lint: CommandResult;
  test: CommandResult;
  passed: boolean;
}

export interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface PullRequestData {
  title: string;
  body: string;
  head: string;
  base: string;
  draft: boolean;
}

export interface ProjectSummary {
  name: string;
  path: string;
  type: 'node' | 'react' | 'express' | 'flutter' | 'python' | 'unknown';
  frontend: string[];
  backend: string[];
  apiRoutes: string[];
  database: string[];
  config: string[];
  envVars: string[];
  packageManager: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  hasDockerfile: boolean;
  hasCiCd: boolean;
  hasTests: boolean;
  deployUrl?: string;
  repoUrl?: string;
  readmePreview: string;
}

export interface MemoryEntry {
  projectName: string;
  repoUrl?: string;
  deployUrl?: string;
  stack?: string[];
  errors?: string[];
  fixes?: string[];
  tasks?: string[];
  notes?: string;
  timestamp: string;
}

export interface RenderServiceInfo {
  id: string;
  name: string;
  type: string;
  ownerId: string;
  repo: string;
  serviceDetails: {
    env: string;
    plan: string;
    region: string;
    branch: string;
    url: string;
    healthCheckPath: string;
    autoDeploy: boolean;
  };
}

export interface RenderDeployInfo {
  id: string;
  commit: {
    message: string;
    createdAt: string;
  };
  status: 'created' | 'build_in_progress' | 'update_in_progress' | 'live' | 'deactivated' | 'build_failed' | 'update_failed' | 'canceled';
  finishedAt: string | null;
}

export type AgentName = 'Tom' | 'Jim' | 'Sammy' | 'Alexa' | 'Joe';
