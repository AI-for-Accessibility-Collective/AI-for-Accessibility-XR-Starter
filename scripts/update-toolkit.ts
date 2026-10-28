// bun run update-toolkit: refresh the copy of the toolkit in vendor/.
//
// The starter carries a pinned copy of the AI for Accessibility Toolkit
// package, so `bun install` is enough. This replaces it with the
// toolkit's latest main branch: from a checkout next to this repo
// (../AI-for-Accessibility-Toolkit) when there is one, else a fresh clone.
//
//   bun run update-toolkit              latest main
//   bun run update-toolkit <commit>     a specific commit

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = 'https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit';
// What the package needs at run time (its package.json "files"), plus its licence.
const PARTS = ['index.js', 'core', 'ports', 'sync', 'surfaces', 'platforms', 'registry', 'protocol', 'skills', 'types', 'README.md', 'package.json'];
const target = resolve('vendor/ai4a11y-toolkit');
const ref = process.argv[2];

const git = (args: string[], cwd?: string) => {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString().trim();
};

let source = resolve('../AI-for-Accessibility-Toolkit');
if (existsSync(join(source, 'toolkit', 'index.js')) && !ref) {
  console.log(`Using the checkout at ${source}`);
  git(['pull', '--ff-only'], source);
} else {
  source = resolve('.cache/toolkit-src');
  rmSync(source, { recursive: true, force: true });
  mkdirSync(source, { recursive: true });
  console.log(`Cloning ${REPO} …`);
  git(['clone', '--quiet', REPO, source]);
  if (ref) git(['checkout', '--quiet', ref], source);
}
const sha = git(['rev-parse', 'HEAD'], source);
const date = git(['log', '-1', '--format=%cs', 'HEAD'], source);

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const part of PARTS) cpSync(join(source, 'toolkit', part), join(target, part), { recursive: true });
cpSync(join(source, 'LICENSE'), join(target, 'LICENSE'));
writeFileSync(
  join(target, 'VENDORED.md'),
  `# Vendored copy of the AI for Accessibility Toolkit

This folder is the \`toolkit/\` package of
[AI-for-Accessibility-Toolkit](${REPO}),
copied unchanged at commit \`${sha}\` (${date}). Apache 2.0, see LICENSE.

To change the toolkit, make the change in that repository. To refresh this
copy, run \`bun run update-toolkit\`, then \`bun install\` and \`bun test\`.
`,
);
console.log(`\nvendor/ai4a11y-toolkit is now at ${sha.slice(0, 7)} (${date}).\nNext: bun install && bun test`);
