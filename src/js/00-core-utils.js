/* =========================================================================
   CORE BASE — shared by the browser build and the server (dist/core.js)
   ---------------------------------------------------------------------
   Files listed in CORE_FILES (build.js) are the game's rules, AI and map model. They run both
   in the browser and in Node, so they must never touch the DOM, window or localStorage — the
   build fails if they do. Everything the core needs from its surroundings goes through `host`.
   ========================================================================= */

// What the core asks of whoever is running it. The browser fills these in with the real UI
// functions (see the Object.assign(host, …) in 08-wiring.js); the server records them as events;
// left alone they do nothing, which is all a headless run needs.
const host = {
  renderGame(){}, renderCombatLog(){}, setActionHint(){}, showDice(){}, showTurnIntro(){},
  openCardsModal(){}, showGameOver(){},
  // plays the attack animation, then calls onDone — with nothing to show, straight away
  startAttackAnim(info, onDone){ if(onDone) onDone(); },
  onGameInit(){},      // a new game object was just created (reset view state)
  beforeEndTurn(){},   // called with the player whose turn is ending, before anything changes
  schedule: null,      // (fn, delayMs) — replaces the default pausable setTimeout in aiSchedule()
};

/* ---- Config ---- */
// GAME_CONFIG (inlined from src/config.json at build time, or passed to createCore() on the
// server) is the shipped default. RUNTIME_CONFIG is what the game actually reads — the browser
// overlays the player's saved settings onto it (01-utils.js).
const CONFIG_KEYS = Object.keys(GAME_CONFIG); // every key in src/config.json is a setting
function pickConfig(obj){ const out={}; CONFIG_KEYS.forEach(k=> out[k]=obj[k]); return out; }
let RUNTIME_CONFIG = Object.assign({}, GAME_CONFIG);

/* ---- Utilities ---- */
function rand(n){ return Math.floor(Math.random()*n); }
function randChoice(arr){ return arr[rand(arr.length)]; }
function shuffle(arr){ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=rand(i+1); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
// Rough perceptual distance between 2 hex colors (Euclidean over RGB — good enough for picking
// visually-distinct continent colors, no need for a proper color space here).
function colorDistance(hexA, hexB){
  const a = parseInt(hexA.slice(1),16), b = parseInt(hexB.slice(1),16);
  const dr = ((a>>16)&255)-((b>>16)&255), dg = ((a>>8)&255)-((b>>8)&255), db = (a&255)-(b&255);
  return Math.sqrt(dr*dr+dg*dg+db*db);
}
function rollDie(){ return 1+rand(6); }
// Real-world grounding for how big a freshly random-generated map's territories should be:
// mobile touch-target guidelines (iOS Human Interface Guidelines, Android Material Design)
// call for a minimum ~44px tappable area. Territories — not individual grid cells — are what
// the player actually taps, so the target below is the AVERAGE territory footprint. It's set
// equal to that 44px minimum (no headroom multiplier) — a smaller target means more, smaller
// territories per map, which was chosen deliberately over guaranteeing every single
// below-average territory clears the touch target too.
const TOUCH_TARGET_PX = 44;
const AVG_TERRITORY_TARGET_PX = TOUCH_TARGET_PX*1.5;

// Rough estimate of the canvas's usable width share of the viewport, leaving room for the
// surrounding overlay panels/chrome whose exact size isn't known before layout happens. Used by
// computeCellsPerTerritory() in 02-map-model.js.
// A generated map's grid/territory count is baked into its data — it doesn't get re-partitioned
// when later opened on a different device. So this is deliberately NOT the current device's
// actual window.innerWidth: sizing off whatever screen happens to generate the map would make a
// map generated on desktop (more territories, calibrated to desktop's wider canvas) unplayably
// cramped if later opened on mobile, even though the reverse (mobile-generated map opened on
// desktop — same content, just rendered bigger on the larger canvas) is always fine. Fixed at a
// conservative mobile-landscape width instead, so every map is comfortable on the smallest
// supported device by construction and only ever looks BIGGER, never smaller, elsewhere.
const MOBILE_BASELINE_WIDTH = 700;
function estimateCanvasWidth(){
  return Math.max(320, MOBILE_BASELINE_WIDTH*0.72);
}
// A few entries here used to be bright/pale blues or teals ("#98c1d9","#00bbf9","#00f5d4",
// "#2ec4b6","#1982c4") close enough to the bright ocean color (see OCEAN_COLOR in
// 06-render-game.js/03-editor.js) that a territory/continent using one could visually blend
// into the surrounding water — swapped for warm/jewel tones with no such collision instead.
const PALETTE_TERR = ["#e07a5f","#81b29a","#f2cc8f","#3d5a80","#e8998d","#c9a0dc","#f4a261","#e76f51",
  "#606c38","#bc6c25","#457b9d","#d62828","#6a994e","#a7c957","#9b5de5","#f15bb5","#ffb703","#c9184a",
  "#fee440","#ff9f1c","#7209b7","#e71d36","#8ac926","#fb8500","#6a4c93","#ff595e"];
const PALETTE_CONT = ["#5b8def","#4ac97e","#f2b84b","#ef5b6b","#9b5de5","#f72585","#ff9f5b","#7bd389"];
// Turn-intro banner timing (see showTurnIntro() in 06-render-game.js) — kept here rather than
// in that file so 04-game-state.js's startReinforce() can reference TURN_INTRO_TOTAL_MS without
// depending on the DOM-only render module (also the module the AI smoke-test harness loads
// alongside 04, since it deliberately skips 06-08).
const TURN_INTRO_SHOW_MS = 1000;
const TURN_INTRO_FADE_MS = 400;
const TURN_INTRO_TOTAL_MS = TURN_INTRO_SHOW_MS + TURN_INTRO_FADE_MS;

// Radius (canvas-space units, same as map.cellSize) of the fixed-size army badge drawn on each
// territory (drawArmyBadge, 06-render-game.js). The random map generator sizes territories so
// 3 of these fit in each one (territoryFitsBadges, 02-map-model.js).
const ARMY_BADGE_RADIUS = 13;
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
