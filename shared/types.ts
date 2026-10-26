export type Stage = 'draft'|'researching'|'exploring'|'review'|'rendering'|'complete'|'failed'|'cancelled';
export type OutputKind = 'demo'|'promo';
export interface Brief {
  name: string; url: string; description: string; purpose: string; actors: string;
  features: string[]; brandColor: string; duration: number; resolution: '720p'|'1080p';
  maxSteps: number; allowedOrigins: string[]; allowWrites: boolean; sample: boolean;
}
export interface CameraFocus { x: number; y: number; zoom: number; }
export interface PrivacyMask { x: number; y: number; width: number; height: number; }
export interface ProductTheme {
  accent: string; secondary?: string; background: string; surface: string; text: string; mutedText: string; border: string;
  fontFamily: string; fontAsset?: string; radius: number; sourceUrl: string; extractedAt: string; source: 'computed'|'screenshots';
}
export interface ProductVisualModel { heading?: string; labels: string[]; layout: 'dashboard'|'table'|'calendar'|'form'|'analytics'|'workspace'; accent?: string; }
export interface CursorSample { at: number; x: number; y: number; kind: 'move'|'click'|'type'; }
export type NarrationVoice='melo_india'|'af_heart'|'am_michael';
export interface RenderSettings { motion: 'cinematic'|'subtle'; subtitles: boolean; cursorHighlights: boolean; narration?: boolean; narrationEngine?: 'natural'|'system'; narrationVoice?: NarrationVoice; themeSource?: 'product'|'custom'; promoAspect?: 'landscape'|'portrait'; }
export const DEFAULT_RENDER_SETTINGS: RenderSettings = { motion: 'cinematic', subtitles: true, cursorHighlights: true, narration: true, narrationEngine:'natural', narrationVoice:'melo_india', themeSource: 'product', promoAspect: 'landscape' };
export interface NarrationStatus { naturalReady:boolean; systemReady:boolean; state:'missing'|'installing'|'ready'|'failed'; message:string; progress?:number; voices:{id:string;label:string;ready:boolean}[]; }
export interface Scene { id: string; title: string; caption: string; narration: string; duration: number; screenshot?: string; recordingStart?: number; recordingEnd?: number; recordingRanges?: {start:number;end:number}[]; feature?: string; focus?: CameraFocus; focusArea?: PrivacyMask; focusRevealAt?: number; redactions?: PrivacyMask[]; visualModel?: ProductVisualModel; }
export interface Source { title: string; url: string; summary: string; }
export interface Finding { feature: string; status: 'observed'|'not-observed'; evidence: string; screenshot?: string; }
export interface Shot { id: string; title: string; url: string; screenshot: string; at: number; action?: string; visualModel?: ProductVisualModel; focusArea?: PrivacyMask; entryStart?:number; entrySettled?:number; actionStart?:number; actionEnd?:number; }
export interface LogEntry { time: string; message: string; level: 'info'|'warn'|'error'; }
export interface VideoOutput { kind: OutputKind; file: string; poster?: string; width: number; height: number; fps: number; duration: number; narrated?: boolean; revision?: string; }
export interface Project {
  id: string; brief: Brief; createdAt: string; updatedAt: string; stage: Stage; progress: number;
  message: string; logs: LogEntry[]; sources: Source[]; findings: Finding[]; shots: Shot[];
  scenes: Scene[]; outputs: VideoOutput[]; recording?: string; error?: string;
  cursorTrack?: CursorSample[]; renderSettings?: RenderSettings; productTheme?: ProductTheme;
}
export interface Health { ai: {installed:boolean;connected:boolean;provider:string;message:string}; browser:boolean; ffmpeg:boolean; version:string; }
