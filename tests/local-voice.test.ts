import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir, release} from 'node:os';
import path from 'node:path';
import {localVoiceStatus, naturalVoiceIdentity, naturalVoiceReady, startVoiceSetup, synthesizeNaturalVoice, voiceDirectory, voicePython} from '../server/local-voice.js';

type FakeMode = 'valid'|'wrong-file'|'wrong-count'|'wrong-order'|'invalid-json'|'invalid-schema'|'failed'|'wait';
const supportsQwen=process.platform==='darwin'&&process.arch==='arm64'&&Number(release().split('.')[0])>=23;

async function fakeRuntime(run: (directory: string, install: (mode?: FakeMode) => Promise<void>) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'capture-voice-bridge-'));
  const original = process.env.CAPTURE_VOICE_DIR;
  process.env.CAPTURE_VOICE_DIR = directory;
  const install = async (mode: FakeMode = 'valid') => {
    await mkdir(path.join(directory, 'models'), {recursive: true});
    await mkdir(path.dirname(voicePython(directory)), {recursive: true});
    await writeFile(path.join(directory, '.installed.json'), '{}');
    await writeFile(path.join(directory, 'models/kokoro-v1.0.onnx'), 'fake model');
    await writeFile(path.join(directory, 'models/voices-v1.0.bin'), 'fake voices');
    // A tiny executable substitutes for Python. It consumes only JSON stdin and
    // never imports the real bridge, downloads models, or performs inference.
    await writeFile(voicePython(directory), `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const mode=${JSON.stringify(mode)},directory=${JSON.stringify(directory)};
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>input+=chunk);
process.stdin.on('end',()=>{
 const request=JSON.parse(input);
 fs.writeFileSync(path.join(directory,'received.json'),JSON.stringify({request,args:process.argv.slice(2),pid:process.pid,offline:[process.env.HF_HUB_OFFLINE,process.env.TRANSFORMERS_OFFLINE]}));
 if(mode==='wait'){setInterval(()=>{},1000);return;}
 if(mode==='failed'){process.stderr.write('private runtime diagnostic');process.exit(7);}
 if(mode==='invalid-json'){process.stdout.write('not json');return;}
 let results=request.items.map(item=>({file:item.file,sampleRate:24000,duration:1,phonemes:[{phoneme:'h',start:.1,end:.3}],wordPhonemes:item.text.trim().split(/\\s+/u).map(()=>'h')}));
 if(mode==='wrong-file')results[0].file=path.join(directory,'unexpected.wav');
 if(mode==='wrong-count')results=[];
 if(mode==='wrong-order')results.reverse();
 if(mode==='invalid-schema')results[0].sampleRate=10;
 process.stdout.write(JSON.stringify({results}));
});
`, {mode: 0o700});
    await chmod(voicePython(directory), 0o700);
  };
  try { await run(directory, install); }
  finally {
    if (original === undefined) delete process.env.CAPTURE_VOICE_DIR;
    else process.env.CAPTURE_VOICE_DIR = original;
    await rm(directory, {recursive: true, force: true});
  }
}

const batch = (directory: string) => [{text: 'A local test sentence.', file: path.join(directory, 'speech.wav')}];

