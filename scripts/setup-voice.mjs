#!/usr/bin/env node
/** Install the selected local voice once. Rendering never fetches models. */
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arguments_ = process.argv.slice(2);
let directory = process.env.CAPTURE_VOICE_DIR || '.capture/voice-runtime';
let statusOnly = false, voice = 'melo_india';
for (let index = 0; index < arguments_.length; index += 1) {
  if (arguments_[index] === '--dir' && arguments_[index + 1]) directory = arguments_[++index];
  else if (arguments_[index] === '--voice' && arguments_[index + 1]) voice = arguments_[++index];
  else if (arguments_[index] === '--status') statusOnly = true;
  else throw new Error('Usage: node scripts/setup-voice.mjs [--dir path] [--voice melo_india|af_heart|am_michael] [--status]');
}
if (!['melo_india', 'af_heart', 'am_michael'].includes(voice)) throw new Error('Choose melo_india, af_heart or am_michael.');
const indian = voice === 'melo_india';
directory = path.resolve(directory);
const venvPython = path.join(directory, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const requirements = path.join(path.dirname(fileURLToPath(import.meta.url)), 'voice-requirements.txt');
const allVersions = Object.fromEntries((await readFile(requirements, 'utf8')).split(/\r?\n/).filter(line => /^[a-z][a-z0-9_-]*==\S+$/i.test(line)).map(line => line.split('==')));
const excluded = indian ? ['kokoro-onnx', 'onnxruntime'] : ['sherpa-onnx', 'sherpa-onnx-core'];
const versions = Object.fromEntries(Object.entries(allVersions).filter(([name]) => !excluded.includes(name)));
const kokoroAssets = [
  { name: 'kokoro-v1.0.onnx', bytes: 325505369, sha256: 'beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a' },
  { name: 'voices-v1.0.bin', bytes: 28214398, sha256: 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d' },
].map(asset => ({...asset, url: `https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/${asset.name}`}));
const meloAssets = [
  { name: 'model.onnx', bytes: 170604201, sha256: '5f72fbbc4105b008de8141049c0535b7a99a527ddb80fcbc0c0ac8a046997544' },
  { name: 'tokens.txt', bytes: 1440, sha256: '96026b19956133d23b7048c0e75466d061f31dea4e848315689259876b531376' },
  { name: 'lexicon.txt', bytes: 4814824, sha256: 'd9180223df27dc6addafbcc2a4236388ebd170d22df89ac7008a24448d37906b' },
  { name: 'LICENSE', bytes: 1053, sha256: '88a50e5a02bbc2a5c2f084dc19da751aa97b1690f5fda76cd8005c8634d1ca70' },
  { name: 'README.md', bytes: 257, sha256: 'ae6e44dead53dfdbd5b4a77106226f3118eb910222b46cb5533a3860773fc6c7' },
].map(asset => ({...asset, name: `melo-en/${asset.name}`}));
const meloArchive = {name: 'vits-melo-tts-en.tar.bz2', bytes: 162758237, sha256: 'f87bc5752ea3ec34273a2cc0c5086854c18b6b89dfd0534b5248e86a14cedb5d', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-en.tar.bz2'};
const assets = indian ? meloAssets : kokoroAssets;
const markerFile = path.join(directory, indian ? '.melo-installed.json' : '.installed.json');
const report = (stage, message, progress, extra = {}) => process.stdout.write(`${JSON.stringify({ stage, message, progress, voice, ...extra })}\n`);
const exists = async file => access(file).then(() => true, () => false);
async function hash(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
function pythonVersion(command) {
  const result = spawnSync(command, ['-c', 'import json,sys;print(json.dumps(list(sys.version_info[:3])))'], { encoding: 'utf8', timeout: 15000 });
  try { const version = JSON.parse(result.stdout); return result.status === 0 && version[0] === 3 && version[1] >= 12 && version[1] <= 13 ? version : undefined; } catch { return undefined; }
}
function installedVersions() {
  const imports = indian ? 'import sherpa_onnx,numpy,phonemizer,espeakng_loader' : 'import kokoro_onnx,numpy,onnxruntime';
  const result = spawnSync(venvPython, ['-c', `import json,importlib.metadata;${imports};print(json.dumps({n:importlib.metadata.version(n) for n in ${JSON.stringify(Object.keys(versions))}}))`], { encoding: 'utf8', timeout: 30000 });
  try { const current = JSON.parse(result.stdout); return result.status === 0 && Object.entries(versions).every(([name, version]) => current[name] === version) ? current : undefined; } catch { return undefined; }
}
async function run(command, args) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(process.stderr, { end: false }); child.stderr.pipe(process.stderr, { end: false });
  const stop = () => { child.kill('SIGTERM'); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try { const [code] = await once(child, 'close'); if (code !== 0) throw new Error(`Voice setup command failed (${code ?? 'terminated'}).`); }
  finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
async function verified(asset, base = path.join(directory, 'models')) {
  const file = path.join(base, asset.name);
  try { return (await stat(file)).size === asset.bytes && await hash(file) === asset.sha256; } catch { return false; }
}
async function download(asset, index = 0, count = 1) {
  if (await verified(asset)) { report('models', `Verified existing ${asset.name}`, 20 + (index + 1) / count * 70); return; }
  const target = path.join(directory, 'models', asset.name);
  const temporary = `${target}.${randomUUID()}.part`;
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(15 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status}).`);
  const file = createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
  const completion = finished(file); void completion.catch(() => {});
  const digest = createHash('sha256');
  let received = 0, lastReport = 0;
  try {
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > asset.bytes) throw new Error('Downloaded model exceeds its verified release size.');
      digest.update(chunk);
      if (!file.write(chunk)) await once(file, 'drain');
      if (Date.now() - lastReport > 600) { report('models', `Downloading ${asset.name}`, 20 + (index + Math.min(1, received / asset.bytes)) / count * 70, { received, total: asset.bytes }); lastReport = Date.now(); }
    }
    file.end(); await completion;
    if (received !== asset.bytes || digest.digest('hex') !== asset.sha256) throw new Error(`Checksum mismatch for ${asset.name}.`);
    await rename(temporary, target);
  } catch (error) { file.destroy(); await completion.catch(() => {}); await rm(temporary, { force: true }); throw error; }
}
async function installMelo() {
  if (await Promise.all(meloAssets.map(asset => verified(asset))).then(results => results.every(Boolean))) { report('models', 'Verified existing Indian English model', 95); return; }
  await download(meloArchive);
  const staging = path.join(directory, 'models', `.melo-extract-${randomUUID()}`);
  await mkdir(path.join(staging, 'melo-en'), { recursive: true, mode: 0o700 });
  try {
    // Extract only fixed regular files to fixed destinations. Archive paths,
    // links and unrelated members never become filesystem paths.
    const script = 'import pathlib,sys,tarfile,shutil\narchive,stage=sys.argv[1:3]\nwith tarfile.open(archive,"r:bz2") as source:\n for name in ("model.onnx","tokens.txt","lexicon.txt","LICENSE","README.md"):\n  member=source.getmember("vits-melo-tts-en/"+name)\n  assert member.isfile() and member.size <= 180000000\n  with source.extractfile(member) as data, (pathlib.Path(stage)/"melo-en"/name).open("wb") as output: shutil.copyfileobj(data,output)\n';
    report('models', 'Unpacking verified Indian English model', 92);
    await run(venvPython, ['-c', script, path.join(directory, 'models', meloArchive.name), staging]);
    if (!await Promise.all(meloAssets.map(asset => verified(asset, staging))).then(results => results.every(Boolean))) throw new Error('Indian English model files failed verification.');
    await mkdir(path.join(directory, 'models', 'melo-en'), { recursive: true, mode: 0o700 });
    for (const asset of meloAssets) await rename(path.join(staging, asset.name), path.join(directory, 'models', asset.name));
  } finally { await rm(staging, { recursive: true, force: true }); }
}

try {
  if (statusOnly) {
    const marker = await readFile(markerFile, 'utf8').then(JSON.parse).catch(() => undefined);
    const ready = Boolean(marker && await exists(venvPython) && await Promise.all(assets.map(asset => verified(asset))).then(results => results.every(Boolean)) && installedVersions());
    report(ready ? 'ready' : 'missing', ready ? 'Selected local voice is ready.' : 'Set up the selected local voice.', ready ? 100 : 0, { ready, directory, python: venvPython });
  } else {
    if (process.platform === 'darwin' && Number(os.release().split('.')[0]) < 23) throw new Error('This pinned local voice runtime requires macOS 14 or newer.');
    report('python', 'Checking Python 3.12 or 3.13', 1);
    const candidates = [process.env.CAPTURE_PYTHON, await exists(venvPython) ? venvPython : undefined, 'python3.12', 'python3.13', 'python3'].filter(Boolean);
    const python = candidates.find(candidate => pythonVersion(candidate));
    if (!python) throw new Error('Install Python 3.12 or 3.13, or set CAPTURE_PYTHON to its executable, then run voice setup again.');
    if (process.env.CAPTURE_PYTHON && !pythonVersion(process.env.CAPTURE_PYTHON)) throw new Error('CAPTURE_PYTHON must point to Python 3.12 or 3.13.');
    await mkdir(path.join(directory, 'models'), { recursive: true, mode: 0o700 });
    if (!await exists(venvPython)) { report('environment', 'Creating the isolated voice environment', 3); await run(python, ['-m', 'venv', path.join(directory, 'venv')]); }
    if (!pythonVersion(venvPython)) throw new Error('The existing voice venv requires Python 3.12 or 3.13. Choose a new runtime directory.');
    if (!installedVersions()) { report('packages', 'Installing selected local speech packages', 7); await run(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', ...Object.entries(versions).map(([name, version]) => `${name}==${version}`)]); }
    if (!installedVersions()) throw new Error('The local voice packages failed verification.');
    if (indian) await installMelo();
    else for (const [index, asset] of assets.entries()) await download(asset, index, assets.length);
    const marker = { engine: indian ? 'sherpa-onnx-melo' : 'kokoro-onnx', voice, versions, python: venvPython, pythonVersion: pythonVersion(venvPython), provider: 'CPUExecutionProvider', assets, ...(indian ? {archive: meloArchive, speakerId: 2} : {}), installedAt: new Date().toISOString() };
    await writeFile(`${markerFile}.tmp`, JSON.stringify(marker, null, 2), { mode: 0o600 }); await rename(`${markerFile}.tmp`, markerFile);
    report('ready', 'Selected local voice is ready.', 100, { ready: true, directory, python: venvPython });
  }
} catch (error) { report('error', error instanceof Error ? error.message : String(error), 0); process.exitCode = 1; }
