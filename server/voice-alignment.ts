export interface VoicePhonemeTiming { phoneme: string; start: number; end: number; }
export interface AlignedVoiceWord { text: string; start: number; end: number; }
export interface VoiceWordAlignment {
  aligned: boolean;
  confidence: number;
  words: AlignedVoiceWord[];
  reason?: string;
}

const MAX_PHONEMES = 4000;
const MAX_CELLS = 4_000_000;
const MIN_CONFIDENCE = .82;
const ignored = /[\p{P}\p{Z}\p{Cf}\sˈˌ]/u;
const symbols = (value: string): string[] => [...value.normalize('NFC')].filter(symbol => !ignored.test(symbol));
const failure = (reason: string, confidence = 0): VoiceWordAlignment => ({aligned: false, confidence, words: [], reason});

/**
 * Map one pronunciation per original whitespace word onto the model's timings.
 * A display word can contain several spoken groups (brands, numbers), and its
 * isolated pronunciation can differ slightly from its pronunciation in context.
 * Monotone edit-distance alignment handles both without guessing group counts.
 * Failure deliberately returns no words so callers can use estimated timing.
 */
export function alignVoiceWords(
  text: string,
  wordPhonemes: readonly string[],
  phonemes: readonly VoicePhonemeTiming[],
): VoiceWordAlignment {
  const script = text.trim() ? text.trim().split(/\s+/u) : [];
  if (!script.length || script.length !== wordPhonemes.length || wordPhonemes.some(value => typeof value !== 'string')) return failure('Word pronunciations do not match the script.');
  const pronunciations = wordPhonemes.map(symbols);
  // An empty pronunciation for an actual word cannot be safely manufactured.
  if (pronunciations.some((value, index) => !value.length && /[\p{L}\p{N}]/u.test(script[index]))) return failure('A script word has no pronunciation.');
  const expected = pronunciations.flat();
  const observed: (VoicePhonemeTiming & {symbol: string})[] = [];
  let previousEnd = 0;
  let stressStart: number | undefined;
  for (const timing of phonemes) {
    if (typeof timing?.phoneme !== 'string' || !Number.isFinite(timing.start) || !Number.isFinite(timing.end) || timing.start < 0 || timing.end < timing.start || timing.start + 1e-7 < previousEnd) return failure('Phoneme timings are invalid or out of order.');
    previousEnd = timing.end;
    for (const symbol of [...timing.phoneme.normalize('NFC')]) {
      if (symbol === 'ˈ' || symbol === 'ˌ') {
        stressStart ??= timing.start;
      } else if (!ignored.test(symbol)) {
        observed.push({...timing, symbol, start: stressStart ?? timing.start});
        stressStart = undefined;
      } else {
        stressStart = undefined;
      }
    }
  }
  const n = expected.length, m = observed.length, width = m + 1;
  if (!n || !m) return failure('No spoken phonemes to align.');
  if (n > MAX_PHONEMES || m > MAX_PHONEMES || (n + 1) * width > MAX_CELLS) return failure('Phoneme alignment is too large.');
  const costs = new Uint16Array((n + 1) * width);
  for (let i = 1; i <= n; i++) costs[i * width] = i;
  for (let j = 1; j <= m; j++) costs[j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      costs[i * width + j] = Math.min(
        costs[(i - 1) * width + j - 1] + Number(expected[i - 1] !== observed[j - 1].symbol),
        costs[(i - 1) * width + j] + 1,
        costs[i * width + j - 1] + 1,
      );
    }
  }
  const confidence = 1 - costs[n * width + m] / Math.max(n, m);
  if (confidence < MIN_CONFIDENCE) return failure('The spoken phonemes do not match the script closely enough.', confidence);
  const mapping = new Int32Array(n).fill(-1);
  let i = n, j = m;
  while (i || j) {
    const at = costs[i * width + j];
    if (i && j && at === costs[(i - 1) * width + j - 1] + Number(expected[i - 1] !== observed[j - 1].symbol)) {
      mapping[--i] = --j;
    } else if (i && at === costs[(i - 1) * width + j] + 1) {
      i--;
    } else {
      j--;
    }
  }
  const ranges: (AlignedVoiceWord | undefined)[] = [];
  let offset = 0;
  for (let word = 0; word < script.length; word++) {
    const pronunciation = pronunciations[word];
    const indices = [...mapping.slice(offset, offset + pronunciation.length)].filter(index => index >= 0);
    const exact = pronunciation.filter((symbol, index) => mapping[offset + index] >= 0 && symbol === observed[mapping[offset + index]].symbol).length;
    offset += pronunciation.length;
    if (!pronunciation.length) { ranges.push(undefined); continue; }
    // Reject a missing or badly mismatched word even when a long sentence has
    // high overall similarity. One contextual change in a short word is normal.
    if (!indices.length || indices.length / pronunciation.length < .6 ||
      (pronunciation.length >= 4 && exact / pronunciation.length < .5) ||
      (pronunciation.length < 4 && !exact && (pronunciation.length > 1 || confidence < .9))) return failure(`Cannot confidently align script word ${word + 1}.`, confidence);
    const first = observed[indices[0]], last = observed[indices[indices.length - 1]];
    if (last.end <= first.start) return failure(`Script word ${word + 1} has no audible duration.`, confidence);
    ranges.push({text: script[word], start: first.start, end: last.end});
  }
  // Standalone punctuation has no spoken span; retain its exact script token at
  // the adjacent boundary rather than inventing audio or dropping display text.
  const words = ranges.map((range, index): AlignedVoiceWord => {
    if (range) return range;
    const previous = ranges.slice(0, index).reverse().find(value => value);
    const next = ranges.slice(index + 1).find(value => value);
    const boundary = previous?.end ?? next?.start ?? 0;
    return {text: script[index], start: boundary, end: boundary};
  });
  return {aligned: true, confidence, words};
}
