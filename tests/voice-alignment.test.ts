import test from 'node:test';
import assert from 'node:assert/strict';
import {alignVoiceWords, type VoicePhonemeTiming} from '../server/voice-alignment.js';

const timed = (phonemes: string): VoicePhonemeTiming[] => [...phonemes].map((phoneme, index) => ({phoneme, start: index / 20, end: (index + 1) / 20}));

test('one branded display word spans its two spoken phoneme groups', () => {
  const phonemes = timed('siː smˈɑːɹt sˈɛvæk naʊ');
  const result = alignVoiceWords('See SmartSevak now', ['siː', 'smˈɑːɹt sˈɛvæk', 'naʊ'], phonemes);
  assert.equal(result.aligned, true);
  assert.equal(result.confidence, 1);
  assert.deepEqual(result.words.map(word => word.text), ['See', 'SmartSevak', 'now']);
  assert.equal(result.words[1].start, phonemes[4].start);
  assert.equal(result.words[1].end, .9);
  assert.ok(result.words[2].start > result.words[1].end);
});

test('expanded numbers and contractions retain their original written tokens', () => {
  const result = alignVoiceWords("Book 25 appointments. We'll follow up!", ['bʊk', 'twɛnti faɪv', 'əpɔɪntmənts.', 'wiːl', 'fɑloʊ', 'ʌp!'], timed('bʊk twɛnti faɪv əpɔɪntmənts. wiːl fɑloʊ ʌp!'));
  assert.equal(result.aligned, true);
  assert.deepEqual(result.words.map(word => word.text), ['Book', '25', 'appointments.', "We'll", 'follow', 'up!']);
  assert.equal(result.words[1].start, .2);
  assert.equal(result.words[1].end, .75);
  assert.ok(result.words.every((word, index) => !index || word.start >= result.words[index - 1].end));
});

test('contextual stress, one phoneme insertion and a short-vowel change stay monotone', () => {
  const result = alignVoiceWords('Find a visible booking calendar', ['fˈaɪnd', 'ə', 'vɪzəbəl', 'bˈʊkɪŋ', 'kælɪndəɹ'], timed('fˌaɪnd ɐ vɪzəbəl bˈʊəkɪŋ kælɪndəɹ'));
  assert.equal(result.aligned, true);
  assert.ok(result.confidence > .82 && result.confidence < 1);
  assert.equal(result.words[1].text, 'a');
  assert.ok(result.words[1].start > result.words[0].end);
  assert.ok(result.words[2].start > result.words[1].end);
});

test('punctuation pauses do not become words or extend speech spans', () => {
  const result = alignVoiceWords('Hello, — world!', ['həloʊ,', '—', 'wɜːld!'], timed('həloʊ,   wɜːld!'));
  assert.equal(result.aligned, true);
  assert.equal(result.words[0].end, .25);
  assert.deepEqual(result.words[1], {text: '—', start: .25, end: .25});
  assert.ok(result.words[2].start > result.words[1].end);
});

test('mismatch, missing words and invalid timing explicitly request fallback', () => {
  for (const result of [
    alignVoiceWords('Hello world', ['həloʊ'], timed('həloʊ wɜːld')),
    alignVoiceWords('Hello world', ['həloʊ', 'wɜːld'], timed('bʊk naʊ')),
    alignVoiceWords('Keep the appointments visible', ['kiːp', 'ðə', 'əpɔɪntmənts', 'vɪzəbəl'], timed('kiːp ðə vɪzəbəl')),
    alignVoiceWords('Hello', ['həloʊ'], [{phoneme: 'h', start: 0, end: Number.NaN}]),
    alignVoiceWords('Hello', ['həloʊ'], [{phoneme: 'h', start: 1, end: 2}, {phoneme: 'ə', start: .5, end: 1}]),
    alignVoiceWords('Hello', [''], timed('həloʊ')),
  ]) {
    assert.equal(result.aligned, false);
    assert.deepEqual(result.words, []);
    assert.ok(result.reason);
  }
});

test('a locally missing short word is rejected despite high sentence similarity', () => {
  const pronunciations = ['kiːp', 'ə', 'lɒŋ', 'əpɔɪntmənt', 'kælɪndəɹ', 'vɪzəbəl'];
  const result = alignVoiceWords('Keep a long appointment calendar visible', pronunciations, timed('kiːp lɒŋ əpɔɪntmənt kælɪndəɹ vɪzəbəl'));
  assert.equal(result.aligned, false);
  assert.ok(result.confidence > .9);
  assert.deepEqual(result.words, []);
});

