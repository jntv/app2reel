import type { EditCamera, EditTransition, PrivacyMask, ProductVisualModel } from '../shared/types.js';
export interface FilmState {
  name: string;
  title: string;
  caption: string;
  feature: string;
  url: string;
  scene: number;
  scenes: number;
  progress: number;
  totalProgress: number;
  time: number;
  duration?: number;
  subtitle?: string;
  subtitleWord?: number;
  subtitleOpacity?: number;
  motion?: 'cinematic' | 'subtle';
  focus?: { x: number; y: number; zoom: number };
  focusArea?: PrivacyMask;
  focusRevealAt?: number;
  camera?: EditCamera;
  transition?: EditTransition;
  externalTransitions?: boolean;
  bookend?: { kind: 'intro'|'outro'|'none'; opacity: number; reveal: number; tagline?: string };
  visualModel?: ProductVisualModel;
  cursor?: { x: number; y: number; click?: boolean };
}
