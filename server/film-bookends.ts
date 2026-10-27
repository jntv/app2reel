import type { ProductTheme } from '../shared/types.js';

export interface FilmBookendState {
  kind: 'intro' | 'outro' | 'none';
  opacity: number;
  reveal: number;
  tagline?: string;
}

const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const ease = (value: number) => { const t = clamp(value); return t * t * t * (t * (t * 6 - 15) + 10); };

/** Retain the secondary hue, with headroom for the closing card's pale accent glow. */
export function bookendClosingColor(value: unknown): string {
  const color = typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : '#1e293b';
  const rgb = [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16));
  const luminance = (scale: number) => rgb.reduce((sum, channel, index) => {
    const normalized = channel * scale / 255;
    const linear = normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
    return sum + linear * [.2126, .7152, .0722][index];
  }, 0);
  if (luminance(1) <= .055) return color;
  let dark = 0, light = 1;
  for (let step = 0; step < 24; step++) {
    const scale = (dark + light) / 2;
    if (luminance(scale) <= .055) dark = scale; else light = scale;
  }
  return '#' + rgb.map(channel => Math.floor(channel * dark).toString(16).padStart(2, '0')).join('');
}

/** Branded beats share the reviewed picture/voice clock, without inserting hidden seconds. */
export function filmBookendState(time: number, duration: number, first: boolean, last: boolean, kind: 'demo' | 'promo'): FilmBookendState {
  const seconds = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const t = Math.max(0, Math.min(seconds, Number.isFinite(time) ? time : 0));
  const available = Math.max(0, seconds - 2);
  let intro = first ? Math.min(kind === 'demo' ? 5.2 : 4.9, seconds * (kind === 'demo' ? .67 : .72), available) : 0;
  let outro = last ? Math.min(kind === 'demo' ? 8.6 : 6.6, seconds * (kind === 'demo' ? .8 : .68), available) : 0;
  // A one-scene film still gets a visible product beat between its two cards.
  if (intro + outro > available && first && last) {
    const scale = available / (intro + outro);
    intro *= scale; outro *= scale;
  }
  if (intro > 0 && t < intro) {
    const dissolve = Math.min(.75, intro * .45);
    return { kind: 'intro', opacity: 1 - ease((t - intro + dissolve) / dissolve), reveal: ease(t / Math.min(.85, intro * .4)) };
  }
  const outroStart = seconds - outro;
  if (outro > 0 && t >= outroStart) {
    const elapsed = t - outroStart, entrance = Math.min(.8, outro * .45);
    return { kind: 'outro', opacity: ease(elapsed / entrance), reveal: ease(elapsed / Math.min(1.05, outro * .55)) };
  }
  return { kind: 'none', opacity: 0, reveal: 0 };
}