// Executable shebangs emulate the Python process on macOS/Linux. Windows needs
// a real PE launcher and is outside this fake-runtime test's platform contract.
test('local voice bridge works without a model download', {skip: process.platform === 'win32', concurrency: false}, async t => {
  await t.test('status changes from missing to ready only when all runtime files exist', async () => {
    await fakeRuntime(async (directory, install) => {
      assert.equal(voiceDirectory(), directory);
      assert.equal(naturalVoiceReady('af_heart'), false);
      const missing = localVoiceStatus(true);
      assert.equal(missing.state, 'missing');
      assert.equal(missing.naturalReady, false);
      assert.equal(missing.systemReady, true);
      await assert.rejects(synthesizeNaturalVoice(batch(directory), 'af_heart'), /Set up.*natural voice/);
      await install();
      assert.equal(naturalVoiceReady('melo_india'),false,'A Kokoro install must not masquerade as a ready Indian voice.');
      await assert.rejects(synthesizeNaturalVoice(batch(directory),'melo_india'),/Set up the selected natural voice/);
      const ready = localVoiceStatus(false);
      assert.equal(ready.state, 'ready');
      assert.equal(ready.naturalReady, true);
      assert.equal(ready.systemReady, false);
      assert.deepEqual(ready.voices.map(voice => voice.id), ['melo_india', 'af_heart', 'am_michael', 'qwen_indian_male', 'qwen_indian_female']);
      for (const file of ['.installed.json', 'models/kokoro-v1.0.onnx', 'models/voices-v1.0.bin', path.relative(directory, voicePython(directory))]) {
        await rm(path.join(directory, file));
        assert.equal(naturalVoiceReady('af_heart'), false, `Missing ${file} must disable natural speech.`);
        await install();
      }
    });
  });

  await t.test('batch, quotes and newlines travel through stdin with offline flags', async () => {
    await fakeRuntime(async (directory, install) => {
      await install();
      const items = [
        {text: 'A "quoted" sentence\nwith $shell; punctuation.', file: path.join(directory, 'one.wav')},
        {text: 'Another local sentence.', file: path.join(directory, 'two.wav')},
      ];
      const result = await synthesizeNaturalVoice(items, 'am_michael');
      assert.equal(result.length, 2);
      assert.deepEqual(result.map(item => item.file), items.map(item => item.file));
      assert.deepEqual(result[0].phonemes, [{phoneme:'h',start:.1,end:.3}]);
      const received = JSON.parse(await readFile(path.join(directory, 'received.json'), 'utf8'));
      assert.deepEqual(received.request, {voice:'am_michael',items});
      assert.deepEqual(received.offline, ['1','1']);
      assert.equal(received.args.length, 3);
      assert.match(received.args[0], /scripts[/\\]local-voice\.py$/);
      assert.deepEqual(received.args.slice(1), ['--runtime-dir', directory]);
      assert.ok(!received.args.join(' ').includes(items[0].text));
    });
  });

  await t.test('unsupported voices and invalid batches fail before starting a child', async () => {
    await fakeRuntime(async (directory, install) => {
      await install();
      for (const voice of ['af_bella', '../af_heart', '']) await assert.rejects(synthesizeNaturalVoice(batch(directory), voice), /supported natural voice/);
      for (const items of [[], Array.from({length:21},()=>batch(directory)[0]), [{text:'valid',file:'relative.wav'}], [{text:'a'.repeat(2001),file:path.join(directory,'speech.wav')}]]) {
        await assert.rejects(synthesizeNaturalVoice(items, 'af_heart'), /Invalid natural narration batch/);
      }
      assert.equal(existsSync(path.join(directory, 'received.json')), false);
    });
  });

  await t.test('unexpected response files, result counts and ordering are rejected', async () => {
    await fakeRuntime(async (directory, install) => {
      for (const mode of ['wrong-file','wrong-count','wrong-order'] as const) {
        await install(mode);
        const items = [...batch(directory), {text:'Second sentence.',file:path.join(directory,'second.wav')}];
        await assert.rejects(synthesizeNaturalVoice(items, 'af_heart'), /unexpected files/);
      }
    });
  });

  await t.test('malformed JSON and invalid result fields are rejected', async () => {
    await fakeRuntime(async (directory, install) => {
      await install('invalid-json');
      await assert.rejects(synthesizeNaturalVoice(batch(directory), 'af_heart'), SyntaxError);
      await install('invalid-schema');
      await assert.rejects(synthesizeNaturalVoice(batch(directory), 'af_heart'), /sampleRate/);
    });
  });

  await t.test('child and executable failures use safe actionable errors', async () => {
    await fakeRuntime(async (directory, install) => {
      await install('failed');
      await assert.rejects(synthesizeNaturalVoice(batch(directory), 'af_heart'), error => {
        assert.match(String(error), /Natural narration failed/);
        assert.doesNotMatch(String(error), /private runtime diagnostic/);
        return true;
      });
      await chmod(voicePython(directory), 0o600);
      await assert.rejects(synthesizeNaturalVoice(batch(directory), 'af_heart'), /Could not start the local natural voice runtime/);
    });
  });

  await t.test('an already aborted signal starts no process', async () => {
    await fakeRuntime(async (directory, install) => {
      await install();
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(synthesizeNaturalVoice(batch(directory), 'af_heart', controller.signal), /cancelled/);
      assert.equal(existsSync(path.join(directory, 'received.json')), false);
    });
  });

  await t.test('cancellation terminates a running bridge and rejects instead of returning results', async () => {
    await fakeRuntime(async (directory, install) => {
      await install('wait');
      const controller = new AbortController();
      const work = synthesizeNaturalVoice(batch(directory), 'af_heart', controller.signal);
      // Install the rejection handler immediately, including on a slow runner.
      const rejected = assert.rejects(work, /cancelled/);
      try {
        const deadline = Date.now() + 3000;
        while (!existsSync(path.join(directory, 'received.json')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(existsSync(path.join(directory, 'received.json')), true, 'The fake child must have started.');
        const {pid} = JSON.parse(await readFile(path.join(directory, 'received.json'), 'utf8'));
        controller.abort();
        await rejected;
        assert.throws(() => process.kill(pid, 0), /ESRCH/);
      } finally {
        controller.abort();
        await rejected;
      }
    });
  });
});

test('designed voices bind the exact reference and recipe while preserving legacy identities',()=>{
  assert.deepEqual(naturalVoiceIdentity('melo_india'),{provider:'MeloTTS ONNX'});
  assert.deepEqual(naturalVoiceIdentity('af_heart'),{provider:'Kokoro ONNX'});
  assert.deepEqual(naturalVoiceIdentity('am_michael'),{provider:'Kokoro ONNX'});
  const recipe=JSON.parse(readFileSync('assets/voices/qwen-recipes.json','utf8'));
  const digests=[];
  for(const voice of ['qwen_indian_male','qwen_indian_female']){
    const reference=recipe.voices[voice],identity=naturalVoiceIdentity(voice);
    assert.equal(identity.provider,'Qwen3-TTS MLX');assert.match(identity.recipe!,/^[a-f0-9]{64}$/);
    assert.equal(identity.recipe,naturalVoiceIdentity(voice).recipe);
    assert.equal(createHash('sha256').update(readFileSync(path.join('assets/voices',reference.reference))).digest('hex'),reference.sha256);
    assert.equal(identity.recipe,createHash('sha256').update(JSON.stringify({version:recipe.version,model:recipe.model.repository,revision:recipe.model.revision,reference:reference.sha256,transcript:reference.transcript,generation:recipe.generation})).digest('hex'));
    digests.push(identity.recipe);
  }
  assert.notEqual(digests[0],digests[1]);
  assert.match(voicePython('/tmp/local-runtime','qwen_indian_male'),/qwen-venv/);
  assert.match(voicePython('/tmp/local-runtime','melo_india'),/[/\\]venv[/\\]/);
});

test('designed voice readiness requires its separate environment and pinned model revision',{skip:!supportsQwen,concurrency:false},async()=>{
  await fakeRuntime(async(directory,install)=>{
    await install();
    assert.equal(naturalVoiceReady('qwen_indian_male'),false);
    const recipe=JSON.parse(await readFile('assets/voices/qwen-recipes.json','utf8'));
    for(const asset of recipe.model.assets){const file=path.join(directory,'models',recipe.model.directory,asset.name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'fixture');}
    await writeFile(path.join(directory,'.qwen-installed.json'),JSON.stringify({modelRevision:recipe.model.revision}));
    assert.equal(naturalVoiceReady('qwen_indian_male'),false,'Legacy environment must not masquerade as a Qwen install.');
    const python=voicePython(directory,'qwen_indian_male');await mkdir(path.dirname(python),{recursive:true});
    await writeFile(python,await readFile(voicePython(directory)));await chmod(python,0o700);
    assert.equal(naturalVoiceReady('qwen_indian_male'),true);assert.equal(naturalVoiceReady('qwen_indian_female'),true);
    const result=await synthesizeNaturalVoice(batch(directory),'qwen_indian_male');assert.equal(result.length,1);
    const received=JSON.parse(await readFile(path.join(directory,'received.json'),'utf8'));assert.equal(received.request.voice,'qwen_indian_male');assert.deepEqual(received.offline,['1','1']);
    await writeFile(path.join(directory,'.qwen-installed.json'),JSON.stringify({modelRevision:'unreviewed-model'}));
    assert.equal(naturalVoiceReady('qwen_indian_male'),false);
  });
});

test('unsupported computers get an explicit designed-voice platform error',{skip:supportsQwen},async()=>{
  assert.equal(naturalVoiceReady('qwen_indian_male'),false);
  assert.throws(()=>startVoiceSetup(false,'qwen_indian_male'),/Apple Silicon Mac/);
  await assert.rejects(synthesizeNaturalVoice([{text:'Test.',file:'/tmp/test.wav'}],'qwen_indian_female'),/Apple Silicon Mac/);
});
