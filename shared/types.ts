export type Stage = 'draft'|'researching'|'exploring'|'review'|'rendering'|'complete'|'failed'|'cancelled';
export type OutputKind = 'demo'|'promo';
export interface Brief {
  name: string; url: string; description: string; purpose: string; actors: string;
  features: string[]; brandColor: string; duration: number; resolution: '720p'|'1080p';
  maxSteps: number; allowedOrigins: string[]; allowWrites: boolean; sample: boolean;
}
export interface Scene { id: string; title: string; caption: string; narration: string; duration: number; screenshot?: string; recordingStart?: number; recordingEnd?: number; feature?: string; }
export interface Source { title: string; url: string; summary: string; }
export interface Finding { feature: string; status: 'observed'|'not-observed'; evidence: string; screenshot?: string; }
export interface Shot { id: string; title: string; url: string; screenshot: string; at: number; action?: string; }
export interface LogEntry { time: string; message: string; level: 'info'|'warn'|'error'; }
export interface VideoOutput { kind: OutputKind; file: string; poster?: string; width: number; height: number; fps: number; duration: number; }
export interface Project {
  id: string; brief: Brief; createdAt: string; updatedAt: string; stage: Stage; progress: number;
  message: string; logs: LogEntry[]; sources: Source[]; findings: Finding[]; shots: Shot[];
  scenes: Scene[]; outputs: VideoOutput[]; recording?: string; error?: string;
}
export interface Health { ai: {installed:boolean;connected:boolean;provider:string;message:string}; browser:boolean; ffmpeg:boolean; version:string; }