/** The same quiet brand lockup is composed natively for both film aspect ratios. */
export function filmBookendLayer(width: number, height: number, theme: Pick<ProductTheme, 'accent' | 'secondary' | 'background' | 'surface' | 'text' | 'border'>): { styles: string; markup: string; script: string } {
  const portrait = height > width, unit = width / (portrait ? 720 : 1280);
  const color = (value: unknown, fallback: string) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
  const accent = color(theme.accent, '#0a8fdc'), navy = bookendClosingColor(theme.secondary);
  const background = color(theme.background, '#fafafa'), text = color(theme.text, '#111827'), border = color(theme.border, '#e0e0e0');
  return {
    styles: `
.film-bookend{--bu:${unit}px;--bookend-accent:${accent};--bookend-ink:${text};position:absolute;inset:0;z-index:12;display:none;align-items:center;justify-content:center;overflow:hidden;pointer-events:none;color:var(--bookend-ink);background:radial-gradient(ellipse at 16% 4%,color-mix(in srgb,${accent} 13%,transparent),transparent 62%),radial-gradient(ellipse at 95% 100%,color-mix(in srgb,${accent} 7%,transparent),transparent 57%),${background}}.film-bookend:before{content:'';position:absolute;inset:calc(25*var(--bu));border:1px solid color-mix(in srgb,${border} 70%,transparent);border-radius:calc(18*var(--bu));pointer-events:none}.bookend-orbit{position:absolute;left:50%;top:50%;width:calc(${portrait ? 610 : 930}*var(--bu));height:calc(${portrait ? 610 : 930}*var(--bu));margin-left:calc(${portrait ? -305 : -465}*var(--bu));margin-top:calc(${portrait ? -305 : -465}*var(--bu));border:1px solid color-mix(in srgb,${accent} 10%,transparent);border-radius:50%;transform:scale(1);opacity:.65}.bookend-orbit:after{content:'';position:absolute;inset:calc(55*var(--bu));border:1px solid color-mix(in srgb,${accent} 7%,transparent);border-radius:50%}.bookend-content{position:relative;width:100%;padding:0 calc(${portrait ? 78 : 70}*var(--bu));text-align:center;display:flex;align-items:center;flex-direction:column;max-height:calc(100% - ${portrait ? 210 : 135}*var(--bu));margin-top:calc(-${portrait ? 50 : 18}*var(--bu))}.bookend-content>*{flex-shrink:0}.bookend-eyebrow{display:flex;align-items:center;justify-content:center;gap:calc(13*var(--bu));font-size:calc(${portrait ? 13 : 11}*var(--bu));line-height:1.5;letter-spacing:.19em;text-transform:uppercase;font-weight:600;color:var(--bookend-accent);margin-bottom:calc(${portrait ? 34 : 25}*var(--bu))}.bookend-eyebrow:before{content:'';width:calc(26*var(--bu));height:1px;background:currentColor;opacity:.65}.bookend-name{font-size:calc(${portrait ? 85 : 108}*var(--bu));font-weight:650;line-height:1.08;letter-spacing:-.065em;max-width:100%;margin:0;overflow-wrap:anywhere;text-wrap:balance}.bookend-rule{height:calc(3*var(--bu));width:calc(56*var(--bu));margin:calc(${portrait ? 32 : 27}*var(--bu)) 0;background:var(--bookend-accent);border-radius:10px;transform-origin:center}.bookend-tagline{max-width:calc(${portrait ? 550 : 790}*var(--bu));font-size:calc(${portrait ? 28 : 25}*var(--bu));line-height:1.5;letter-spacing:-.03em;font-weight:400;text-wrap:balance;color:color-mix(in srgb,var(--bookend-ink) 73%,transparent);overflow-wrap:anywhere}.bookend-url{display:none;align-items:center;justify-content:center;gap:calc(14*var(--bu));font-size:calc(${portrait ? 21 : 20}*var(--bu));font-weight:500;line-height:1.4;letter-spacing:-.015em;margin-top:calc(36*var(--bu));padding:calc(13*var(--bu)) calc(22*var(--bu));max-width:100%;border:1px solid #ffffff3b;border-radius:calc(40*var(--bu));background:#ffffff09;color:white;overflow-wrap:anywhere}.bookend-url-text{min-width:0}.bookend-arrow{font-size:calc(24*var(--bu));line-height:1;flex:none;color:color-mix(in srgb,${accent} 45%,white)}.film-bookend.outro{--bookend-ink:#ffffff;--bookend-accent:color-mix(in srgb,${accent} 60%,white);background:radial-gradient(ellipse at 18% 0%,color-mix(in srgb,${accent} 23%,transparent),transparent 64%),radial-gradient(ellipse at 95% 100%,color-mix(in srgb,${accent} 12%,transparent),transparent 65%),${navy}}.film-bookend.outro:before{border-color:#ffffff14}.film-bookend.outro .bookend-orbit{border-color:#ffffff09}.film-bookend.outro .bookend-orbit:after{border-color:#ffffff06}.film-bookend.outro .bookend-url{display:flex}.film-bookend.outro .bookend-tagline{font-size:calc(${portrait ? 27 : 24}*var(--bu));color:#ffffffbb}.film-bookend.outro .bookend-content{margin-top:calc(-${portrait ? 42 : 10}*var(--bu))}.film-bookend.outro .bookend-rule{margin:calc(25*var(--bu)) 0}.film-bookend.intro .bookend-tagline:empty{display:none}.film-bookend.intro .bookend-url{display:none}
`,
    markup: `<section id="film-bookend" class="film-bookend"><div class="bookend-orbit"></div><div class="bookend-content"><div class="bookend-eyebrow" id="bookend-eyebrow"></div><h1 class="bookend-name" id="bookend-name"></h1><div class="bookend-rule"></div><div class="bookend-tagline" id="bookend-tagline"></div><div class="bookend-url"><span class="bookend-url-text" id="bookend-url"></span><span class="bookend-arrow">↗</span></div></div></section>`,
    script: `
window.paintFilmBookend=function(s){
 const layer=document.getElementById('film-bookend'),b=s.bookend,clamp=v=>Math.max(0,Math.min(1,Number(v)||0));
 const active=Boolean(b&&b.kind!=='none'&&clamp(b.opacity)>0);layer.style.display=active?'flex':'none';layer.dataset.kind=b?.kind||'none';
 if(!active)return;
 const outro=b.kind==='outro',reveal=clamp(b.reveal),opacity=clamp(b.opacity);layer.className='film-bookend '+(outro?'outro':'intro');layer.style.opacity=String(opacity);
 document.getElementById('bookend-eyebrow').textContent=outro?'Explore':'Introducing';
 const name=document.getElementById('bookend-name');name.textContent=String(s.name||'');
 const tagline=document.getElementById('bookend-tagline');tagline.textContent=String(b.tagline||(outro?'See what’s possible with '+String(s.name||'your workspace'):s.caption||s.title||''));
 const url=document.getElementById('bookend-url'),raw=String(s.url||'');let address='';try{address=new URL(raw.includes('://')?raw:'https://'+raw).host}catch{address=raw.split(/[/?#]/)[0].slice(0,180)}url.textContent=address;
 const u=${unit},content=layer.querySelector('.bookend-content'),fit=(node,start,min,maxHeight)=>{let size=start;node.style.fontSize=size*u+'px';while(size>min&&(node.scrollWidth>node.clientWidth+1||node.offsetHeight>maxHeight*u)){size-=2;node.style.fontSize=size*u+'px'}};
 fit(name,${portrait ? 85 : 108},${portrait ? 42 : 48},${portrait ? 350 : 240});fit(tagline,${portrait ? 28 : 25},${portrait ? 18 : 17},${portrait ? 210 : 110});fit(url,${portrait ? 21 : 20},14,${portrait ? 90 : 65});
 content.style.transform='translateY('+((1-reveal)*${portrait ? 22 : 18}*u)+'px)';content.style.opacity=String(reveal);name.style.transform='translateY('+((1-reveal)*12*u)+'px)';
 layer.querySelector('.bookend-rule').style.transform='scaleX('+(.3+.7*reveal)+')';layer.querySelector('.bookend-orbit').style.transform='scale('+(1.025-.025*reveal)+')';
};
`,
  };
}
