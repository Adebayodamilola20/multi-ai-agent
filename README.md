# Multi-AI-Agent — Autonomous DevOps Command Center

## What Is This?

Multi-AI-Agent is a fully autonomous, voice-activated DevOps command center that lives on your macOS machine. It listens for GitHub webhooks, processes natural language commands through Discord (and voice via JARVIS), and orchestrates a team of specialized AI agents to perform code review, automated fixes, test execution, pull request creation, and multi-channel notifications.

Think of it as your always-on, AI-powered DevOps team that works while you sleep.

The system is built with TypeScript/Node.js, uses BullMQ + Redis for reliable task queuing, connects to GitHub via Octokit, and routes all agent intelligence through OpenAI-compatible LLMs (local or cloud). It also integrates deeply with macOS — it can open apps, take screenshots, type text, control your clipboard, and even speak responses through text-to-speech.

---

## The Agent Team

### Tom — Watcher & Manager
Tom has two roles. As **Watcher**, he sits on the Express server listening for GitHub webhooks (`push`, `pull_request`, `check_run`, `workflow_run`, `issues`). He converts every incoming event into a typed task and enqueues it in BullMQ. As **Manager**, Tom runs the worker process that picks tasks off the queue and delegates them to the right specialist agent. He orchestrates the entire pipeline, tracks task lifecycle, and posts status updates to Discord at every step.

- Receives GitHub webhooks at `POST /api/webhook`
- Verifies HMAC-SHA256 signatures for security
- Maps event types to task types (`push` → `review`, failed `check_run` → `fix`, etc.)
- Runs a cron fallback every 60 seconds for polling-based repos
- Manages task state: `pending → in-progress → completed/failed`
- Coordinates multi-step pipelines (review → fix → test → PR)

### Jim — Code Reviewer
Jim is an AI-powered code reviewer. When Tom delegates a `review` task, Jim pulls the GitHub diff via Octokit, sends each changed file's patch to the LLM with strict review instructions, and parses the structured JSON response into typed findings (`error | warning | info`). Each finding includes the file path, line number, severity, category, message, and a concrete suggestion.

- Reviews diffs for: logic bugs, TypeScript errors, missing imports, lint issues, security vulnerabilities, performance problems, broken error handling
- Posts findings to Discord: "error: 3, warnings: 5"
- Feeds findings into the fix pipeline if issues are found

