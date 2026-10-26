import test from 'node:test';
import assert from 'node:assert/strict';
import { subtitleAt, subtitleCues, subtitleSrt, subtitleVtt } from '../server/subtitles.js';

test('burned subtitles and exports share contiguous phrase timing across scenes', () => {
  const cues = subtitleCues([
    { duration: 6, narration: 'Search by phone, filter by status or agent, and review lead stages.', caption: 'Leads' },
    { duration: 4, narration: '', caption: 'Keep appointments in view.' },
  ]);
  assert.equal(cues[0].start, 0);
  assert.equal(cues.at(-1)!.end, 10);
  assert.equal(cues.map(cue => cue.text).join(' '), 'Search by phone, filter by status or agent, and review lead stages. Keep appointments in view.');
  for (let i = 0; i < cues.length; i++) {
    assert.ok(cues[i].text.length <= 44);
    assert.ok(cues[i].end > cues[i].start);
    if (i) assert.equal(cues[i-1].end, cues[i].start);
    assert.equal(subtitleAt(cues, cues[i].start).subtitle, cues[i].text);
    assert.equal(subtitleAt(cues, cues[i].start).subtitleWord, 0);
  }
  assert.deepEqual(subtitleAt(cues, 10), { subtitle: '', subtitleWord: -1 });
  assert.match(subtitleSrt(cues), /^1\n00:00:00,000 --> /);
  assert.match(subtitleVtt(cues), /^WEBVTT\n\n00:00:00\.000 --> /);
});

test('captions keep user markup literal and reject invalid timing', () => {
  const cues = subtitleCues([{duration: 1, narration: 'Use <script> & safe words', caption: ''}]);
  assert.match(subtitleVtt(cues), /&lt;script&gt; &amp;/);
  assert.throws(() => subtitleCues([{duration: 0, narration: 'Words', caption: ''}]), /positive duration/);
  assert.deepEqual(subtitleCues([{duration: 1, narration: '', caption: ''}]), []);
});
