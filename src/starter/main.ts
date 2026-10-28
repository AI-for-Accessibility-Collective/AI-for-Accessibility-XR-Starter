// `bun run dev` starts here.
//
//   bun run dev                                  runs src/app.ts
//   bun run dev examples/2-what-do-you-see.ts    runs an example instead
//
// In dev mode Bun restarts the server when you save a file. The phone and
// the simulator reconnect on their own and carry on.

import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.ts';
import { haltGemini, onGeminiHalt } from './gemini.ts';
import { pairingLink, pairingToken, phoneAddress, qrTerminal } from './network.ts';
import { Runtime } from './runtime.ts';
import { startServer } from './server.ts';
import { hasFfmpeg } from './speech-out.ts';
import { openProfileStore } from '../toolkit/profile.ts';
import type { AppDefinition } from './index.ts';

const appArg = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'src/app.ts';
const appPath = resolve(appArg);
if (!existsSync(appPath)) {
  console.error(`\nCannot find ${appArg}. Pass the path to your app, for example:\n  bun run dev examples/1-hello.ts\n`);
  process.exit(1);
}

const app = (await import(appPath)).default as AppDefinition | undefined;
if (!app || typeof app !== 'object' || typeof app.name !== 'string') {
  console.error(`\n${appArg} must end with:  export default defineApp({ name: '...', ... })\n`);
  process.exit(1);
}

mkdirSync(config.dataDir, { recursive: true });
const store = await openProfileStore(config.dataDir);
const runtime = new Runtime(app, store, appArg);
const token = pairingToken();

onGeminiHalt((reason) => {
  runtime.log('error', `Gemini switched off: ${reason}`);
  runtime.stop('Stopped: Gemini was switched off', 'other');
});

let server: ReturnType<typeof startServer>;
try {
  server = startServer({ runtime, store, port: config.port, token });
} catch (e) {
  const busy = /in use|EADDRINUSE/i.test(String((e as Error)?.message ?? e));
  console.error(
    busy
      ? `\nPort ${config.port} is already in use. Is the starter already running in another terminal?\nStop it, or set PORT=${config.port + 1} in .env.\n`
      : `\nThe server could not start: ${e instanceof Error ? e.message : e}\n`,
  );
  process.exit(1);
}

// Keep running whatever an app does. A crash would drop the glasses mid-session.
process.on('unhandledRejection', (e) => runtime.log('error', `Unhandled error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`));
process.on('uncaughtException', (e) => runtime.log('error', `Uncaught error: ${e.stack ?? e.message}`));

function shutdown(why: string): void {
  haltGemini(`the server was stopped (${why})`);
  runtime.stop('Stopped: the server is shutting down', 'other');
  setTimeout(() => {
    server.stop(true);
    process.exit(0);
  }, 300);
}
process.on('SIGINT', () => shutdown('Ctrl-C'));
process.on('SIGTERM', () => shutdown('terminated'));

const addr = phoneAddress(config.port);
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
console.log(`
${bold(`▶ ${app.name}`)}  (${appArg})

  Dashboard:   ${bold(`http://localhost:${config.port}`)}   open it in your browser
  Phone uses:  ${addr.url ?? '(no network found)'}   ${addr.how === 'wifi' ? '(this laptop on Wi-Fi)' : addr.how === 'tunnel' ? '(the tunnel)' : addr.how === 'PUBLIC_URL' ? '(PUBLIC_URL in .env)' : ''}
  Pairing code: ${token}
${!config.geminiApiKey ? `\n  ${bold('! GEMINI_API_KEY is missing from .env.')} Speech-to-text and g.ai will not work until you add it.\n` : ''}${!hasFfmpeg ? '  (ffmpeg not found: voice clips are sent as WAV, which is fine, just bigger.)\n' : ''}
  Stop with Ctrl-C.
`);
if (addr.url && process.stdout.isTTY) {
  console.log('  Scan with the phone camera to connect the glasses:\n');
  console.log((await qrTerminal(pairingLink(addr.url, token))).replace(/^/gm, '    '));
}
