import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ProductTheme, Project } from '../shared/types.js';
import { sanitizeFontFamily } from './product-theme.js';

const color=(value:string|undefined,fallback:string)=>/^#[\da-f]{6}$/i.test(value||'')?value!:fallback;
export function resolveFilmTheme(project:Pick<Project,'brief'|'productTheme'|'renderSettings'>):ProductTheme{
  const p=project.productTheme;
  return {accent:color(project.renderSettings?.themeSource==='custom'?project.brief.brandColor:p?.accent,project.brief.brandColor),secondary:color(p?.secondary,'#e8f4fc'),background:color(p?.background,'#f4f7fb'),surface:color(p?.surface,'#ffffff'),text:color(p?.text,'#1e2b3e'),mutedText:color(p?.mutedText,'#68768a'),border:color(p?.border,'#dde5ed'),fontFamily:sanitizeFontFamily(p?.fontFamily||'Arial'),fontAsset:p?.fontAsset,radius:Math.max(0,Math.min(32,p?.radius??12)),sourceUrl:p?.sourceUrl||project.brief.url,extractedAt:p?.extractedAt||'',source:p?.source||'screenshots'};
}

/** Embed only bounded, locally captured fonts; rendering never fetches a remote URL. */
export async function productFontCss(directory:string,theme:ProductTheme):Promise<string>{
  if(!theme.fontAsset)return '';
  if(!/^[a-zA-Z0-9_-]+\.(woff2?|ttf|otf)$/.test(theme.fontAsset))throw new Error('Invalid product font asset.');
  const root=await realpath(directory),file=await realpath(path.join(directory,theme.fontAsset));
  if(!file.startsWith(root+path.sep))throw new Error('Product font must stay in its project directory.');
  const bytes=await readFile(file);if(bytes.length>2_000_000)throw new Error('Product font is too large.');
  const signature=bytes.subarray(0,4).toString('latin1');
  if(!['wOF2','wOFF','OTTO','\u0000\u0001\u0000\u0000'].includes(signature))throw new Error('Product font format is invalid.');
  const type=signature==='wOF2'?'woff2':signature==='wOFF'?'woff':signature==='OTTO'?'otf':'ttf';
  // Family is sanitized before interpolation. It matches the product's computed CSS family.
  return `@font-face{font-family:"${sanitizeFontFamily(theme.fontFamily).split(',')[0].trim()}";src:url(data:font/${type};base64,${bytes.toString('base64')});font-weight:400;font-style:normal;font-display:block}`;
}
