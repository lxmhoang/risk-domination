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
const CONFIG_KEYS = ['spectatorModeDelayMs','manualInitialPlacement','cardAwardEvent'];
const SETTINGS_STORAGE_KEY = 'riskDominationSettings';
function pickConfig(obj){ const out={}; CONFIG_KEYS.forEach(k=> out[k]=obj[k]); return out; }
function loadRuntimeConfig(){
  let stored = {};
  try{ stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}'); }catch(e){ stored = {}; }
  return Object.assign({}, GAME_CONFIG, stored);
}
let RUNTIME_CONFIG = loadRuntimeConfig();
function saveRuntimeConfig(){ localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(pickConfig(RUNTIME_CONFIG))); }
function setConfigValue(key, value){ RUNTIME_CONFIG[key] = value; saveRuntimeConfig(); }
function resetRuntimeConfig(){ RUNTIME_CONFIG = Object.assign({}, GAME_CONFIG); localStorage.removeItem(SETTINGS_STORAGE_KEY); }

/* =========================================================================
   UTILITIES
   ========================================================================= */
const $ = (id)=>document.getElementById(id);
function el(tag, cls, html){ const e=document.createElement(tag); if(cls) e.className=cls; if(html!==undefined) e.innerHTML=html; return e; }
function rand(n){ return Math.floor(Math.random()*n); }
function randChoice(arr){ return arr[rand(arr.length)]; }
function shuffle(arr){ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=rand(i+1); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
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
function rollDie(){ return 1+rand(6); }
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  $(id).classList.add('active');
  // Lets mobile CSS hide the outer app header while playing, to give the map more room.
  document.body.classList.toggle('in-game-screen', id==='screen-game');
}

const PALETTE_TERR = ["#e07a5f","#81b29a","#f2cc8f","#3d5a80","#98c1d9","#c9a0dc","#f4a261","#e76f51",
  "#606c38","#bc6c25","#457b9d","#d62828","#6a994e","#a7c957","#9b5de5","#f15bb5","#00bbf9","#00f5d4",
  "#fee440","#ff9f1c","#2ec4b6","#e71d36","#8ac926","#1982c4","#6a4c93","#ff595e"];
const PALETTE_CONT = ["#5b8def","#4ac97e","#f2b84b","#ef5b6b","#9b5de5","#3fd0c9","#ff9f5b","#7bd389"];
const PLAYER_COLORS = [
  {name:"Đỏ", hex:"#ef5b6b"}, {name:"Xanh dương", hex:"#5b8def"}, {name:"Xanh lá", hex:"#4ac97e"},
  {name:"Vàng", hex:"#f2c94c"}, {name:"Tím", hex:"#9b5de5"}, {name:"Cam", hex:"#f2994a"}
];

/* ---------- Naming rules: territory names always lowercase, continent names always
   uppercase, no digits or special characters in either. ---------- */
const TERR_PREFIXES = ["đông","tây","nam","bắc","trung","thượng","hạ","tân","cổ","đại"];
const TERR_BASES = ["sơn","hà","giang","hải","phong","lâm","thảo","sa","đồng","hồ","vịnh","đảo",
  "làng","phố","thôn","đèo","gò","bãi","cồn","thung","cao","mộc","thủy","vân","yên","bình","an","khê","trại","doi"];
const CONT_WORDS = ["úc","phi","âu","á","mỹ","cực bắc","cực nam","hoang mạc","bình nguyên",
  "cao nguyên","quần đảo","thảo nguyên","đại dương","hải đảo","sơn nguyên"];

function stripInvalidNameChars(str){
  // Keep unicode letters and spaces only; strip digits, punctuation, symbols.
  return String(str||'').replace(/[^\p{L}\s]/gu,'').replace(/\s+/g,' ');
}
function finalizeTerrName(str){
  const s = stripInvalidNameChars(str).trim();
  return s ? s.toLocaleLowerCase('vi') : '';
}
function finalizeContName(str){
  const s = stripInvalidNameChars(str).trim();
  return s ? s.toLocaleUpperCase('vi') : '';
}
function defaultTerrName(id){
  const idx = id-1;
  const p = TERR_PREFIXES[idx % TERR_PREFIXES.length];
  const b = TERR_BASES[Math.floor(idx/TERR_PREFIXES.length) % TERR_BASES.length];
  return finalizeTerrName(p+' '+b);
}
function defaultContName(id){
  const idx = id-1;
  return finalizeContName(CONT_WORDS[idx % CONT_WORDS.length]);
}

