#!/usr/bin/env node
/**
 * Runs a command with the repository's .env loaded, so the Java ledger service
 * and the Python intelligence service see the same DEMO_MODE, token, database
 * and model settings as the Express server (which loads .env itself).
 *
 *   node scripts/with-env.mjs ./mvnw -q spring-boot:run
 *
 * Variables already present in the environment win over the file, matching
 * `node --env-file-if-exists`.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const envFile = path.resolve(import.meta.dirname, '..', '.env');
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (err) {
    console.warn(`[with-env] could not read ${envFile}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: node scripts/with-env.mjs <command> [args...]');
  process.exit(64);
}

const child = spawn(command, args, { stdio: 'inherit', env: process.env });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', (err) => {
  console.error(`[with-env] could not start ${command}: ${err.message}`);
  process.exit(127);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
