import type { Finding, Scene, Shot } from '../shared/types.js';
import { clipTiming } from './demo-motion.js';

export interface PlannedScene { title: string; caption: string; narration: string; duration: number; shotIndex: number; feature: string; }
export class StoryboardPacingError extends Error { constructor(message: string) { super(message); this.name = 'StoryboardPacingError'; } }
const FPS = 30;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const words = (value: string) => value.trim().split(/\s+/u).filter(Boolean).length;
const script = (scene: Pick<PlannedScene, 'narration'|'caption'>) => scene.narration.trim() || scene.caption.trim();
export const spokenWordBudget = (duration: number) => Math.floor(duration * 2.2);

export const storyboardPlanSchema: Record<string, unknown> = {
  type: 'object', additionalProperties: false, required: ['scenes'], properties: {
    scenes: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'object', additionalProperties: false,
      required: ['title', 'caption', 'narration', 'duration', 'shotIndex', 'feature'], properties: {
        title: { type: 'string' }, caption: { type: 'string' }, narration: { type: 'string' },
        duration: { type: 'number', minimum: 1, maximum: 30 }, shotIndex: { type: 'integer', minimum: 0 }, feature: { type: 'string' },
      } },
    },
  },
};

/** First occurrence wins; source order, not model array order, determines chronology. */
export function chronologicalPlan(plan: readonly PlannedScene[], shots: readonly Shot[]): PlannedScene[] {
  const selected = new Map<number, PlannedScene>();
  for (const scene of plan) {
    if (!scene || !Number.isInteger(scene.shotIndex) || scene.shotIndex < 0 || scene.shotIndex >= shots.length
      || !['title', 'caption', 'narration', 'feature'].every(key => typeof scene[key as keyof PlannedScene] === 'string') || !scene.title.trim()) continue;
    if (!selected.has(scene.shotIndex)) selected.set(scene.shotIndex, scene);
  }
  return [...selected.values()].sort((a, b) => a.shotIndex - b.shotIndex).slice(0, 16);
}

/** Explicitly distinguish entering a view from the explorer's later outgoing intent. */
export function storyboardEvidence(shots: readonly Shot[], findings: readonly Finding[]) {
  return shots.map((shot, shotIndex) => {
    let predecessor: number | undefined;
    if (finite(shot.entryStart) && finite(shot.entrySettled)) for (let i = shotIndex - 1; i >= 0; i--) {
      if (finite(shots[i].actionStart) && finite(shots[i].actionEnd)
        && Math.abs(shots[i].actionStart! - shot.entryStart) < .005 && Math.abs(shots[i].actionEnd! - shot.entrySettled) < .005) { predecessor = i; break; }
    }
    const completedOutgoing = finite(shot.actionStart) && finite(shot.actionEnd) && shot.actionEnd >= shot.actionStart;
    return {
      shotIndex,
      current: { title: shot.title, screenshot: shot.screenshot, capturedAt: shot.at,
        observedFeatures: findings.filter(finding => finding.status === 'observed' && finding.screenshot === shot.screenshot).map(finding => ({ feature: finding.feature, evidence: finding.evidence })),
        visualModel: shot.visualModel },
      incoming: predecessor === undefined ? null : { fromShotIndex: predecessor, start: shot.entryStart, settled: shot.entrySettled, explorerIntent: shots[predecessor].action || '', completed: true },
      outgoing: { explorerIntent: shot.action || '', completed: completedOutgoing, ...(completedOutgoing ? { start: shot.actionStart, end: shot.actionEnd } : {}) },
    };
  });
}

