import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const python = spawnSync('python3', ['--version'], {encoding:'utf8'});
const script = path.resolve('scripts/local-voice.py');
const helpers = `
import importlib.util, pathlib, sys, tempfile, types
spec = importlib.util.spec_from_file_location('voice', sys.argv[1])
voice = importlib.util.module_from_spec(spec)
spec.loader.exec_module(voice)
`;
function checkPython(code: string) {
  const result = spawnSync('python3', ['-c', helpers + code, script], {encoding:'utf8', timeout:10000});
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('local voice pronunciation helpers operate without model or network dependencies', {skip:python.status !== 0}, async t => {
  await t.test('IPA mapping preserves consonants, primary/secondary stress and unstressed vowels', () => checkPython(`
assert voice.ipa_to_melo('kˈæptʃɚ') == (['k','ae','p','ch','er'], [7,9,7,7,8])
assert voice.ipa_to_melo('sˌeɪvˈɑːk') == (['s','ey','v','aa','k'], [7,10,7,9,7])
assert voice.ipa_to_melo('dʒˈoʊn') == (['jh','ow','n'], [7,9,7])
`));
  await t.test('unsupported phonemes fail rather than drop name sounds', () => checkPython(`
try:
 voice.ipa_to_melo('kʙa')
 raise AssertionError('unsupported phone accepted')
except ValueError as error:
 assert 'Spell its pronunciation' in str(error)
`));
  await t.test('unsupported script and symbols fail; ordinary English symbols are spoken', () => checkPython(`
assert voice.melo_text("Sales & Support + Reports") == 'Sales  and  Support  plus  Reports'
assert voice.melo_text("Your clinic’s work") == "Your clinic's work"
for text in ('Hello नमस्ते', 'Hello 🩺', 'Café'):
 try:
  voice.melo_text(text)
  raise AssertionError('unsupported input accepted')
 except ValueError as error:
  assert 'narration text' in str(error)
`));
  await t.test('unknown compounds and numbers get local pronunciations without modifying installed lexicon', () => checkPython(`
calls = []
class FakeBackend:
 def __init__(self, *args, **kwargs): pass
 def phonemize(self, words, **kwargs):
  calls.extend(words)
  return [{'Sevak':'sˈɛvæk', 'Qytrix':'kˈɪtɹɪks', '12':'twˈɛlv'}[word] for word in words]
backend = types.ModuleType('phonemizer.backend'); backend.EspeakBackend = FakeBackend
wrapper = types.ModuleType('phonemizer.backend.espeak.wrapper')
wrapper.EspeakWrapper = types.SimpleNamespace(set_library=lambda _:None, set_data_path=lambda _:None)
loader = types.ModuleType('espeakng_loader')
loader.get_library_path = lambda:'local-library'; loader.get_data_path = lambda:'local-data'
sys.modules.update({'phonemizer.backend':backend, 'phonemizer.backend.espeak.wrapper':wrapper, 'espeakng_loader':loader})
with tempfile.TemporaryDirectory() as directory:
 source = pathlib.Path(directory)/'installed.txt'; target = pathlib.Path(directory)/'request.txt'
 original = 'smart s m aa r t 7 7 9 7 7\\nopen ow p ah n 9 7 8 7\\nai ey ay 9 9\\n'
 source.write_text(original)
 result = voice.english_lexicon(source, ['SmartSevak OpenAI Qytrix 12'], target)
 assert result == target
 assert source.read_text() == original
 entries = {line.split()[0]:line.split()[1:] for line in target.read_text().splitlines() if line.strip()}
 assert entries['smartsevak'][:5] == ['s','m','aa','r','t']
 assert entries['openai'] == ['ow','p','ah','n','ey','ay','9','7','8','7','9','9']
 assert all(name in entries for name in ('smartsevak','openai','qytrix','12'))
 assert sorted(calls) == ['12','Qytrix','Sevak']
`));
});

test('voice setup status defaults to Indian English and accepts explicit legacy choices', () => {
  for (const args of [[], ['--voice','af_heart'], ['--voice','am_michael']]) {
    const result = spawnSync(process.execPath, ['scripts/setup-voice.mjs', '--status', '--dir', path.join('node_modules', '.nonexistent-voice-runtime-for-test'), ...args], {encoding:'utf8',timeout:10000});
    assert.equal(result.status, 0, result.stderr);
    const status = JSON.parse(result.stdout);
    assert.equal(status.ready, false);
    assert.equal(status.voice, args[1] || 'melo_india');
  }
});
