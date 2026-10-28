// bun run tunnel: give this laptop a public https address, so the phone can
// reach it from other networks. Run it in a second terminal, next to `bun run dev`.
//
// It uses a free Cloudflare quick tunnel (no account). The address changes
// each time you start the tunnel, so leave this running while you work.
// While it runs, the dashboard's QR code points at the tunnel.

import { config } from '../src/starter/config.ts';
import { pairingLink, pairingToken, qrTerminal, writeTunnel } from '../src/starter/network.ts';

if (!Bun.which('cloudflared')) {
  console.error(`
The tunnel needs cloudflared, a small free program from Cloudflare.

  macOS:    brew install cloudflared
  Windows:  winget install --id Cloudflare.cloudflared
  Linux:    https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

Then run  bun run tunnel  again.
`);
  process.exit(1);
}

const local = `http://localhost:${config.port}`;
console.log(`Starting a tunnel to ${local} …`);
const proc = Bun.spawn(['cloudflared', 'tunnel', '--no-autoupdate', '--url', local], { stdout: 'pipe', stderr: 'pipe' });

let found = false;
async function watch(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    const text = decoder.decode(chunk);
    const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text)?.[0];
    if (url && !found) {
      found = true;
      writeTunnel(url);
      const token = pairingToken();
      console.log(`
\x1b[1mTunnel ready:\x1b[0m ${url}

The dashboard's QR code now uses it. Keep this terminal open.
Pairing code: ${token}
`);
      console.log((await qrTerminal(pairingLink(url, token))).replace(/^/gm, '    '));
    }
    if (/ERR|error/i.test(text) && !/Cannot determine default configuration path/.test(text)) {
      for (const line of text.split('\n').filter((l) => /ERR|error/i.test(l))) console.log(`  [cloudflared] ${line.trim()}`);
    }
  }
}
void watch(proc.stderr);
void watch(proc.stdout);

const end = (code: number) => {
  writeTunnel(null);
  process.exit(code);
};
process.on('SIGINT', () => {
  proc.kill();
  end(0);
});
process.on('SIGTERM', () => {
  proc.kill();
  end(0);
});
const code = await proc.exited;
console.log(`cloudflared stopped (exit ${code}). The phone can no longer use the tunnel address.`);
end(code ?? 1);
