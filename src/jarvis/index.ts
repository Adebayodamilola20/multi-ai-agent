import 'dotenv/config';
import readline from 'readline';
import { createAgentLogger } from '../logger/logger';
import { commandRouter } from './command-router';
import { brainService } from './brain.service';
import { ChatMessage } from './brain.service';

const logger = createAgentLogger('jarvis');

/**
 * Jarvis — text input mode (Milestone 1).
 *
 * Pipeline:  input → CommandRouter → (local desktop tool | BrainService) → reply
 * Microphone / STT / TTS plug in on top of this loop later.
 */

const history: ChatMessage[] = [];
const MAX_HISTORY = 12; // keep the last few turns for context

async function handle(input: string): Promise<void> {
  const text = input.trim();
  if (!text) return;

  try {
    const result = await commandRouter.route(text, history);

    // Speak/print the short reply.
    console.log(`\n🤖 ${result.reply}`);
    if (result.detail) {
      console.log(`\n${result.detail}\n`);
    }

    // Remember the turn so general questions have context.
    history.push({ role: 'user', content: text });
    history.push({ role: 'assistant', content: result.reply });
    while (history.length > MAX_HISTORY) history.shift();

    logger.info('Turn complete', { intent: result.intent });
  } catch (error) {
    const msg = (error as Error).message;
    logger.error('Pipeline error', { error: msg });
    console.log(`\n🤖 Something went wrong: ${msg}`);
  }
}

async function main(): Promise<void> {
  console.log('\n  J A R V I S  —  text mode');
  console.log(`  brain: ${brainService.provider} (${brainService.model})`);
  console.log('  Try: "open VS Code"  ·  "search YouTube for React tutorials"  ·  "what can you do?"');
  console.log('  Type "exit" to quit.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '🗣️  ' });

  // Serialize input: pause the stream while a command is in flight so commands
  // never interleave, and so EOF (piped input / Ctrl-D) can't close mid-turn.
  const queue: string[] = [];
  let closed = false;
  let draining = false;

  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    // The queue itself serializes commands, so they never interleave.
    while (queue.length > 0) {
      const next = queue.shift() as string;
      await handle(next);
    }
    draining = false;
    if (closed) {
      console.log('\n🤖 Goodbye, Stephen.\n');
      process.exit(0);
    }
    rl.prompt();
  };

  rl.prompt();
  rl.on('line', (line) => {
    const text = line.trim();
    if (text.toLowerCase() === 'exit' || text.toLowerCase() === 'quit') {
      closed = true;
      rl.close();
      return;
    }
    queue.push(text);
    void drain();
  });

  rl.on('close', () => {
    closed = true;
    void drain();
  });
}

void main();
