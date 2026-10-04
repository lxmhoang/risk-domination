/* =========================================================================
   RUNTIME CONFIG (Settings screen)
   ---------------------------------------------------------------------
   GAME_CONFIG (defined above, inlined from src/config.json at build time) is the
   shipped default. RUNTIME_CONFIG is what the game actually reads: GAME_CONFIG
   overlaid with whatever the player changed on the Settings screen, persisted in
   localStorage so it survives reloads without needing a rebuild. The Settings
   screen can also export the current values back out as a config.json file to
   promote them into the real source-of-truth default for the next build.
   ========================================================================= */
const SETTINGS_STORAGE_KEY = 'riskDominationSettings';
function loadRuntimeConfig(){
  let stored = {};
  try{ stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}'); }catch(e){ stored = {}; }
  return Object.assign({}, GAME_CONFIG, stored);
}
RUNTIME_CONFIG = loadRuntimeConfig();
function saveRuntimeConfig(){ localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(pickConfig(RUNTIME_CONFIG))); }
function setConfigValue(key, value){ RUNTIME_CONFIG[key] = value; saveRuntimeConfig(); }
function resetRuntimeConfig(){ RUNTIME_CONFIG = Object.assign({}, GAME_CONFIG); localStorage.removeItem(SETTINGS_STORAGE_KEY); }

/* =========================================================================
   KEYBOARD-SHORTCUT HINTS
   ---------------------------------------------------------------------
   There's no reliable API to ask "does this device have a physical keyboard" up
   front (touch-capable laptops exist, desktops without touch exist, etc.) — so
   instead this waits for actual proof: the first real keydown event. Once one
   fires, every button built with withShortcut() starts showing its key in the
   label too, retroactively (a re-render is triggered right away) and for every
   button rendered from then on — never guessed ahead of time, so mobile/touch
   players who never press a key simply never see hints they can't use.
   ========================================================================= */
let hasKeyboardDetected = false;
window.addEventListener('keydown', ()=>{
  if(hasKeyboardDetected) return;
  hasKeyboardDetected = true;
  if(game && document.getElementById('screen-game').classList.contains('active')) renderGame();
}, {capture:true});
function withShortcut(label, key){ return hasKeyboardDetected ? `${label} (${key.toUpperCase()})` : label; }

/* =========================================================================
   UTILITIES
   ========================================================================= */
const $ = (id)=>document.getElementById(id);
function el(tag, cls, html){ const e=document.createElement(tag); if(cls) e.className=cls; if(html!==undefined) e.innerHTML=html; return e; }
function shadeColor(hex, percent){
  // percent negative = darker/richer, positive = lighter/washed out
  const num = parseInt(hex.slice(1),16);
  let r = (num>>16) + Math.round(2.55*percent);
  let g = ((num>>8)&0xff) + Math.round(2.55*percent);
  let b = (num&0xff) + Math.round(2.55*percent);
  r=clamp(r,0,255); g=clamp(g,0,255); b=clamp(b,0,255);
  return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1).toUpperCase();
}
let _stripeTileCanvas = null;
function getStripeTile(){
  if(_stripeTileCanvas) return _stripeTileCanvas;
  const size = 12;
  const c = document.createElement('canvas'); c.width=size; c.height=size;
  const cx = c.getContext('2d');
  cx.strokeStyle = 'rgba(255,255,255,0.85)';
  cx.lineWidth = 3;
  cx.lineCap = 'square';
  // three parallel 45-degree segments so the tile wraps seamlessly when repeated
  [-size, 0, size].forEach(off=>{
    cx.beginPath();
    cx.moveTo(off, size);
    cx.lineTo(off+size, 0);
    cx.stroke();
  });
  _stripeTileCanvas = c;
  return c;
}
function getStripePattern(ctx){ return ctx.createPattern(getStripeTile(), 'repeat'); }
// Same offscreen-tile-pattern technique as getStripeTile() above, but a sparse field of tiny
// semi-transparent dots instead of diagonal lines — layered over each territory's gradient
// fill (see drawGameCanvas) at low alpha for a subtle paper/grain texture, cheap stand-in for
// real hand-drawn texture art.
let _noiseTileCanvas = null;
function getNoiseTile(){
  if(_noiseTileCanvas) return _noiseTileCanvas;
  const size = 48;
  const c = document.createElement('canvas'); c.width=size; c.height=size;
  const cx = c.getContext('2d');
  for(let i=0;i<90;i++){
    const x = rand(size), y = rand(size), r = 0.4+Math.random()*0.9;
    cx.beginPath(); cx.arc(x,y,r,0,Math.PI*2);
    cx.fillStyle = Math.random()<0.5 ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)';
    cx.fill();
  }
  _noiseTileCanvas = c;
  return c;
}
function getNoisePattern(ctx){ return ctx.createPattern(getNoiseTile(), 'repeat'); }
// Draws text centered at (x,y) — assumes ctx.textAlign='center', ctx.textBaseline='middle' —
// on a translucent dark rounded-rect background. Continent labels sit directly on top of
// whatever territory colors happen to be underneath (unlike army badges, which always sit on a
// fixed dark circle), so a plain drop-shadow isn't reliably legible against every color; a
// solid backing box is.
function fillTextWithBackground(ctx, text, x, y){
  const metrics = ctx.measureText(text);
  const textW = metrics.width;
  const ascent = metrics.actualBoundingBoxAscent || 12;
  const descent = metrics.actualBoundingBoxDescent || 5;
  const padX = 8, padY = 4;
  const boxX = x-textW/2-padX, boxY = y-ascent-padY;
  const boxW = textW+padX*2, boxH = ascent+descent+padY*2;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  if(ctx.roundRect){ ctx.beginPath(); ctx.roundRect(boxX, boxY, boxW, boxH, 6); ctx.fill(); }
  else ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x, y);
}
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  $(id).classList.add('active');
  // Lets mobile CSS hide the outer app header while playing, to give the map more room.
  document.body.classList.toggle('in-game-screen', id==='screen-game');
}

// Bright ocean blue used for water fill on both canvases and for the space around the map,
// so zooming out reads as one continuous ocean surrounding the continents.

const OCEAN_COLOR = '#1CB5E0';
const PLAYER_COLORS = [
  {name:"Đỏ", hex:"#ef5b6b"}, {name:"Xanh dương", hex:"#5b8def"}, {name:"Xanh lá", hex:"#4ac97e"},
  {name:"Vàng", hex:"#f2c94c"}, {name:"Tím", hex:"#9b5de5"}, {name:"Cam", hex:"#f2994a"}
];