/** Normalize requested pacing while preserving a readable speech floor and an exact frame budget. */
export function sceneDurations(plan: readonly PlannedScene[], totalDuration: number): number[] {
  if (!finite(totalDuration) || totalDuration < 1 || totalDuration > 180 || !plan.length) throw new Error('The storyboard needs a valid film duration and at least one captured moment.');
  const target = Math.round(totalDuration * FPS);
  const counts = plan.map(scene => words(script(scene)));
  if (counts.reduce((a, b) => a + b, 0) > spokenWordBudget(totalDuration)) throw new StoryboardPacingError(`The narration exceeds this film’s ${spokenWordBudget(totalDuration)}-word budget. Shorten the script before rendering.`);
  const minimum = counts.map(count => Math.max(FPS, Math.ceil((count ? count / 2.6 + .65 : 1) * FPS)));
  const maximum = 30 * FPS;
  if (minimum.some(value => value > maximum) || minimum.reduce((a, b) => a + b, 0) > target || target > plan.length * maximum) throw new StoryboardPacingError('The selected moments cannot fit this duration at a natural speaking pace. Adjust the script or the number of scenes.');
  const weights = plan.map((scene, index) => finite(scene.duration) && scene.duration > 0 ? Math.max(1, Math.min(30, scene.duration)) : Math.max(1, counts[index] / 2.2 + .65));
  // A bounded proportional allocation avoids starving a longer spoken scene and
  // correctly redistributes time when either the speech floor or30s cap binds.
  const bounded = (weight: number, scale: number, index: number) => Math.max(minimum[index], Math.min(maximum, weight * scale));
  let lower = 0, upper = maximum / Math.min(...weights);
  for (let step = 0; step < 64; step++) {
    const scale = (lower + upper) / 2;
    if (weights.reduce((sum, weight, index) => sum + bounded(weight, scale, index), 0) <= target) lower = scale; else upper = scale;
  }
  const proposed = weights.map((weight, index) => bounded(weight, lower, index));
  const allocated = proposed.map(Math.floor);
  let remainder = target - allocated.reduce((a, b) => a + b, 0);
  for (const { index } of proposed.map((frames, index) => ({ frames, index })).sort((a, b) => (b.frames % 1) - (a.frames % 1) || a.index - b.index)) {
    if (remainder > 0 && allocated[index] < maximum) { allocated[index]++; remainder--; }
  }
  return allocated.map(frames => frames / FPS);
}

/** Include the real incoming action and a short result hold, never an AI thinking pause. */
export function shotInterval(shot: Shot, duration: number, recordingDuration: number): Pick<Scene, 'recordingStart'|'recordingEnd'|'focusRevealAt'> {
  if (!finite(recordingDuration) || recordingDuration <= 0 || !finite(duration) || duration <= 0) throw new Error('The storyboard needs usable recorded product footage.');
  const clamp = (value: number) => Math.max(0, Math.min(recordingDuration, value));
  const at = clamp(finite(shot.at) ? shot.at : 0);
  const hasEntry = finite(shot.entryStart) && finite(shot.entrySettled) && shot.entryStart >= 0
    && shot.entrySettled >= shot.entryStart && shot.entrySettled <= at + .05;
  const incomingStart = hasEntry ? clamp(shot.entryStart! - .25) : Math.max(0, at - .15);
  let settled = hasEntry ? clamp(shot.entrySettled!) : at;
  let start = incomingStart;
  const hold = Math.min(1.1, Math.max(.6, duration * .2));
  const maxSource = duration * 1.12;
  // A long page load cannot be sped through safely. Show its observed result instead.
  if (settled - start + .25 > maxSource) { start = Math.max(0, at - .15); settled = at; }
  const outgoing = finite(shot.actionStart) && shot.actionStart > settled ? clamp(shot.actionStart) : recordingDuration;
  let end = Math.min(recordingDuration, outgoing, settled + hold, start + maxSource);
  if (end <= start) { start = Math.max(0, Math.min(at, recordingDuration) - Math.min(.15, recordingDuration)); end = Math.min(recordingDuration, start + Math.min(.5, maxSource)); settled = Math.min(at, end); }
  if (end <= start) throw new Error('A selected product moment has no usable recording interval.');
  const timing = clipTiming(start, end, duration);
  const focusRevealAt = Math.min(duration, Math.max(0, (settled - start) / timing.playbackRate + .08));
  return { recordingStart: start, recordingEnd: end, focusRevealAt };
}

export function buildStoryboard(plan: readonly PlannedScene[], shots: readonly Shot[], findings: readonly Finding[], totalDuration: number, recordingDuration: number): { scenes: Scene[]; shotIndices: number[] } {
  const selected = chronologicalPlan(plan, shots);
  if (!selected.length) throw new Error('The storyboard did not reference any observed product shots. Please explore again.');
  const durations = sceneDurations(selected, totalDuration);
  const scenes = selected.map((planned, index): Scene => {
    const shot = shots[planned.shotIndex];
    const feature = findings.some(finding => finding.status === 'observed' && finding.feature === planned.feature && (!finding.screenshot || finding.screenshot === shot.screenshot)) ? planned.feature : '';
    return { id: `scene-${index + 1}`, title: planned.title.slice(0, 160), caption: planned.caption.slice(0, 360), narration: planned.narration.slice(0, 2000),
      duration: durations[index], screenshot: shot.screenshot, feature, visualModel: shot.visualModel, focusArea: shot.focusArea,
      ...shotInterval(shot, durations[index], recordingDuration) };
  });
  return { scenes, shotIndices: selected.map(scene => scene.shotIndex) };
}
