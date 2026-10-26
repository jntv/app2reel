import type { PrivacyMask, ProductVisualModel } from '../shared/types.js';
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
  subtitle?: string;
  subtitleWord?: number;
  motion?: 'cinematic' | 'subtle';
  focus?: { x: number; y: number; zoom: number };
  focusArea?: PrivacyMask;
  visualModel?: ProductVisualModel;
  cursor?: { x: number; y: number; click?: boolean };
}
