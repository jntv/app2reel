import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'app2reel-doctor-'));
  await mkdir(path.join(root, 'scripts'));
  await copyFile(path.resolve('scripts/doctor.mjs'), path.join(root, 'scripts/doctor.mjs'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { playwright: '0.0.0', 'ffmpeg-static': '0.0.0' } }));
  const environment = {
    ...process.env, CODEX_BIN: path.join(root, 'missing-codex'),
    FFMPEG_PATH: path.join(root, 'missing-ffmpeg'), CAPTURE_PYTHON: path.join(root, 'missing-python'),
  };
  const run = (args: string[] = []) => spawnSync(process.execPath, [path.join(root, 'scripts/doctor.mjs'), ...args], {
    cwd: tmpdir(), env: environment, encoding: 'utf8', timeout: 15000,
  });
  return { root, environment, run };
}

test('doctor can explain usage before dependencies are installed without running checks', async () => {
  const { root, run } = await fixture();
  try {
    const result = run(['--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /does not install software/);
    assert.doesNotMatch(result.stdout, /\[FAIL\]/);
    assert.deepEqual((await readdir(root)).sort(), ['package.json', 'scripts']);
    assert.equal(run(['--unknown']).status, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('doctor reports missing dependencies with actionable remedies instead of crashing', async () => {
  const { root, run } = await fixture();
  try {
    const result = run();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /\[FAIL\] Dependencies: Missing or unresolved/);
    assert.match(result.stdout, /pnpm install --frozen-lockfile/);
    assert.match(result.stdout, /FFMPEG_PATH does not point to a working encoder/);
    assert.match(result.stdout, /\[WARN\] Codex/);
    assert.equal(result.stderr, '');
    assert.deepEqual((await readdir(root)).sort(), ['package.json', 'scripts']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('doctor only queries Codex status and capabilities, strips API keys, and permits optional warnings', { skip: process.platform === 'win32' }, async () => {
  const { root, environment, run } = await fixture();
  try {
    const browser = path.join(root, 'chromium');
    await writeFile(browser, 'browser fixture');
    for (const [name, source] of [
      ['playwright', `module.exports = { chromium: { executablePath: () => ${JSON.stringify(browser)} } };`],
      ['ffmpeg-static', 'module.exports = null;'],
    ]) {
      const directory = path.join(root, 'node_modules', name);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'index.js'), source);
    }
    const commands = path.join(root, 'commands.jsonl');
    const codex = path.join(root, 'codex');
    await writeFile(codex, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(commands)}, JSON.stringify({ args, apiKey: process.env.OPENAI_API_KEY, nestedSession: process.env.CODEX_SESSION_ID }) + '\\n');
console.error('private-output-must-not-appear');
if (args.join(' ') === '--version') console.log('codex-cli fixture');
else if (args.join(' ') === 'exec --help') console.log('--ignore-user-config --ignore-rules --ephemeral --output-schema');
else if (args.join(' ') === 'login status') console.log('Logged in using ChatGPT');
else process.exit(99);
`);
    const ffmpeg = path.join(root, 'ffmpeg');
    await writeFile(ffmpeg, `#!${process.execPath}\nprocess.exit(process.argv[2] === '-version' ? 0 : 99);\n`);
    await chmod(codex, 0o700);
    await chmod(ffmpeg, 0o700);
    Object.assign(environment, { CODEX_BIN: codex, FFMPEG_PATH: ffmpeg, OPENAI_API_KEY: 'doctor-test-secret', CODEX_SESSION_ID: 'nested-session' });
    const result = run();
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /Core runtime is ready/);
    assert.match(result.stdout, /\[OK\] ChatGPT sign-in/);
    assert.match(result.stdout, /\[WARN\] Natural voices/);
    assert.doesNotMatch(result.stdout + result.stderr, /private-output|doctor-test-secret|nested-session/);
    const invocations = (await readFile(commands, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(invocations.map(item => item.args), [['--version'], ['exec', '--help'], ['login', 'status']]);
    assert.ok(invocations.every(item => !item.apiKey && !item.nestedSession));
    assert.ok(!(await readdir(root)).includes('.capture'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
