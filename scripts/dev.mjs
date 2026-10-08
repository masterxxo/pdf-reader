#!/usr/bin/env node
// One-command local dev environment: checks prerequisites, installs
// dependencies, then runs the API (wrangler dev) and the web app (Vite) together.
//
// Usage: pnpm dev:local

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const devVarsPath = join(root, 'apps/api/.dev.vars');
const devVarsExamplePath = join(root, 'apps/api/.dev.vars.example');

// Must match [dev] port in apps/api/wrangler.toml and server.port in vite.config.ts.
const API_URL = 'http://localhost:8787';
const WEB_URL = 'http://localhost:5173';

const isWindows = process.platform === 'win32';

function print(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`\n✖ ${message}\n\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      shell: isWindows,
      ...options,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? code}`));
    });
  });
}

// 1. Node version (from .nvmrc).
const requiredMajor = Number(readFileSync(join(root, '.nvmrc'), 'utf8').trim());
const currentMajor = Number(process.versions.node.split('.')[0]);
if (currentMajor < requiredMajor) {
  fail(`Node ${String(requiredMajor)}+ is required (found ${process.versions.node}). Run: nvm use`);
}

// 2. API secrets. The key itself is never printed; we only check that a value is set.
if (!existsSync(devVarsPath)) {
  copyFileSync(devVarsExamplePath, devVarsPath);
  fail(
    'Created apps/api/.dev.vars from the example.\n' +
      '  Put your Gemini API key in it (LLM_API_KEY=...) and run this command again.\n' +
      '  Get a key at https://aistudio.google.com/apikey',
  );
}
const hasApiKey = /^LLM_API_KEY=\S+/m.test(readFileSync(devVarsPath, 'utf8'));
if (!hasApiKey) {
  fail('LLM_API_KEY in apps/api/.dev.vars is empty. Add your Gemini API key and run again.');
}

// 3. Dependencies.
print('→ Installing dependencies…');
await run('pnpm', ['install']).catch((error) => fail(error.message));

// 4. API + web in parallel. VITE_API_URL points the web app at the local worker.
print(`\n→ Starting API on ${API_URL} and web app on ${WEB_URL} (Ctrl+C to stop)\n`);
await run('pnpm', ['-r', '--parallel', 'dev'], {
  env: { ...process.env, VITE_API_URL: API_URL },
}).catch((error) => fail(error.message));
