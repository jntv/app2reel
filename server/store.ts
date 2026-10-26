import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { DEFAULT_RENDER_SETTINGS, type Brief, type Project } from '../shared/types.js';

export const briefSchema = z.object({
  name: z.string().trim().min(1).max(100), url: z.string().url().max(2000).refine(v=>{const u=new URL(v);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;},'Use an HTTP or HTTPS URL without embedded credentials'),
  description: z.string().trim().min(5).max(5000), purpose: z.string().trim().min(3).max(2000),
  actors: z.string().trim().min(2).max(2000), features: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  brandColor: z.string().regex(/^#[0-9a-f]{6}$/i).default('#e85b32'),
  duration: z.number().int().min(10).max(90).default(30), resolution: z.enum(['720p','1080p']).default('1080p'),
  maxSteps: z.number().int().min(3).max(60).default(16),
  allowedOrigins: z.array(z.string().url().refine(v=>{const u=new URL(v);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password;})).max(10).default([]),
  allowWrites: z.boolean().default(false), sample: z.boolean().default(false)
}).strict();

export const renderSettingsSchema = z.object({
  motion: z.enum(['cinematic','subtle']), subtitles: z.boolean(), cursorHighlights: z.boolean(),
  narration: z.boolean().optional(), themeSource: z.enum(['product','custom']).optional()
}).strict();

const colorSchema=z.string().regex(/^#[0-9a-f]{6}$/i);
export const productThemeSchema=z.object({accent:colorSchema,secondary:colorSchema.optional(),background:colorSchema,surface:colorSchema,text:colorSchema,mutedText:colorSchema,border:colorSchema,fontFamily:z.string().max(100).regex(/^[a-zA-Z0-9 ,._-]+$/),fontAsset:z.string().regex(/^[a-zA-Z0-9_-]+\.(woff2?|ttf|otf)$/).optional(),radius:z.number().min(0).max(32),sourceUrl:z.string().url().max(2000),extractedAt:z.string().max(40),source:z.enum(['computed','screenshots'])}).strict();
const rectangleSchema=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().min(.001).max(1),height:z.number().min(.001).max(1)}).strict().refine(value=>value.x+value.width<=1+1e-8&&value.y+value.height<=1+1e-8,'The region must fit inside the recording.');
const visualModelSchema=z.object({heading:z.string().max(100).optional(),labels:z.array(z.string().max(70)).max(12),layout:z.enum(['dashboard','table','calendar','form','analytics','workspace']),accent:colorSchema.optional()}).strict();

export const sceneSchema = z.object({
  id:z.string().min(1).max(100),title:z.string().min(1).max(160),caption:z.string().max(360),
  narration:z.string().max(2000),duration:z.number().min(1).max(30),
  screenshot:z.string().regex(/^[a-zA-Z0-9._-]+\.(png|jpg)$/).optional(),
  recordingStart:z.number().nonnegative().optional(),recordingEnd:z.number().nonnegative().optional(),
  feature:z.string().max(200).optional(),
  focus:z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),zoom:z.number().min(1).max(2.4)}).strict().optional(),
  focusArea:rectangleSchema.optional(),visualModel:visualModelSchema.optional(),
  redactions:z.array(rectangleSchema).max(8).optional()
}).strict();

export class Store {
  readonly events = new EventEmitter();
  readonly projects = new Map<string,Project>();
  private writes = new Map<string,Promise<void>>();
  constructor(readonly root:string) { this.events.setMaxListeners(100); }
  async init() {
    await mkdir(this.root,{recursive:true,mode:0o700});
    for(const id of await readdir(this.root)) {
      if(!/^[0-9a-f-]{36}$/.test(id)) continue;
      try { const p = JSON.parse(await readFile(path.join(this.root,id,'project.json'),'utf8')) as Project;
        if(p.id !== id) continue;
        if(['researching','exploring','rendering'].includes(p.stage)) { p.stage='failed'; p.message='Run interrupted by server restart. You can start again.';p.error=p.message; }
        this.projects.set(id,p);
      } catch { /* ignore incomplete project directories */ }
    }
  }
  dir(id:string) { if(!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid project ID');return path.join(this.root,id); }
  get(id:string) { const p=this.projects.get(id);if(!p) throw Object.assign(new Error('Project not found'),{status:404});return p; }
  async create(brief:Brief) {
    const now=new Date().toISOString();const p:Project={id:randomUUID(),brief,createdAt:now,updatedAt:now,stage:'draft',progress:0,message:'Your product film starts here.',logs:[],sources:[],findings:[],shots:[],scenes:[],outputs:[],renderSettings:{...DEFAULT_RENDER_SETTINGS}};
    await mkdir(this.dir(p.id),{recursive:true,mode:0o700});this.projects.set(p.id,p);await this.save(p);return p;
  }
  async save(p:Project) {
    p.updatedAt=new Date().toISOString();
    const snapshot=JSON.stringify(p,null,2);
    const task=(this.writes.get(p.id)??Promise.resolve()).catch(()=>{}).then(async()=>{
      const target=path.join(this.dir(p.id),'project.json');await writeFile(target+'.tmp',snapshot,{mode:0o600});await rename(target+'.tmp',target);
    });
    this.writes.set(p.id,task);await task;this.events.emit(p.id,p);
  }
  async log(p:Project,message:string,level:'info'|'warn'|'error'='info') { p.logs.push({time:new Date().toISOString(),message,level});p.logs=p.logs.slice(-200);p.message=message;await this.save(p); }
}
