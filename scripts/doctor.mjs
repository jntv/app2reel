#!/usr/bin/env node
/** Read-only installation checks. Uses Node built-ins so it also works before install. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: node scripts/doctor.mjs [--help]

Check Node.js, project dependencies, Chromium, FFmpeg, and optional Codex/voice setup.
You can also run pnpm run doctor or npm run doctor after installing dependencies.

This command does not install software, download models, launch a browser, or change
your Codex sign-in. Codex is checked only through --version, login status and exec
--help; this script never opens credential files or prints raw CLI output.

Exit codes: 0 = core local runtime ready (optional warnings are allowed),
            1 = a required local dependency needs attention, 2 = invalid arguments.`);
  process.exit(0);
}
if (args.length) {
  console.error('Unknown arguments. Run node scripts/doctor.mjs --help.');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
let failures = 0;
const report = (status, label, message, remedy) => {
  console.log(`[${status}] ${label}: ${message}`);
  if (remedy) console.log(`       ${remedy}`);
  if (status === 'FAIL') failures += 1;
};
const run = (binary, arguments_, env = process.env) => spawnSync(binary, arguments_, {
  cwd: root, env, shell: false, windowsHide: true, encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'], timeout: 5_000, maxBuffer: 256 * 1024,
});

console.log('App2Reel installation check\n');
const [major, minor] = process.versions.node.split('.').map(Number);
const supportedNode = major > 22 || (major === 22 && minor >= 13);
report(supportedNode ? 'OK' : 'FAIL', 'Node.js', process.versions.node,
  supportedNode ? undefined : 'Install Node.js 22.13 or newer, then rerun this command.');

let manifest;
try { manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')); }
catch { report('FAIL', 'Project files', 'Cannot read package.json.', 'Run this script from a complete App2Reel checkout.'); }
if (manifest) {
  const dependencies = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  const missing = dependencies.filter(name => {
    try { require.resolve(name); return false; } catch {
      // Type-only packages have no JavaScript entry point.
      try { require.resolve(`${name}/package.json`); return false; } catch { return true; }
    }
  });
  report(missing.length ? 'FAIL' : 'OK', 'Dependencies', missing.length
    ? `Missing or unresolved: ${missing.join(', ')}.` : 'Project packages resolve.',
  missing.length ? 'Install the pnpm version in package.json, then run pnpm install --frozen-lockfile.' : undefined);
}

try {
  const { chromium } = require('playwright');
  const present = existsSync(chromium.executablePath());
  report(present ? 'OK' : 'FAIL', 'Chromium', present ? 'Playwright browser is installed.' : 'Playwright browser is missing.',
    present ? undefined : 'Run pnpm run setup. On Linux, use pnpm exec playwright install --with-deps chromium.');
} catch {
  report('FAIL', 'Chromium', 'Playwright cannot be loaded.', 'Run pnpm install --frozen-lockfile, then pnpm run setup.');
}

let ffmpeg = process.env.FFMPEG_PATH;
if (!ffmpeg) {
  try { ffmpeg = require('ffmpeg-static'); } catch { /* A system FFmpeg can still work. */ }
}
const ffmpegResult = run(ffmpeg || 'ffmpeg', ['-version']);
report(ffmpegResult.status === 0 ? 'OK' : 'FAIL', 'FFmpeg', ffmpegResult.status === 0
  ? 'Video encoder responds.' : process.env.FFMPEG_PATH ? 'FFMPEG_PATH does not point to a working encoder.' : 'Video encoder is unavailable.',
ffmpegResult.status === 0 ? undefined
  : 'Run pnpm install --frozen-lockfile (ffmpeg-static build is approved), or set FFMPEG_PATH to a working FFmpeg executable.');

// Keep the same credential boundary as server/ai.ts. The CLI owns its credentials.
const codexEnv = {};
for (const name of [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'TMP', 'TEMP',
  'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE',
  'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR',
  'DBUS_SESSION_BUS_ADDRESS', 'CODEX_HOME', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY',
  'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
]) if (process.env[name]) codexEnv[name] = process.env[name];
codexEnv.NO_COLOR = '1';
const candidates = process.env.CODEX_BIN ? [process.env.CODEX_BIN] : [
  'codex',
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
  '/Applications/Codex.app/Contents/Resources/codex',
  path.join(homedir(), 'Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'),
];
const codex = candidates.find(binary => {
  const result = run(binary, ['--version'], codexEnv);
  return result.status === 0 && /codex/i.test(`${result.stdout}${result.stderr}`);
});
if (!codex) {
  report('WARN', 'Codex (optional for sample)', 'No supported Codex CLI was found.',
    'For AI exploration, install Codex CLI and sign in with ChatGPT. Set CODEX_BIN for a custom installation.');
} else {
  const help = run(codex, ['exec', '--help'], codexEnv);
  const flags = ['--ignore-user-config', '--ignore-rules', '--ephemeral', '--output-schema'];
  const capable = help.status === 0 && flags.every(flag => help.stdout.includes(flag));
  report(capable ? 'OK' : 'WARN', 'Codex CLI', capable ? 'Required isolated-run options are available.' : 'Required isolated-run options are unavailable.',
    capable ? undefined : 'Upgrade Codex CLI before using AI exploration. The bundled sample remains available.');
  const login = run(codex, ['login', 'status'], codexEnv);
  const detail = `${login.stdout}${login.stderr}`;
  const connected = login.status === 0 && /logged.in.using.chatgpt/i.test(detail);
  report(connected ? 'OK' : 'WARN', 'ChatGPT sign-in', connected ? 'Codex reports a ChatGPT session. Plan access and usage limits still apply.'
    : /api.key/i.test(detail) ? 'Codex reports an API-key session; App2Reel requires a ChatGPT session for AI exploration.' : 'No ChatGPT session could be verified.',
  connected ? undefined : 'Review codex login status in your terminal and sign in with ChatGPT when ready. This command does not change sign-in.');
}

const pythonCandidates = process.env.CAPTURE_PYTHON ? [process.env.CAPTURE_PYTHON] : ['python3.12', 'python3.13', 'python3'];
const python = pythonCandidates.find(binary => {
  const result = run(binary, ['--version']);
  return result.status === 0 && /Python 3\.(12|13)\./.test(`${result.stdout}${result.stderr}`);
});
report(python ? 'OK' : 'WARN', 'Natural voices (optional)', python ? 'Python 3.12 or 3.13 is available; model setup is separate.' : 'Python 3.12 or 3.13 was not found.',
  python ? 'Choose a local voice in the studio, or run pnpm run setup:voice to download its runtime and model.'
    : 'For natural voices, install Python 3.12 or 3.13 (or set CAPTURE_PYTHON), then run pnpm run setup:voice.');

console.log(failures ? `\n${failures} required check(s) need attention. Follow the remedies above, then rerun doctor.`
  : '\nCore runtime is ready. Run pnpm dev and try the bundled sample.');
process.exitCode = failures ? 1 : 0;