### Sammy — The Fixer
Sammy is the autonomous fixer. When a `fix` task comes in (either from Jim's review findings or a direct command), Sammy:

1. Creates a `fix/<task-id>-<description>` branch (never touches `main`/`master`)
2. Reads each file from GitHub, sends it to the LLM with the review findings and user request
3. Gets back a complete fixed file with a confidence score
4. Commits all changes through the GitHub Contents API
5. If a file doesn't exist yet (e.g. user said "create .gitignore"), Sammy generates a new one from scratch

Key safeguards:
- **Never commits to `main` or `master`** — this is enforced at the GitHub service layer
- Always works in a dedicated `fix/` branch
- Reports confidence score (0-100%) for each fix

### Alexa — Tester & PR Creator
Alexa runs the full test pipeline on any branch:

1. `npm install`
2. `npm run build`
3. `npm run lint`
4. `npm test`

If any step fails, the pipeline stops and Alexa reports the failure to Discord. If all four pass, Alexa automatically creates a Pull Request. If the fix confidence is below 70%, the PR is created as a **draft** to signal human review is needed.

- Refuses to open a PR unless tests pass
- Creates detailed PR bodies with review context, test results, and confidence scores
- Draft PRs for low-confidence fixes

### Joe — Notifications & Reports
Joe handles all outbound communication. He sends lifecycle notifications (task started/completed/failed) to Discord and Slack, and generates detailed HTML email reports via Nodemailer with task summaries, review findings, error logs, and links.

- Discord webhooks with agent-specific emoji formatting
- Slack integration (optional)
- HTML email summaries with tables, error pre-blocks, and review finding lists
- Email reports for project scans, security scans, imports, and manual commands

### JARVIS — Voice-Activated Assistant
JARVIS is the macOS-native voice interface. He runs in an infinite loop:

1. Listens for the wake word **"Tom"** through your microphone (using `rec`/Sox)
2. Wakes up and says "Yes sir?"
3. Listens for a command (7-second window)
4. Sends the transcribed text (via Groq's Whisper API) to the LLM
5. The LLM returns a structured JSON plan: `{ action, target, reply }`
6. Executes the plan — which can be anything from opening an app to triggering a GitHub review

Supported voice commands:
- `open safari/chrome/vscode/discord/spotify` — launches macOS apps
- `open github.com/owner/repo` — opens URLs in browser
- `search for X on Google` — web search
- `review owner/repo` — triggers the full agent pipeline
- `type text` — simulates keyboard typing
- `screenshot` — takes a screenshot
- `system info` — shows macOS version, uptime, hostname
- `clipboard copy/get` — clipboard management
- `run <shell command>` — executes arbitrary shell commands
- `recent updates` — shows recent git commits and queue stats

JARVIS speaks back using TTS (VibeVoice via Python, with macOS `say` as fallback).

### Neo — The Vault Scribe
Neo logs everything into an **Obsidian vault**. If `OBSIDIAN_VAULT_PATH` is configured, Neo creates a structured knowledge base with:

- `Tasks/YYYY-MM-DD/task-xxxx.md` — per-task notes with events
- `Agents/Tom.md`, `Agents/Jim.md`, etc. — per-agent activity timelines
- `Repos/owner_repo.md` — per-repository activity logs
- `Discord/YYYY-MM-DD.md` — daily Discord conversation logs
- `Index.md` — a central hub linking everything together

This gives you a permanent, searchable, interlinked record of everything the system has done.

---

## Technical Architecture

### Core Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+, TypeScript 5.3 |
| Web Framework | Express 4 with rate limiting |
| Task Queue | BullMQ + Redis |
| AI Provider | OpenAI-compatible API (local Ollama or cloud) |
| Voice Transcription | Groq Whisper API |
| Text-to-Speech | VibeVoice (Python) / macOS `say` |
| GitHub API | Octokit REST v3 |
| Discord | discord.js v14 (Gateway Intents + Slash Commands) |
| Email | Nodemailer (SMTP) |
| Logging | Winston with daily rotation |
| Scheduling | node-cron (fallback polling) |

### Data Flow

```
GitHub Webhook → Tom Watcher → BullMQ Queue → Tom Manager
                                                     │
                        ┌────────────────────────────┼────────────────────────────┐
                        ▼                            ▼                            ▼
                    Jim Review                  Sammy Fix                   Alexa Test
                        │                            │                            │
                        └────────────────────────────┼────────────────────────────┘
                                                     ▼
                                              Alexa PR Creator
                                                     │
                                                     ▼
                                              Joe Notifications
                                          (Discord / Slack / Email)
                                                     │
                                                     ▼
                                              Neo (Obsidian Vault)
```

1. A GitHub event (push, PR, failed check run) hits the Express webhook endpoint
2. Tom Watcher validates the webhook signature, extracts context, and enqueues a typed task
3. Tom Manager picks up the task and routes it to the appropriate agent
4. For a typical pipeline: Jim reviews → if issues found → Sammy creates fix branch → Alexa tests → Alexa creates PR → Joe notifies
5. Neo logs every event to Obsidian for permanent record-keeping

### Queue Architecture

BullMQ provides reliable, persistent task queuing with:
- Redis-backed durability (tasks survive process restarts)
- Priority-based scheduling (failed checks run at priority 1, opened PRs at priority 2)
- Automatic retry with exponential backoff (2 attempts, 5s delay)
- Concurrency control (configurable via `QUEUE_CONCURRENCY`)
- Event listeners for Neo's Obsidian logging

### Webhook Security

All incoming webhooks are verified using HMAC-SHA256 signatures. The server reads the raw request body, computes the HMAC using `GITHUB_WEBHOOK_SECRET`, and compares it against the `x-hub-signature-256` header. Invalid signatures are rejected before any processing begins.

---

## API Endpoints

| Method | Route | Description |
|---|---|---|
| GET | `/health` | Service health check (queue counts, uptime) |
| GET | `/api/health` | Same as above, under API path |
| POST | `/api/webhook` | GitHub webhook receiver |

### Discord Slash Commands

| Command | Description |
|---|---|
| `/project-scan <project>` | Scan a project and get a full intelligence report |
| `/project-health <project>` | Check project health — stack, deps, env, deployment |
| `/render-status` | Check all Render deployment statuses |
| `/render-logs <service>` | Fetch logs from a Render service |
| `/github-clone <repo>` | Clone a public GitHub repo into local workspace |
| `/github-summary <repo>` | Get a README summary of a GitHub repo |
| `/security-scan <project>` | Scan a project for security issues |
| `/suggest-improvements <project>` | Get AI suggestions for project improvements |
| `/run-tests <project>` | Run the test pipeline on a project |
| `/send-report <project>` | Send an email report for a project |
| `/project-memory <project>` | Recall what we know about a project |
| `/watch-project <project>` | Start watching a project for changes |

Discord also supports natural language messages like:
- `Tom check owner/repo` — fetches and summarizes a README
- `Tom review owner/repo` — triggers code review
- `fix owner/repo` — creates a fix branch
- `test owner/repo` — runs the test pipeline
- `Tom list` — lists all your GitHub repos
- `scan my-project` — runs project intelligence
- `security check my-app` — runs a security scan

---

## Services

### GitHub Service
Wraps Octokit with typed methods for all GitHub interactions:
- Repository parsing (owner/repo), default branch detection
- Diff fetching with file filtering
- File content read/write via GitHub Contents API
- Branch creation (with main/master protection)
- Pull request creation (with draft support)
- Repository listing, README fetching, commit file listing, webhook management

### LLM Service
Abstracts the AI provider behind an OpenAI-compatible client:
- Defaults to a local Ollama instance (`http://localhost:11434/v1`)
- Configurable model (default: `qwen2.5-coder:7b`)
- Falls back through available providers

### Voice Service
macOS-native voice interface:
- Wake word detection ("Tom") via short audio samples (2-second listen loops)
- Command capture via SoX (`rec`) with configurable timeout
- Transcription via Groq's Whisper API (`whisper-large-v3`)
- Text-to-speech via VibeVoice Python script (with `say` CLI fallback)
- Concurrent playback management (kills previous audio on new speech)

### OS Service
macOS automation layer — executes system commands through AppleScript, shell, and macOS CLI tools:
- App launcher (Safari, Chrome, VSCode, Discord, Spotify, etc.)
- URL opener (handles http/https scheme inference)
- File opener (uses macOS `open` command)
- Shell command execution (30-second timeout)
- File search via Spotlight (`mdfind`)
- Clipboard read/write (`pbpaste`/`pbcopy`)
- Screenshot capture (`screencapture`)
- Keyboard simulation via AppleScript (`keystroke`)
- System info (hostname, macOS version, uptime)

### Discord Service
Full Discord bot integration:
- Gateway Intents for guild messages, DMs, and message content
- Slash command registration and handling
- Natural language message routing via LLM JSON router
- Conversation history tracking (last 20 messages per channel/user)
- Agent-specific emoji formatting (Tom=🟢, Jim=🔵, Sammy=🟠, Alexa=🟣, Joe=🔴)
- Handles: health checks, repo listing, README summarization, review/fix/test pipelines, revert operations, email summaries, and complex delegation
- Automatic reconnection with exponential backoff (5 retries)

### Obsidian Service
Knowledge base logging:
- Structured file organization (Tasks, Agents, Repos, Discord directories)
- Markdown notes with frontmatter metadata
- Cross-linked notes (Wiki-style `[[links]]`)
- Event timeline per task
- Daily Discord conversation logs

### Render Service
Render.com deployment management:
- Service listing and status checking
- Deploy trigger and history
- Log fetching
- Environment variable inspection

### Memory Service
Persistent project memory:
- JSON-backed storage at `~/.multi-agent-memory.json`
- Per-project entry history (last 100 entries)
- Supports: repo URLs, deploy URLs, tech stacks, errors, fixes, notes
- Searchable by project name or repo URL

### Email Service
SMTP email via Nodemailer:
- HTML and plain text email generation
- Configurable recipients (comma-separated)
- Graceful failure (logs warning, doesn't crash)

### Project Scanner
Deep local project analysis:
- Detects project type (Node.js, React, Express, Flutter, Python)
- Scans directory structure for frontend/backend files, API routes, database schemas
- Reads environment files for required variables
- Detects Docker, CI/CD, and test configuration
- Generates comprehensive `ProjectSummary` with dependency trees

---

## Security & Safeguards

The system implements multiple layers of safety:

1. **Branch protection**: Sammy and Alexa refuse to commit to or push `main`/`master` at the GitHub service level
2. **Fix branches**: All fixes go to `fix/<task-id>-<description>` branches
3. **Test gate**: Alexa refuses to create PRs unless all four pipeline steps pass
4. **Draft PRs**: PRs with confidence below 70% are created as drafts
5. **Webhook verification**: HMAC-SHA256 signature verification on all incoming webhooks
6. **Rate limiting**: Express rate limiter (120 requests per 60 seconds)
7. **Security scanning**: Alexa can scan projects for exposed `.env` files, missing `.gitignore`, insecure CORS configs, sensitive files, and risky dependencies
8. **Input validation**: All Discord commands are parsed through structured JSON routing with schema validation

---

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
```

Fill in `.env` with the required credentials:

| Variable | Description | Required |
|---|---|---|
| `GITHUB_TOKEN` | GitHub personal access token with repo scope | Yes |
| `GITHUB_WEBHOOK_SECRET` | Secret for webhook HMAC verification | Yes |
| `REDIS_URL` | Redis connection string | Yes |
| `DISCORD_BOT_TOKEN` | Discord bot token | Yes |
| `DISCORD_CHANNEL_ID` | Discord channel for notifications | Yes |
| `SMTP_USER` | SMTP username for email | Yes |
| `SMTP_PASS` | SMTP password for email | Yes |
| `EMAIL_FROM` | Sender email address | Yes |
| `EMAIL_TO` | Recipient email(s) | Yes |
| `OPENAI_API_KEY` | OpenAI/OpenAI-compatible API key | For cloud LLM |
| `GROQ_API_KEY` | Groq API key (for voice transcription) | For voice features |
| `OBSIDIAN_VAULT_PATH` | Path to Obsidian vault | For Neo logging |
| `RENDER_API_KEY` | Render.com API key | For deployment monitoring |
| `SLACK_BOT_TOKEN` | Slack bot token | Optional |
| `SLACK_CHANNEL_ID` | Slack channel ID | Optional |

### Development

```bash
npm run dev
```

Starts the server with hot-reload via `ts-node-dev`. The server exposes:
- `GET /health` — service and queue health
- `GET /api/health` — same health endpoint under API path
- `POST /api/webhook` — GitHub webhook receiver

### Production

```bash
npm run build
npm start
```

Redis must be running and reachable at the `REDIS_URL` configured in `.env`.

### Code Quality

```bash
npm run lint    # TypeScript strict compile check (tsc --noEmit)
npm test        # Jest test suite
```

---

## Project Structure

```
Multi-AI-Agent/
├── src/
│   ├── index.ts                    # Application entry point, bootstraps all agents
│   ├── config/
│   │   └── index.ts                # Environment configuration with validation
│   ├── agents/
│   │   ├── manager.agent.ts        # Tom — task routing and pipeline orchestration
│   │   ├── watcher.agent.ts        # Tom — webhook handler and task creation
│   │   ├── code-review.agent.ts    # Jim — AI-powered diff review
│   │   ├── fixer.agent.ts          # Sammy — autonomous code fixer
│   │   ├── test.agent.ts           # Alexa — test pipeline executor
│   │   ├── pull-request.agent.ts   # Alexa — PR creator
│   │   ├── email.agent.ts          # Joe — notifications (Discord/Slack)
│   │   ├── email-report.agent.ts   # Joe — HTML email reports
│   │   ├── jarvis.agent.ts         # JARVIS — voice command processor
│   │   ├── neo.agent.ts            # Neo — Obsidian vault logging
│   │   ├── memory.agent.ts         # Project memory recall
│   │   ├── discord.agent.ts        # Discord agent interface
│   │   ├── slack.agent.ts          # Slack notification agent
│   │   ├── project-intel.agent.ts  # Project intelligence scanning
│   │   ├── repo-import.agent.ts    # GitHub repo cloning and setup
│   │   ├── security.agent.ts       # Security vulnerability scanning
│   │   ├── suggestion.agent.ts     # AI improvement suggestions
│   │   ├── server-monitor.agent.ts # Render deployment monitoring
│   │   └── devops.agent.ts         # DevOps automation (redeploy, logs)
│   ├── services/
│   │   ├── github.service.ts       # Octokit GitHub API wrapper
│   │   ├── llm.service.ts          # OpenAI-compatible LLM client
│   │   ├── voice.service.ts        # Speech-to-text and TTS
│   │   ├── os.service.ts           # macOS automation layer
│   │   ├── discord.service.ts      # Discord bot with slash commands
│   │   ├── obsidian.service.ts     # Obsidian vault writer
│   │   ├── email.service.ts        # Nodemailer SMTP client
│   │   ├── memory.service.ts       # Persistent project memory store
│   │   ├── render.service.ts       # Render.com deployment API
│   │   ├── project-scanner.service.ts  # Local project analyzer
│   │   └── voice.service.ts        # Voice recording and playback
│   ├── queue/
│   │   └── task-queue.ts           # BullMQ task queue configuration
│   ├── server/
│   │   ├── app.ts                  # Express app setup with routes
│   │   ├── routes/
│   │   │   ├── health.ts           # Health check endpoint
│   │   │   └── webhook.ts          # GitHub webhook receiver
│   │   └── middleware/
│   │       ├── error-handler.ts    # Global error handler
│   │       └── webhook-verifier.ts # HMAC-SHA256 signature verification
│   ├── logger/
│   │   └── logger.ts              # Winston logger with agent context
│   └── types/
│       └── index.ts               # TypeScript type definitions
├── scripts/
│   └── tts_vibevoice.py           # Python TTS script for JARVIS
├── .env.example                    # Environment template
├── .gitignore                      # Git ignore rules
├── package.json                    # Dependencies and scripts
├── tsconfig.json                   # TypeScript configuration
└── README.md                       # This file
```

---

## Requirements

- **Node.js 18+** (ES2022 target)
- **Redis** (for BullMQ task queue)
- **macOS** (for OS service, voice, and TTS features)
- **SoX** (`brew install sox`) for voice recording
- **Python 3** with VibeVoice dependencies (for TTS)
- **Ollama** (optional, for local LLM inference)

---

## Pipeline Flow Example

When a developer pushes code to `owner/repo`:

1. GitHub sends a `push` webhook to `POST /api/webhook`
2. **Tom Watcher** verifies the signature, creates a `review` task with commit SHA and changed files, and enqueues it
3. **Tom Manager** picks up the task and calls **Jim Code Reviewer**
4. **Jim** fetches the diff via Octokit, sends each file to the LLM, and returns structured findings
5. If issues found: **Sammy Fixer** creates `fix/<task-id>-<description>` branch, generates fixes via LLM, and commits
6. **Tom Manager** chains a `test` task targeting the fix branch
7. **Alexa Tester** runs `npm install → build → lint → test` on the fix branch
8. If tests pass: **Alexa PR Creator** opens a PR (draft if confidence < 70%)
9. **Joe** posts every lifecycle event to Discord, Slack, and sends a final summary email
10. **Neo** logs everything to the Obsidian vault for permanent record

All of this happens automatically, without human intervention.

---

## License

MIT
Daily update Tue Jun  9 13:46:23 UTC 2026
