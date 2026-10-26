import type { Scene } from '../shared/types.js';

export interface SubtitleCue { start: number; end: number; text: string; words: string[]; }

/** One short readable phrase per cue; the same timeline drives pixels and downloads. */
export function subtitleCues(scenes: readonly Pick<Scene, 'narration'|'caption'|'duration'>[]): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let elapsed = 0;
  for (const scene of scenes) {
    if (!Number.isFinite(scene.duration) || scene.duration <= 0) throw new Error('Subtitle scenes need a positive duration.');
    const text = (scene.narration.trim() || scene.caption.trim()).replace(/[\u0000-\u001f\u007f]/g, ' ');
    const words = text.split(/\s+/u).filter(Boolean).flatMap(word => word.match(/.{1,32}/gu) || []);
    let first = 0;
    while (first < words.length) {
      const phrase: string[] = [];
      while (first + phrase.length < words.length) {
        const next = words[first + phrase.length];
        if (phrase.length && (phrase.length === 7 || [...phrase, next].join(' ').length > 44)) break;
        phrase.push(next);
        if (phrase.length >= 4 && /[.!?;:]$/u.test(next)) break;
      }
      cues.push({ start: elapsed + first / words.length * scene.duration,
        end: elapsed + (first + phrase.length) / words.length * scene.duration,
        text: phrase.join(' '), words: phrase });
      first += phrase.length;
    }
    elapsed += scene.duration;
  }
  return cues;
}

export function subtitleAt(cues: readonly SubtitleCue[], time: number): { subtitle: string; subtitleWord: number } {
  const cue = cues.find(value => time >= value.start && time < value.end);
  if (!cue) return { subtitle: '', subtitleWord: -1 };
  const progress = Math.max(0, Math.min(1, (time - cue.start) / (cue.end - cue.start)));
  return { subtitle: cue.text, subtitleWord: Math.min(cue.words.length - 1, Math.floor(progress * cue.words.length)) };
}

function timestamp(value: number, decimal: ','|'.'): string {
  const ms = Math.max(0, Math.round(value * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2,'0')}:${String(Math.floor(ms / 60000) % 60).padStart(2,'0')}:${String(Math.floor(ms / 1000) % 60).padStart(2,'0')}${decimal}${String(ms % 1000).padStart(3,'0')}`;
}

const escapeText = (text: string) => text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

export function subtitleSrt(cues: readonly SubtitleCue[]): string {
  return cues.map((cue, i) => `${i + 1}\n${timestamp(cue.start, ',')} --> ${timestamp(cue.end, ',')}\n${escapeText(cue.text)}\n`).join('\n');
}

export function subtitleVtt(cues: readonly SubtitleCue[]): string {
  // Escape WebVTT markup; product text must remain literal in player captions.
  return `WEBVTT\n\n${cues.map(cue => `${timestamp(cue.start, '.')} --> ${timestamp(cue.end, '.')}\n${escapeText(cue.text)}\n`).join('\n')}`;
}