test('alignment work is bounded for unexpected oversized model output', () => {
  const result = alignVoiceWords('long', ['a'.repeat(2100)], timed('a'.repeat(2100)));
  assert.equal(result.aligned, false);
  assert.match(result.reason!, /too large/);
});

// Captured from the released 0.6.1 wheel, official v1.1 FP32 English graph,
// af_heart at speed 1.0 on this machine. Keeps the proof independent of model
// downloads and the ignored runtime directory when someone clones the repo.
test('real Kokoro opening proof aligns the brand, all eleven words, and pauses', () => {
  const raw: [string, number, number][] = [
    ['s',.115333,.165333],['t',.165333,.190333],['ˈ',.190333,.240333],['ɑ',.240333,.265333],['ː',.265333,.290333],['ɹ',.290333,.340333],['t',.340333,.365333],[' ',.365333,.390333],['w',.390333,.415333],['ɪ',.415333,.465333],['ð',.465333,.515333],[' ',.515333,.565333],
    ['s',.565333,.615333],['m',.615333,.640333],['ˈ',.640333,.690333],['ɑ',.690333,.715333],['ː',.715333,.740333],['ɹ',.740333,.790333],['t',.790333,.840333],[' ',.840333,.890333],['s',.890333,.940333],['ˈ',.940333,.990333],['ɛ',.990333,1.040333],['v',1.040333,1.140333],['æ',1.140333,1.240333],['k',1.240333,1.565333],['.',1.565333,1.665333],[' ',1.665333,1.740333],
    ['ɹ',1.740333,1.790333],['ᵻ',1.790333,1.840333],['v',1.840333,1.890333],['j',1.890333,1.915333],['ˈ',1.915333,1.940333],['u',1.940333,1.965333],['ː',1.965333,1.990333],[' ',1.990333,2.040333],['l',2.040333,2.090333],['ˈ',2.090333,2.165333],['i',2.165333,2.265333],['ː',2.265333,2.340333],['d',2.340333,2.390333],['z',2.390333,2.490333],[',',2.490333,2.540333],[' ',2.540333,2.590333],
    ['b',2.590333,2.615333],['ˈ',2.615333,2.665333],['ʊ',2.665333,2.715333],['k',2.715333,2.815333],['ɪ',2.815333,2.915333],['ŋ',2.915333,3.015333],['z',3.015333,3.090333],[',',3.090333,3.115333],[' ',3.205333,3.255333],['æ',3.255333,3.280333],['n',3.280333,3.305333],['d',3.305333,3.330333],[' ',3.330333,3.405333],
    ['æ',3.405333,3.455333],['k',3.455333,3.530333],['t',3.530333,3.580333],['ˈ',3.580333,3.630333],['ɪ',3.630333,3.680333],['v',3.680333,3.730333],['ᵻ',3.730333,3.755333],['ɾ',3.755333,3.830333],['i',3.830333,3.905333],[' ',3.905333,3.955333],['ɪ',3.955333,4.005333],['n',4.005333,4.055333],[' ',4.055333,4.105333],['w',4.105333,4.130333],['ˈ',4.130333,4.180333],['ʌ',4.180333,4.230333],['n',4.230333,4.280333],[' ',4.280333,4.330333],
    ['d',4.330333,4.380333],['ˈ',4.380333,4.455333],['æ',4.455333,4.505333],['ʃ',4.505333,4.580333],['b',4.580333,4.630333],['ɔ',4.630333,4.680333],['ː',4.680333,4.730333],['ɹ',4.730333,4.805333],['d',4.805333,4.911333],['.',4.911333,4.911333],
  ];
  const result = alignVoiceWords('Start with SmartSevak. Review leads, bookings, and activity in one dashboard.', ['stˈɑːɹt','wɪð','smˈɑːɹt sˈɛvæk.','ɹᵻvjˈuː','lˈiːdz,','bˈʊkɪŋz,','ænd','æktˈɪvᵻɾi','ˈɪn','wˌʌn','dˈæʃbɔːɹd.'], raw.map(([phoneme,start,end]) => ({phoneme,start,end})));
  assert.equal(result.aligned, true);
  assert.equal(result.confidence, 1);
  assert.equal(result.words.length, 11);
  assert.deepEqual(result.words[2], {text:'SmartSevak.',start:.565333,end:1.565333});
  assert.equal(result.words[3].start, 1.740333);
  assert.equal(result.words.at(-1)!.end, 4.911333);
  assert.ok(result.words.every((word, index) => !index || word.start > result.words[index - 1].end));
});
