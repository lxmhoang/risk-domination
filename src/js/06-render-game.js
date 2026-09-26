/* =========================================================================
   RENDERING (GAME)
   ========================================================================= */
function playerOf(id){ return game.players[id]; }

// Traces a ctx path from one or more smoothed boundary loops (see getTerritoryBoundaryLoops()/
// getContinentBoundaryLoops() in 02-map-model.js) — multiple loops in one beginPath() combine
// correctly under the canvas default "nonzero" fill rule (holes come out already
// counter-wound, disjoint shapes just union together), so this works for both a single
// territory (outer edge + any water holes) and a combined set of several territories at once.
function pathFromLoops(ctx, loops){
  ctx.beginPath();
  loops.forEach(loop=>{
    if(loop.length<3) return;
    ctx.moveTo(loop[0][0], loop[0][1]);
    for(let i=1;i<loop.length;i++) ctx.lineTo(loop[i][0], loop[i][1]);
    ctx.closePath();
  });
}

// Lightens (percent>0) or darkens (percent<0) a "#rrggbb" color by roughly that percentage —
// used to turn a territory's flat owner/continent color into a small radial gradient (see
// drawGameCanvas) for a subtle "raised landmass" look, without needing actual texture art.
function shadeColor(hex, percent){
  const num = parseInt(hex.slice(1), 16);
  const amt = Math.round(2.55*percent);
  const r = clamp((num>>16)+amt, 0, 255);
  const g = clamp(((num>>8)&0x00FF)+amt, 0, 255);
  const b = clamp((num&0x0000FF)+amt, 0, 255);
  return '#'+(0x1000000+r*0x10000+g*0x100+b).toString(16).slice(1);
}
function lerpColor(hexA, hexB, t){
  const a = parseInt(hexA.slice(1),16), b = parseInt(hexB.slice(1),16);
  const ar=(a>>16)&255, ag=(a>>8)&255, ab=a&255;
  const br=(b>>16)&255, bg=(b>>8)&255, bb=b&255;
  const r = Math.round(ar+(br-ar)*t), g = Math.round(ag+(bg-ag)*t), bl = Math.round(ab+(bb-ab)*t);
  return '#'+(0x1000000+r*0x10000+g*0x100+bl).toString(16).slice(1);
}

// The army-count chip drawn on every territory — factored out of the main badge loop so the
// attack-phase pulse (bigger scale), the flying-attack badges, and the hollow placeholder they
// leave behind (opts.hollow — no fill gradient, no number) can all reuse the exact same look
// instead of hand-drawing 3 slightly-different versions of the same chip.
function drawArmyBadge(ctx, x, y, count, opts){
  opts = opts || {};
  const scale = opts.scale || 1;
  const r = 13*scale;
  ctx.save();
  ctx.shadowColor='rgba(0,0,0,0.5)'; ctx.shadowBlur=4*scale; ctx.shadowOffsetY=2*scale;
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
  if(opts.hollow){
    ctx.fillStyle='rgba(8,10,18,0.35)';
  } else {
    const badgeGrad = ctx.createRadialGradient(x-4*scale,y-5*scale,1, x,y,15*scale);
    badgeGrad.addColorStop(0, 'rgba(52,58,78,0.95)');
    badgeGrad.addColorStop(1, 'rgba(8,10,18,0.92)');
    ctx.fillStyle = badgeGrad;
  }
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = opts.strokeColor || '#fff';
  ctx.lineWidth = 1.5*scale;
  ctx.stroke();
  if(count!=null){
    ctx.fillStyle='#fff'; ctx.font='bold '+Math.round(12*scale)+'px sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(count, x, y+1);
  }
}

/* =========================================================================
   RENDER ANIMATION STATE
   ---------------------------------------------------------------------
   drawGameCanvas() redraws the WHOLE map from scratch every call, driven purely by current
   `game` state (no persistent visuals) — normally fine since it's only called on-demand after
   a state change. To animate a change (a territory's color fading to its new owner, an army
   count counting up/down, a capture particle burst) without threading animation code through
   every single mutation site (doBattle, aiFortifyStep, placeReinforcement, ...), this instead
   diffs the CURRENT game.owner/game.armies against what was drawn last frame, right here at the
   top of drawGameCanvas() — any difference starts the relevant animation automatically. While
   at least one is still running, drawGameCanvas() reschedules itself via requestAnimationFrame;
   otherwise rendering goes back to being purely event-driven (renderGame() calls), no idle loop.
   ========================================================================= */
let lastDrawnOwner = {};   // territory id -> owner id last actually drawn
let lastDrawnArmies = {};  // territory id -> army count last actually drawn
let colorFades = {};       // territory id -> {from, to, start} (hex colors, ms timestamp)
let armyTweens = {};       // territory id -> {from, to, start}
let captureParticles = []; // {x,y,vx,vy,color,start}
const COLOR_FADE_MS = 450, ARMY_TWEEN_MS = 350, PARTICLE_MS = 600;
let animFrameQueued = false;
function scheduleAnimFrame(){
  if(animFrameQueued) return;
  animFrameQueued = true;
  requestAnimationFrame(()=>{ animFrameQueued=false; if(game) drawGameCanvas(); });
}
// Called whenever a fresh `game` starts being drawn for the first time (new game, replay,
// loaded save) so leftover animation state from whatever was on screen before doesn't bleed
// into it (e.g. every territory "fading in" from the previous match's final colors).
function resetRenderAnimState(){
  lastDrawnOwner = {}; lastDrawnArmies = {}; colorFades = {}; armyTweens = {}; captureParticles = [];
  attackAnim = null;
}
function spawnCaptureParticles(x, y, color){
  const n = 14;
  for(let i=0;i<n;i++){
    const angle = (Math.PI*2*i/n) + Math.random()*0.5;
    const speed = 1.2+Math.random()*1.8;
    captureParticles.push({x, y, vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed, color, start:performance.now()});
  }
}

/* =========================================================================
   ATTACK-PHASE VISUALS
   ---------------------------------------------------------------------
   Three independent pieces, all driven by the same requestAnimationFrame loop as the render
   animation state above:
   1. Badge pulse — selectedFrom's (and, if it's a valid attack target, selectedTo's) army badge
      grows/shrinks in a loop while selected, drawn inline in drawGameCanvas()'s badge loop.
   2. drawAttackArrow() — an arrow that repeatedly grows from selectedFrom to selectedTo while
      both are chosen, giving the attack direction a constant, obvious visual instead of relying
      on the two highlighted borders alone.
   3. attackAnim — once an attack is actually launched (doSingleAttack()/allOutAttack()), takes
      over drawing fromId/toId's badges for a few hundred ms: the attacker's badge visibly flies
      to the defender, both show their losses, and (unless the territory was captured, in which
      case the normal owner-color-fade system just takes over) it flies back with the survivors.
      This replaces the old always-a-popup result dialog with something that reads at a glance
      without interrupting play.
   ========================================================================= */
const ATTACK_FLY_MS = 260, ATTACK_IMPACT_MS = 825, ATTACK_RETURN_MS = 320;
let attackAnim = null; // see startAttackAnim() for the shape of the info object passed in

// "Cụng ly" (clink glasses): the attacking badge pulls back a little first, THEN dashes in fast
// — not a plain constant slide — same anticipation-then-strike beat as clinking two glasses
// together. t is the fly stage's raw time fraction (0..1); dist is the actual on-screen distance
// between the two badges, since the pullback itself is a fixed pixel amount (1/3 of a badge's
// diameter) that needs converting to a fraction OF THAT distance to use as a position multiplier.
// Can return slightly negative (behind the starting point) during the windup.
function flyWindupFrac(t, dist){
  const WINDUP_FRAC = 0.22;
  const BADGE_DIAMETER = 26;
  const pullbackFrac = Math.min(0.5, (BADGE_DIAMETER/3) / Math.max(1, dist));
  if(t<WINDUP_FRAC){
    const wt = t/WINDUP_FRAC;
    return -pullbackFrac*Math.sin(wt*Math.PI/2); // eases into the pullback
  }
  const dt = (t-WINDUP_FRAC)/(1-WINDUP_FRAC);
  const eased = dt*dt; // ease-in: slow leaving the pullback, fast arriving — the "dash"
  return -pullbackFrac + (1+pullbackFrac)*eased;
}

// info: {fromId, toId, attLoss, defLoss, captured, fromCountBefore, toCountBefore,
//        fromCountAfter, toCountAfter}. onDone is called once the whole sequence finishes
// (used to open the troop-redistribution slider modal afterward, only when there's a real
// choice to make there — see doSingleAttack()/allOutAttack()).
function startAttackAnim(info, onDone){
  attackAnim = Object.assign({stage:'fly', stageStart:performance.now(), onDone}, info);
  scheduleAnimFrame();
}
function finishAttackAnim(){
  const a = attackAnim, cb = a && a.onDone;
  // Freeze the tracked "last drawn" army counts at their final values before handing these two
  // territories back to the normal per-frame diff system (see the badge loop) — otherwise it'd
  // see lastDrawnArmies still holding the PRE-battle count (frozen there on purpose while this
  // animation owned these two ids) and kick off a redundant generic tween on top of the special
  // animation that just finished.
  if(a){ lastDrawnArmies[a.fromId] = a.fromCountAfter; lastDrawnArmies[a.toId] = a.toCountAfter; }
  attackAnim = null;
  if(cb) cb();
}
function updateAttackAnim(now){
  if(!attackAnim) return;
  const elapsed = now-attackAnim.stageStart;
  if(attackAnim.stage==='fly' && elapsed>=ATTACK_FLY_MS){
    attackAnim.stage='impact'; attackAnim.stageStart=now;
  } else if(attackAnim.stage==='impact' && elapsed>=ATTACK_IMPACT_MS){
    if(attackAnim.captured) finishAttackAnim();
    else { attackAnim.stage='return'; attackAnim.stageStart=now; }
  } else if(attackAnim.stage==='return' && elapsed>=ATTACK_RETURN_MS){
    finishAttackAnim();
  }
}

// Draws a badge (see drawArmyBadge) plus its territory name underneath, the same pairing the
// normal per-territory badge loop draws — factored out so the special attackAnim badges below
// can reuse it without duplicating the name-label line.
function drawBadgeWithLabel(ctx, x, y, count, name, opts){
  drawArmyBadge(ctx, x, y, count, opts);
  ctx.font='9px sans-serif'; ctx.fillStyle='rgba(255,255,255,0.75)'; ctx.textAlign='center'; ctx.textBaseline='alphabetic';
  ctx.fillText(name, x, y+22);
}

function drawAttackAnimBadges(ctx, now){
  const a = attackAnim;
  const fromT = mapData.territories[a.fromId], toT = mapData.territories[a.toId];
  if(!fromT || !toT){ finishAttackAnim(); return; }
  const fromPos = fromT.centroid, toPos = toT.centroid;
  const elapsed = now-a.stageStart;

  // Defender's badge: stays put throughout. game.armies[toId] already holds the final,
  // post-battle value by the time this ever runs (doBattle resolved synchronously well before
  // the animation started) — it only reveals that value once the flying badge actually arrives.
  const toCount = a.stage==='fly' ? a.toCountBefore : a.toCountAfter;
  drawBadgeWithLabel(ctx, toPos.x, toPos.y, toCount, toT.name, {});

  // Hollow placeholder left behind at the attacker's home territory — "để lại vị trí cũ 1 badge
  // rỗng" — for as long as its real badge is away visiting the defender.
  drawBadgeWithLabel(ctx, fromPos.x, fromPos.y, null, fromT.name, {hollow:true});

  // The flying badge itself: attacker's stack, travelling to the defender then (unless captured)
  // back home with whatever survived.
  let fx, fy, fCount;
  if(a.stage==='fly'){
    const t = Math.min(1, elapsed/ATTACK_FLY_MS);
    const dist = Math.hypot(toPos.x-fromPos.x, toPos.y-fromPos.y);
    const frac = flyWindupFrac(t, dist);
    fx = fromPos.x+(toPos.x-fromPos.x)*frac; fy = fromPos.y+(toPos.y-fromPos.y)*frac;
    fCount = a.fromCountBefore;
  } else if(a.stage==='impact'){
    fx = toPos.x; fy = toPos.y; fCount = a.fromCountAfter;
  } else { // return — a plain ease-out read as a settling "bounce" home, no windup needed here
    const t = Math.min(1, elapsed/ATTACK_RETURN_MS);
    const eased = 1-(1-t)*(1-t);
    fx = toPos.x+(fromPos.x-toPos.x)*eased; fy = toPos.y+(fromPos.y-toPos.y)*eased;
    fCount = a.fromCountAfter;
  }
  drawArmyBadge(ctx, fx, fy, fCount, {strokeColor:'#ffb04a'});

  // Impact damage numbers — "-N" floating up and fading over the impact stage, one per side
  // showing what THAT side lost, right where the two badges collide. Sized to at least the
  // badge's own diameter so it reads as the main event, not a small label; outlined for
  // legibility over whatever territory color happens to be underneath.
  if(a.stage==='impact'){
    const p = Math.min(1, elapsed/ATTACK_IMPACT_MS);
    ctx.save();
    ctx.globalAlpha = 1-p;
    ctx.font='800 28px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='alphabetic';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    const riseY = p*22;
    // "-x" (what the ATTACKER lost) rises above the attacker's own home badge, in the
    // attacker's color; "-y" (what the DEFENDER lost) rises above the defender's badge, in the
    // defender's color — each number sits with the side it's actually about, instead of both
    // clustered at the collision point.
    ctx.fillStyle = a.attackerColor || '#ff3b3b';
    ctx.strokeText('-'+a.attLoss, fromPos.x, fromPos.y-24-riseY);
    ctx.fillText('-'+a.attLoss, fromPos.x, fromPos.y-24-riseY);
    ctx.fillStyle = a.defenderColor || '#ff3b3b';
    ctx.strokeText('-'+a.defLoss, toPos.x, toPos.y-24-riseY);
    ctx.fillText('-'+a.defLoss, toPos.x, toPos.y-24-riseY);
    ctx.restore();
  }
}

// Repeatedly "draws itself out" from fromPos to toPos and resets — a constant, obvious indicator
// of which way an attack would go, shown while both selectedFrom/selectedTo are chosen (and no
// attackAnim is already playing — the flying badge above makes the direction clear enough then).
// Rainbow palette shared by the gradient stroke (drawFlowLine) and the solid arrowhead fill
// (rainbowColorAt, since a canvas gradient can't be "sampled" at one point — the arrowhead
// needs an actual color, not a gradient object).
const RAINBOW_COLORS = ['#ff5555','#ffa64d','#ffe14d','#5ce65c','#4da6ff','#a366ff'];
function rainbowColorAt(t){
  const seg = clamp(t,0,1)*(RAINBOW_COLORS.length-1);
  const i = Math.min(RAINBOW_COLORS.length-2, Math.floor(seg));
  return lerpColor(RAINBOW_COLORS[i], RAINBOW_COLORS[i+1], seg-i);
}

// Repeatedly "draws itself out" from just outside `from` to just outside `to` and resets — a
// constant, obvious indicator of direction, shared by the attack arrow (rainbow, solid) and the
// fortify-phase indicator (white, dashed, see drawGameCanvas). `gap` insets both ends away from
// the two badges instead of drawing straight into them.
function drawFlowLine(ctx, from, to, now, opts){
  opts = opts || {};
  const gap = opts.gap!=null ? opts.gap : 16;
  const dx=to.x-from.x, dy=to.y-from.y;
  const dist = Math.hypot(dx,dy);
  if(dist < gap*2+4) return; // territories too close together for a gapped line to mean anything
  const ux=dx/dist, uy=dy/dist;
  const sx=from.x+ux*gap, sy=from.y+uy*gap;
  const tx=to.x-ux*gap, ty=to.y-uy*gap;

  const cycleMs = opts.cycleMs || 900;
  const growFrac = 0.75; // grows for the first 75% of each cycle, holds briefly, then restarts
  const t = (now%cycleMs)/cycleMs;
  const grow = Math.min(1, t/growFrac);
  const ex = sx+(tx-sx)*grow, ey = sy+(ty-sy)*grow;

  ctx.save();
  if(opts.dashed) ctx.setLineDash([8,7]);
  ctx.lineWidth = opts.lineWidth || 4;
  ctx.lineCap = 'round';
  if(opts.rainbow){
    const grad = ctx.createLinearGradient(sx,sy,tx,ty);
    RAINBOW_COLORS.forEach((c,i)=> grad.addColorStop(i/(RAINBOW_COLORS.length-1), c));
    ctx.strokeStyle = grad;
    ctx.shadowColor='rgba(255,255,255,0.5)';
  } else {
    ctx.strokeStyle = opts.color || 'rgba(255,255,255,0.85)';
    ctx.shadowColor = opts.color || 'rgba(255,255,255,0.5)';
  }
  ctx.shadowBlur = 5;
  ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(ex,ey); ctx.stroke();

  if(opts.arrowHead!==false){
    ctx.setLineDash([]); // arrowhead itself always solid, even on an otherwise-dashed line
    const ang = Math.atan2(ty-sy, tx-sx);
    const headLen = opts.headLen || 11;
    ctx.beginPath();
    ctx.moveTo(ex,ey);
    ctx.lineTo(ex-headLen*Math.cos(ang-Math.PI/7), ey-headLen*Math.sin(ang-Math.PI/7));
    ctx.lineTo(ex-headLen*Math.cos(ang+Math.PI/7), ey-headLen*Math.sin(ang+Math.PI/7));
    ctx.closePath();
    ctx.fillStyle = opts.rainbow ? rainbowColorAt(grow) : (opts.color || 'rgba(255,255,255,0.9)');
    ctx.fill();
  }
  ctx.restore();
}

// Converts a point in map-native pixel space (e.g. a territory's centroid) to actual on-screen
// coordinates — used to position the floating attack-action buttons (DOM elements) over the
// canvas-drawn arrow above. Mirrors getTerritoryFromCanvasEvent()'s screen->bitmap transform in
// reverse; see that function for why rect.width/canvas.width alone (no separate devicePixelRatio
// or displayScale term needed) is the right ratio here.
function mapPointToScreen(x, y){
  const canvas = $('gameCanvas');
  const rect = canvas.getBoundingClientRect();
  const nativeW = mapData.cols*mapData.cellSize, nativeH = mapData.rows*mapData.cellSize;
  return { x: rect.left + x*(rect.width/nativeW), y: rect.top + y*(rect.height/nativeH) };
}

// gameZoom=1 reproduces the old "shrink to fit the wrap, never enlarge" behavior exactly;
// >1/<1 scale that baseline up/down. Kept separate from mapData.cellSize (which stays the
// fixed base unit everything else — centroids, boundary-loop cache — is computed in) so
// zooming never has to touch or invalidate any of that; only this draw call's own resolution
// and the inline CSS size it gives the canvas element change.
let gameZoom = 1;
// Zoom can't go below 1 (the safe-area-fit baseline computed in drawGameCanvas) — that's the
// "don't let the overlays end up sitting on top of the map" limit asked for, not an arbitrary
// number, so it's enforced by what zoom=1 itself means rather than a separate floor.
const GAME_ZOOM_MIN = 1, GAME_ZOOM_MAX = 8;
function setGameZoom(z, anchorClientX, anchorClientY){
  const wrap = $('gameCanvasWrap');
  const wrapRect = wrap.getBoundingClientRect();
  // Anchor: keep whatever map point is under (anchorClientX, anchorClientY) fixed on screen
  // across the zoom change (defaults to the wrap's own center when no anchor is given, e.g.
  // for the +/- buttons and keyboard shortcuts).
  const ax = anchorClientX!=null ? anchorClientX-wrapRect.left : wrap.clientWidth/2;
  const ay = anchorClientY!=null ? anchorClientY-wrapRect.top : wrap.clientHeight/2;
  const contentX = wrap.scrollLeft+ax, contentY = wrap.scrollTop+ay;
  const oldZoom = gameZoom;
  gameZoom = clamp(z, GAME_ZOOM_MIN, GAME_ZOOM_MAX);
  if(gameZoom===oldZoom) return;
  renderGame();
  const ratio = gameZoom/oldZoom;
  wrap.scrollLeft = contentX*ratio-ax;
  wrap.scrollTop = contentY*ratio-ay;
}

function drawGameCanvas(){
  const canvas = $('gameCanvas');
  const cs = mapData.cellSize;
  const nativeW = mapData.cols*cs, nativeH = mapData.rows*cs;
  const wrap = $('gameCanvasWrap');
  // "Safe area" = the wrap's box minus the fixed overlays around the edges (left player list,
  // right control column, bottom turn-info panel — no dedicated top overlay anymore now that
  // the former top icon bar lives inside #gameRightPanelWrap on the right) plus a little
  // breathing room. This is what zoom=1 (== GAME_ZOOM_MIN) fits the map into, so at minimum
  // zoom the overlays only ever sit over empty background, never over the map itself — "zoom
  // out hết cỡ thì bản đồ lọt thỏm vào giữa, chừa khoảng trống xung quanh".
  const margin = 16;
  const topH = 0;
  const leftW = $('gamePlayerListWrap').getBoundingClientRect().width;
  const rightW = $('gameRightPanelWrap').getBoundingClientRect().width;
  const bottomH = $('gameTurnInfo').getBoundingClientRect().height;
  const availW = Math.max(50, wrap.clientWidth-leftW-rightW-margin*3);
  const availH = Math.max(50, wrap.clientHeight-topH-bottomH-margin*3);
  const fitScale = Math.min(availW/nativeW, availH/nativeH);
  const displayScale = fitScale*gameZoom;
  canvas.width = Math.max(1, Math.round(nativeW*displayScale));
  canvas.height = Math.max(1, Math.round(nativeH*displayScale));
  canvas.style.width = canvas.width+'px';
  canvas.style.height = canvas.height+'px';
  // Center within the SAFE AREA specifically (the box between the 4 overlays), not the wrap's
  // full box — CSS margin:auto centers in the full wrap, which only happens to clear every
  // overlay when they're all roughly the same size on their axis. The player list and the
  // phase-action panel are NOT the same width, so relying on symmetric auto-centering could
  // let the map creep under the wider one at low zoom while leaving extra clearance on the
  // narrower side. Explicit margins (overriding the CSS margin:auto) position it precisely
  // between the actual measured edges instead.
  //
  // All 4 margins need a floor at the overlay-clearance size (safeLeft/safeTop and their right/
  // bottom mirrors), NOT a flat `margin` constant — once zoomed in past the safe area, scrolling
  // to an extreme shows content exactly at marginLeft/marginTop/etc from the wrap's edge, so a
  // floor smaller than the actual overlay size leaves that overlay permanently covering the last
  // stretch of map on that side, unreachable no matter how far you scroll. (This previously only
  // happened on the right/bottom, which were hardcoded to a flat 0 with no clearance logic at
  // all — but the left/top floor of a flat 16px was equally wrong, just less noticeable since
  // those overlays happen to be narrower.)
  const safeLeft = leftW+margin, safeRight = wrap.clientWidth-rightW-margin;
  const safeTop = topH+margin, safeBottom = wrap.clientHeight-bottomH-margin;
  const marginLeftPx = Math.max(safeLeft, (safeLeft+safeRight)/2 - canvas.width/2);
  const marginTopPx = Math.max(safeTop, (safeTop+safeBottom)/2 - canvas.height/2);
  const rightReserve = wrap.clientWidth - safeRight; // = rightW+margin
  const bottomReserve = wrap.clientHeight - safeBottom; // = bottomH+margin
  canvas.style.marginLeft = marginLeftPx+'px';
  canvas.style.marginTop = marginTopPx+'px';
  canvas.style.marginRight = Math.max(rightReserve, wrap.clientWidth-marginLeftPx-canvas.width)+'px';
  canvas.style.marginBottom = Math.max(bottomReserve, wrap.clientHeight-marginTopPx-canvas.height)+'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(displayScale, displayScale); // canvas.width/height assignment above already reset the transform to identity
  ctx.fillStyle=OCEAN_COLOR;
  ctx.fillRect(0,0,nativeW,nativeH);

  const terrs = Object.values(mapData.territories).filter(t=>t.cells.length>0);
  const now = performance.now();
  updateAttackAnim(now); // may finish and null out attackAnim before anything below reads it
  // Canvas-drawn animations (fades/tweens/particles/pulse) aren't reachable by the CSS
  // prefers-reduced-motion override in style.css, so they check it directly here instead.
  const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  terrs.forEach(t=>{
    let color;
    if(showContinentsGame){
      const cont = t.continentId!=null ? mapData.continents[t.continentId] : null;
      color = cont ? cont.color : '#3a3f52';
    } else {
      const ownerId = game.owner[t.id];
      color = ownerId!==undefined ? playerOf(ownerId).color : '#444';
      // A change since the last frame actually drawn (a capture) starts a color fade + a small
      // particle burst instead of snapping straight to the new owner's color — see RENDER
      // ANIMATION STATE above for why this is detected here rather than at every mutation site.
      if(!reducedMotion && lastDrawnOwner[t.id]!==undefined && lastDrawnOwner[t.id]!==ownerId){
        const prevOwner = lastDrawnOwner[t.id];
        const fromColor = prevOwner!=null && game.players[prevOwner] ? playerOf(prevOwner).color : '#444';
        colorFades[t.id] = {from:fromColor, to:color, start:now};
        spawnCaptureParticles(t.centroid.x, t.centroid.y, color);
      }
      lastDrawnOwner[t.id] = ownerId;
      const fade = colorFades[t.id];
      if(fade){
        const prog = Math.min(1, (now-fade.start)/COLOR_FADE_MS);
        color = lerpColor(fade.from, fade.to, prog);
        if(prog>=1) delete colorFades[t.id];
      }
    }
    pathFromLoops(ctx, getTerritoryBoundaryLoops(mapData, t.id));
    // Radial gradient (lighter center, darker edge) instead of a flat fill — a cheap "raised
    // landmass" look with no texture art needed. Radius is derived from cell count (roughly the
    // territory's own extent in grid units) so it scales sensibly from a 1-cell sliver up to a
    // large territory instead of using one fixed size for every shape.
    const cx=t.centroid.x, cy=t.centroid.y;
    const radius = Math.max(mapData.cellSize*1.5, Math.sqrt(t.cells.length)*mapData.cellSize*0.85);
    const grad = ctx.createRadialGradient(cx,cy,0, cx,cy,radius);
    grad.addColorStop(0, shadeColor(color, 16));
    grad.addColorStop(1, shadeColor(color, -10));
    ctx.fillStyle = grad;
    ctx.fill();
    // Subtle grain texture on top, clipped to this same territory shape (path is still current
    // right after fill() — only beginPath() would clear it). Bounded to this territory's own
    // cell bounding box rather than the whole canvas so it stays cheap on maps with many
    // territories.
    let minC=Infinity,maxC=-Infinity,minR=Infinity,maxR=-Infinity;
    t.cells.forEach(([c,r])=>{ if(c<minC)minC=c; if(c>maxC)maxC=c; if(r<minR)minR=r; if(r>maxR)maxR=r; });
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = getNoisePattern(ctx);
    ctx.fillRect(minC*cs, minR*cs, (maxC-minC+1)*cs, (maxR-minR+1)*cs);
    ctx.restore();
  });

  // In continent view, emphasize the viewing (human) player's own territories with a diagonal
  // white stripe overlay — keeps the true continent colors intact instead of retinting them.
  if(showContinentsGame){
    const mine = terrs.filter(t=>game.owner[t.id]===0);
    if(mine.length){
      ctx.save();
      pathFromLoops(ctx, mine.flatMap(t=>getTerritoryBoundaryLoops(mapData, t.id)));
      ctx.clip();
      ctx.fillStyle = getStripePattern(ctx);
      ctx.fillRect(0,0,nativeW,nativeH);
      ctx.restore();
    }
  }

  // borders: every territory's own outline, thin; continent outlines drawn thicker on top
  // when in continent view (rather than comparing neighbor-by-neighbor, each continent's own
  // traced outer edge already IS exactly where a thick border belongs).
  terrs.forEach(t=>{
    pathFromLoops(ctx, getTerritoryBoundaryLoops(mapData, t.id));
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(8,10,18,0.85)';
    ctx.stroke();
  });
  if(showContinentsGame){
    Object.values(mapData.continents).forEach(cont=>{
      const loops = getContinentBoundaryLoops(mapData, cont.id);
      if(loops.length===0) return;
      pathFromLoops(ctx, loops);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke();
    });
  }
  // selection highlight — a slow pulsing glow instead of a static line, so the currently
  // selected territory/territories stay noticeable at a glance instead of blending into the
  // rest of the borders once you stop looking right at them.
  const pulse = reducedMotion ? 0 : 0.5+0.5*Math.sin(now/280);
  [['selectedFrom','#fff'],['selectedTo','#f2b84b']].forEach(([key,col])=>{
    const id = game[key];
    if(id!=null && mapData.territories[id]){
      pathFromLoops(ctx, getTerritoryBoundaryLoops(mapData, id));
      ctx.save();
      ctx.shadowColor = col; ctx.shadowBlur = 5+7*pulse;
      ctx.strokeStyle=col; ctx.lineWidth=3+1.2*pulse;
      ctx.stroke();
      ctx.restore();
    }
  });
  // Attack-phase direction arrow: only while both ends are chosen and no attack is already
  // mid-animation (the flying badge below makes the direction obvious enough by itself then).
  const inAttackPhase = game.phase==='attack';
  // Gated on canAttack (not just "both selected") — otherwise picking a non-adjacent or
  // already-yours (e.g. just captured) territory as selectedTo would still draw an arrow to it.
  const showArrow = inAttackPhase && !attackAnim && game.selectedFrom!=null && game.selectedTo!=null &&
    mapData.territories[game.selectedFrom] && mapData.territories[game.selectedTo] &&
    canAttack(game.selectedFrom, game.selectedTo, currentPlayerId());
  if(showArrow){
    drawFlowLine(ctx, mapData.territories[game.selectedFrom].centroid, mapData.territories[game.selectedTo].centroid, now,
      {rainbow:true, cycleMs:1350, gap:16});
  }
  // Fortify-phase indicator: same idea, styled as a white dashed line instead of a solid
  // rainbow arrow so the two phases don't look like the same action.
  if(game.phase==='fortify' && game.selectedFrom!=null && game.selectedTo!=null && canFortifyNow(currentPlayer())){
    drawFlowLine(ctx, mapData.territories[game.selectedFrom].centroid, mapData.territories[game.selectedTo].centroid, now,
      {color:'rgba(255,255,255,0.85)', dashed:true, cycleMs:1350, gap:16});
  }
  // army badges — selectedFrom (and selectedTo, if it's actually a legal attack target) pulse
  // bigger while chosen; skip fromId/toId here entirely while attackAnim owns them (drawn
  // specially further down instead).
  Object.values(mapData.territories).forEach(t=>{
    if(t.cells.length===0) return;
    if(attackAnim && (t.id===attackAnim.fromId || t.id===attackAnim.toId)) return;
    const realArmyCount = game.armies[t.id];
    if(realArmyCount===undefined) return;
    // Same diff-against-last-frame trick as the color fade above: a changed army count starts a
    // brief count-up/down tween instead of the number just jumping straight to its new value.
    if(!reducedMotion && lastDrawnArmies[t.id]!==undefined && lastDrawnArmies[t.id]!==realArmyCount){
      armyTweens[t.id] = {from:lastDrawnArmies[t.id], to:realArmyCount, start:now};
    }
    lastDrawnArmies[t.id] = realArmyCount;
    let armyCount = realArmyCount;
    const tween = armyTweens[t.id];
    if(tween){
      const prog = Math.min(1, (now-tween.start)/ARMY_TWEEN_MS);
      armyCount = Math.round(tween.from+(tween.to-tween.from)*prog);
      if(prog>=1) delete armyTweens[t.id];
    }
    let badgeScale = 1;
    if(inAttackPhase && !reducedMotion){
      const isFrom = t.id===game.selectedFrom;
      const isValidTo = t.id===game.selectedTo && game.selectedFrom!=null && canAttack(game.selectedFrom, t.id, currentPlayerId());
      if(isFrom || isValidTo) badgeScale = 1+0.3*pulse;
    }
    drawBadgeWithLabel(ctx, t.centroid.x, t.centroid.y, armyCount, t.name, {scale:badgeScale});
  });
  if(attackAnim) drawAttackAnimBadges(ctx, now);
  if(showContinentsGame){
    ctx.font = 'bold 17px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    const positions = computeContinentLabelPositions(mapData);
    Object.entries(positions).forEach(([cid,pos])=>{
      const cont = mapData.continents[cid]; if(!cont) return;
      const label = cont.name+' (+'+cont.bonus+')';
      fillTextWithBackground(ctx, label, pos.x, pos.y-20);
    });
  }

  // Capture particle burst — small dots flying outward from a just-captured territory's
  // centroid, fading out over PARTICLE_MS. Drawn last so they sit on top of everything else;
  // expired ones are dropped here rather than in a separate pass.
  captureParticles = captureParticles.filter(pt=> now-pt.start<PARTICLE_MS);
  captureParticles.forEach(pt=>{
    const t = (now-pt.start)/PARTICLE_MS;
    const px = pt.x+pt.vx*t*18, py = pt.y+pt.vy*t*18;
    ctx.beginPath(); ctx.arc(px,py, 3*(1-t)+0.5, 0, Math.PI*2);
    ctx.fillStyle = pt.color;
    ctx.globalAlpha = 1-t;
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  // Keep animating next frame if anything above is still mid-transition — otherwise rendering
  // goes back to being purely event-driven (see RENDER ANIMATION STATE at the top of this file).
  // The selection glow alone never "finishes" while a territory stays selected, but with
  // reducedMotion it's just a static line (pulse=0 above), so it doesn't need to keep redrawing.
  const stillAnimating = Object.keys(colorFades).length>0 || Object.keys(armyTweens).length>0 ||
    captureParticles.length>0 || !!attackAnim || (!reducedMotion && (game.selectedFrom!=null || game.selectedTo!=null));
  if(stillAnimating) scheduleAnimFrame();
  if(inAttackPhase) positionFloatingAttackButtons();
}

function renderPlayerList(){
  const wrap = $('playerList'); wrap.innerHTML='';
  // Shown in turn order (whoever goes first at the top), not game.players' fixed id order —
  // game.turnOrder itself never changes after being shuffled once at game start, only turnIdx
  // advances through it, so this ordering stays stable for the whole match.
  const byTurnOrder = game.turnOrder.map(id=>game.players[id]);
  byTurnOrder.forEach(p=>{
    const card = el('div','player-card'+(p.id===currentPlayerId()&&!game.over?' active-turn':'')+(!p.alive?' eliminated':''));
    const mine = ownedTerritories(p.id);
    const totalArmies = mine.reduce((s,id)=>s+(game.armies[id]||0),0);
    const contsHeld = Object.values(mapData.continents).filter(cont=>{
      const ct = Object.values(mapData.territories).filter(t=>t.continentId===cont.id).map(t=>t.id);
      return ct.length>0 && ct.every(id=>game.owner[id]===p.id);
    }).length;
    // Line 1: the player's own color, now as a filled name badge (white text) instead of a
    // separate dot, plus army count — the two things you actually glance at mid-game. Line 2:
    // the rest (territories/continents/cards), kept to icon+number only, no text label — this
    // list has to stay short enough that ~6 players fit on a short landscape phone screen with
    // no scrolling.
    const line1 = el('div','pline1');
    const nameBadge = el('span','pname-badge', p.name+(p.isHuman?' (Bạn)':''));
    nameBadge.style.background = p.color;
    line1.appendChild(nameBadge);
    line1.appendChild(el('span','stat-item', `⚔️ ${totalArmies}`));
    // Territory-share bar: quick "how much of the map do they hold" read at a glance, without
    // having to compare raw counts across cards yourself. Width is a plain CSS transition off
    // a changed inline style, so it animates smoothly on its own — no JS tweening needed here.
    const totalTerrs = Object.keys(mapData.territories).length;
    const pct = totalTerrs>0 ? Math.round(mine.length/totalTerrs*100) : 0;
    const bar = el('div','pcard-bar');
    const fill = el('div','pcard-bar-fill');
    fill.style.width = pct+'%';
    fill.style.background = p.color;
    bar.appendChild(fill);
    const line2 = el('div','pline2');
    [['🗺️',mine.length],['🌍',contsHeld],['🃏',p.cards.length]].forEach(([icon,val])=>{
      line2.appendChild(el('span','stat-item', `${icon} ${val}`));
    });
    card.appendChild(line1); card.appendChild(bar); card.appendChild(line2);
    wrap.appendChild(card);
  });
}


function renderCombatLog(){
  const wrap = $('combatLog');
  wrap.innerHTML='';
  // Filter BEFORE slicing to the last 60 — otherwise, with logFilterMine on, 60 unrelated
  // events could push every entry that's actually about you out of the visible window even
  // though plenty exist further back in game.log.
  const entries = logFilterMine
    ? game.log.filter(entry=> !entry.playerIds || entry.playerIds.includes(0))
    : game.log;
  entries.slice(-60).reverse().forEach(entry=>{
    const d = el('div','log-entry '+entry.type, entry.msg);
    wrap.appendChild(d);
  });
}

// Staggers each die's existing .die "pop" entrance animation (see style.css) by its index so
// dice land one after another instead of all popping in on the same frame — reads more like an
// actual roll for very little extra code (just an inline animation-delay per element).
function makeDie(v, win, delayIndex){
  const d = el('div','die'+(win===true?' win':win===false?' lose':''), v);
  d.style.animationDelay = (delayIndex*0.08)+'s';
  return d;
}
function showDice(ad,dd,results){
  const box = $('diceBox'); box.innerHTML='';
  const g1 = el('div','dice-group');
  ad.forEach((v,i)=>{ const win = i<results.length? results[i].win : null; g1.appendChild(makeDie(v, win, i)); });
  const g2 = el('div','dice-group');
  dd.forEach((v,i)=>{ const win = i<results.length? !results[i].win : null; g2.appendChild(makeDie(v, win, ad.length+i)); });
  box.appendChild(g1);
  box.appendChild(el('div','',' vs '));
  box.appendChild(g2);
}

function setActionHint(text){ $('actionHint').textContent = text; }

// Shared by the attack-phase buttons and their keyboard shortcuts (08-wiring.js).
function canAttackNow(p){
  return game.selectedFrom!=null && game.selectedTo!=null && canAttack(game.selectedFrom,game.selectedTo,p.id);
}
function doSingleAttack(){
  const p = currentPlayer();
  if(!canAttackNow(p)) return;
  const fromId = game.selectedFrom, toId = game.selectedTo;
  const fromName = mapData.territories[fromId].name, toName = mapData.territories[toId].name;
  const defenderId = game.owner[toId];
  const defenderName = game.players[defenderId].name;
  const attackerColor = p.color, defenderColor = game.players[defenderId].color;
  const fromCountBefore = game.armies[fromId], toCountBefore = game.armies[toId];
  const res = doBattle(fromId, toId);
  recordBattleStat(p.name, defenderName, fromName, toName, res.attLoss+res.defLoss);
  const fromCountAfter = game.armies[fromId], toCountAfter = game.armies[toId];
  if(fromCountAfter<2) game.selectedFrom=null;
  startAttackAnim({
    fromId, toId, attLoss:res.attLoss, defLoss:res.defLoss, captured:res.captured,
    fromCountBefore, toCountBefore, fromCountAfter, toCountAfter, attackerColor, defenderColor,
  }, ()=>{
    if(res.captured && res.maxMovable>res.moving) showCaptureMoveModal(fromId, toId, res.moving, res.maxMovable);
  });
  renderGame();
}
// Keeps attacking the same target back-to-back (same silent-round-then-summarize approach as
// the AI's battleBatch() in 05-ai.js) until the source runs dry or the target is captured.
function allOutAttack(){
  const p = currentPlayer();
  if(!canAttackNow(p)) return;
  const fromId = game.selectedFrom, toId = game.selectedTo;
  const fromName = mapData.territories[fromId].name, toName = mapData.territories[toId].name;
  const defenderId = game.owner[toId];
  const defenderName = game.players[defenderId].name;
  const attackerColor = p.color, defenderColor = game.players[defenderId].color;
  const fromCountBefore = game.armies[fromId], toCountBefore = game.armies[toId];
  let rounds=0, attLossTotal=0, defLossTotal=0, captured=false, lastRes=null;
  while(game.armies[fromId]>=2 && canAttack(fromId,toId,p.id)){
    lastRes = doBattle(fromId, toId, {silent:true});
    rounds++; attLossTotal += lastRes.attLoss; defLossTotal += lastRes.defLoss;
    if(lastRes.captured){ captured=true; break; }
  }
  if(rounds>0){
    const roundsLabel = rounds>1 ? ` (${rounds} hiệp)` : '';
    logMsg('attack', `${p.name} tấn công ${toName} từ ${fromName}${roundsLabel}: mất ${attLossTotal}, đối phương mất ${defLossTotal}.`, [p.id, defenderId]);
    if(lastRes) showDice(lastRes.ad, lastRes.dd, lastRes.results);
    if(captured) logMsg('capture', `${p.name} chiếm được ${toName}!`, [p.id, defenderId]);
    recordBattleStat(p.name, defenderName, fromName, toName, attLossTotal+defLossTotal);
  }
  const fromCountAfter = game.armies[fromId], toCountAfter = game.armies[toId];
  if(fromCountAfter<2) game.selectedFrom=null;
  if(rounds>0){
    startAttackAnim({
      fromId, toId, attLoss:attLossTotal, defLoss:defLossTotal, captured,
      fromCountBefore, toCountBefore, fromCountAfter, toCountAfter, attackerColor, defenderColor,
    }, ()=>{
      if(captured && lastRes.maxMovable>lastRes.moving) showCaptureMoveModal(fromId, toId, lastRes.moving, lastRes.maxMovable);
    });
  }
  renderGame();
}
// Shared by the fortify-phase button and its keyboard shortcut (08-wiring.js).
function canFortifyNow(p){
  return game.selectedFrom!=null && game.selectedTo!=null && game.selectedFrom!==game.selectedTo &&
    game.owner[game.selectedFrom]===p.id && game.owner[game.selectedTo]===p.id &&
    pathExistsOwned(game.selectedFrom, game.selectedTo, p.id) && game.armies[game.selectedFrom]>1;
}

// Floating attack-action buttons: shown instead of the normal phase-actions panel entries once
// a legal attack pair is chosen (canAttackNow), positioned right above the animated arrow
// between them (see drawAttackArrow()/mapPointToScreen() in the RENDER ANIMATION STATE section)
// so the buttons sit contextually next to the thing they act on. hideFloatingAttackButtons()
// clears them back out for every other phase/state.
function hideFloatingAttackButtons(){
  const wrap = $('floatingAttackButtons');
  wrap.hidden = true;
  wrap.innerHTML = '';
}
function showFloatingAttackButtons(){
  const wrap = $('floatingAttackButtons');
  wrap.hidden = false;
  wrap.innerHTML = '';
  const allOutBtn = el('button','danger',withShortcut('💥 Công triệt để','C')); allOutBtn.id='btnAllOutAttack';
  allOutBtn.title='Phím tắt: C';
  allOutBtn.addEventListener('click', allOutAttack);
  wrap.appendChild(allOutBtn);
  const atkBtn = el('button','danger',withShortcut('⚔️ Tấn công','T')); atkBtn.id='btnDoAttack';
  atkBtn.title='Phím tắt: T';
  atkBtn.addEventListener('click', doSingleAttack);
  wrap.appendChild(atkBtn);
  positionFloatingAttackButtons();
}
// Called every attack-phase frame from drawGameCanvas() (so panning/zooming keeps it aligned)
// as well as once right after showFloatingAttackButtons() shows it fresh.
// #gameLogPanel sits right below #gameRightPanelWrap instead of a fixed px offset (see that
// CSS rule's comment) — that panel's own height varies (phase-action buttons come and go, the
// zoom-controls row wraps differently per screen width), so this is recomputed on every render
// rather than relying on any one fixed value staying correct.
function positionLogPanel(){
  const panel = $('gameLogPanel');
  const wrapRect = $('gameRightPanelWrap').getBoundingClientRect();
  const screenRect = $('screen-game').getBoundingClientRect();
  panel.style.top = Math.max(10, wrapRect.bottom-screenRect.top+10)+'px';
}

function positionFloatingAttackButtons(){
  const wrap = $('floatingAttackButtons');
  if(wrap.hidden) return;
  const fromT = mapData.territories[game.selectedFrom], toT = mapData.territories[game.selectedTo];
  if(!fromT || !toT){ hideFloatingAttackButtons(); return; }
  const midX=(fromT.centroid.x+toT.centroid.x)/2, midY=(fromT.centroid.y+toT.centroid.y)/2;
  const pt = mapPointToScreen(midX, midY);
  // CSS transform (translate(-50%, calc(-100% - 14px))) handles centering horizontally and
  // sitting the box above this exact point — see style.css.
  wrap.style.left = pt.x+'px';
  wrap.style.top = pt.y+'px';
}

function renderPhaseActions(){
  const wrap = $('phaseActions'); wrap.innerHTML='';
  hideFloatingAttackButtons(); // re-shown below only for phase==='attack' with a ready pair
  if(game.over) return;
  const p = currentPlayer();
  if(!p.isHuman){ wrap.appendChild(el('div','',''));  return; }
  if(game.phase==='setup-place'){
    wrap.appendChild(el('div','', 'Đặt quân ban đầu — nhấp vào bản đồ (giữ nhấn để đặt liên tục).'));
    return;
  }
  if(game.phase==='reinforce'){
    const b = el('button','ghost','🃏 Đổi thẻ bài'); b.addEventListener('click',()=>openCardsModal(false)); wrap.appendChild(b);
    return;
  }
  if(game.phase==='attack'){
    const ready = canAttackNow(p);
    if(ready){
      showFloatingAttackButtons();
    } else {
      const allOutBtn = el('button','danger',withShortcut('💥 Công triệt để','C')); allOutBtn.id='btnAllOutAttack'; allOutBtn.disabled=true;
      allOutBtn.title='Phím tắt: C';
      wrap.appendChild(allOutBtn);
      const atkBtn = el('button','danger',withShortcut('⚔️ Tấn công','T')); atkBtn.id='btnDoAttack'; atkBtn.disabled=true;
      atkBtn.title='Phím tắt: T';
      wrap.appendChild(atkBtn);
    }
    const endBtn = el('button','primary',withShortcut('Kết thúc tấn công','K')); endBtn.title='Phím tắt: K';
    endBtn.addEventListener('click', ()=> beginFortifyPhase());
    wrap.appendChild(endBtn);
    return;
  }
  if(game.phase==='fortify'){
    const fortBtn = el('button','good',withShortcut('🚚 Chuyển quân','C')); fortBtn.id='btnDoFortify'; fortBtn.disabled=!canFortifyNow(p);
    fortBtn.title='Phím tắt: C';
    fortBtn.addEventListener('click', ()=>{
      if(canFortifyNow(p)) openFortifyModal(game.selectedFrom, game.selectedTo);
    });
    wrap.appendChild(fortBtn);
    const endBtn = el('button','primary',withShortcut('Kết thúc lượt','K')); endBtn.title='Phím tắt: K';
    endBtn.addEventListener('click', ()=> endTurn());
    wrap.appendChild(endBtn);
  }
}

function openFortifyModal(fromId, toId){
  const p = currentPlayer();
  const max = game.armies[fromId]-1;
  if(max<1) return;
  const fromName = mapData.territories[fromId].name;
  const toName = mapData.territories[toId].name;
  const overlay = el('div','modal-overlay');
  const modal = el('div','modal');
  modal.appendChild(el('h3','', `🚚 Chuyển quân`));
  modal.appendChild(el('p','', `Chuyển bao nhiêu quân từ "${fromName}" sang "${toName}"? (Luôn phải giữ lại ít nhất 1 quân ở ${fromName}.)`));

  const bigRow = el('div','');
  bigRow.style.cssText = 'display:flex;justify-content:space-around;align-items:center;margin:18px 0;text-align:center;';
  const fromBox = el('div','');
  const fromCount = el('div','', String(game.armies[fromId])); fromCount.style.cssText='font-size:26px;font-weight:800;color:#fff;';
  fromBox.appendChild(fromCount); fromBox.appendChild(el('div','',fromName)).style.cssText='font-size:12px;color:var(--muted);margin-top:2px;';
  const arrow = el('div','','→'); arrow.style.cssText='font-size:22px;color:var(--muted);';
  const toBox = el('div','');
  const toCount = el('div','', String(game.armies[toId])); toCount.style.cssText='font-size:26px;font-weight:800;color:var(--good);';
  toBox.appendChild(toCount); toBox.appendChild(el('div','',toName)).style.cssText='font-size:12px;color:var(--muted);margin-top:2px;';
  bigRow.appendChild(fromBox); bigRow.appendChild(arrow); bigRow.appendChild(toBox);
  modal.appendChild(bigRow);

  const sliderRow = el('div',''); sliderRow.style.cssText='display:flex;align-items:center;gap:12px;margin:14px 0 16px;';
  const slider = document.createElement('input');
  slider.type='range'; slider.min='1'; slider.max=String(max); slider.value=String(max);
  slider.style.flex='1';
  const sliderLabel = el('span','', String(max)); sliderLabel.style.cssText='min-width:40px;text-align:center;font-weight:700;color:var(--good);';
  slider.addEventListener('input', ()=>{
    const n = Number(slider.value);
    sliderLabel.textContent = String(n);
    fromCount.textContent = String(game.armies[fromId]-n);
    toCount.textContent = String(game.armies[toId]+n);
  });
  sliderRow.appendChild(slider); sliderRow.appendChild(sliderLabel);
  modal.appendChild(sliderRow);

  const btnRow = el('div',''); btnRow.style.cssText='display:flex;gap:8px;';
  const cancelBtn = el('button','ghost','Huỷ');
  cancelBtn.addEventListener('click', close);
  const quickMin = el('button','ghost',withShortcut('Tối thiểu (1)','T')); quickMin.title='Phím tắt: T';
  quickMin.addEventListener('click', ()=>{ slider.value='1'; slider.dispatchEvent(new Event('input')); });
  const quickMax = el('button','ghost',withShortcut('Tối đa ('+max+')','D')); quickMax.title='Phím tắt: D';
  quickMax.addEventListener('click', ()=>{ slider.value=String(max); slider.dispatchEvent(new Event('input')); });
  const confirmBtn = el('button','primary',withShortcut('Xác nhận','X')); confirmBtn.title='Phím tắt: X';
  confirmBtn.addEventListener('click', ()=>{
    const n = Number(slider.value);
    game.armies[fromId] -= n; game.armies[toId] += n;
    logMsg('info', p.name+' chuyển '+n+' quân từ '+fromName+' sang '+toName+'.', p.id);
    close();
    game.selectedFrom=null; game.selectedTo=null;
    renderGame();
  });
  btnRow.appendChild(cancelBtn); btnRow.appendChild(quickMin); btnRow.appendChild(quickMax); btnRow.appendChild(confirmBtn);
  modal.appendChild(btnRow);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  // sync the big from/to numbers with the slider's initial value (defaults to max) — without
  // this they show the pre-transfer counts until the user drags the slider at least once.
  slider.dispatchEvent(new Event('input'));

  function keyHandler(e){
    const key = e.key.toLowerCase();
    if(key==='t'){ e.preventDefault(); quickMin.click(); }
    else if(key==='d'){ e.preventDefault(); quickMax.click(); }
    else if(key==='x'){ e.preventDefault(); confirmBtn.click(); }
  }
  document.addEventListener('keydown', keyHandler);
  function close(){
    document.removeEventListener('keydown', keyHandler);
    document.body.removeChild(overlay);
  }
}

function renderTopbar(){
  const p = currentPlayer();
  $('turnDot').style.background = p.color;
  $('turnDot').style.color = p.color;
  $('roundBadge').textContent = '🔁 '+game.roundNumber;
  $('turnName').textContent = p.name+(p.isHuman?' (Bạn)':'')+
    ' 📦'+p.totalReinforced+' | 😵'+p.totalKills+' - lượt - ';
  const phaseNames = {'setup-place':'Đặt quân ban đầu','reinforce':'Tăng viện','attack':'Tấn công','fortify':'Tăng cường'};
  $('phaseBadge').textContent = phaseNames[game.phase] || game.phase;
  $('reinforceCounter').textContent = (game.phase==='reinforce'||game.phase==='setup-place') ?
    ('Quân đặt: ' + (game.phase==='setup-place'? game.pool[p.id] : game.reinforceRemaining)) : '';
  const humanCards = game.players[0].cards;
  $('cardCountBadge').textContent = humanCards.length;
  $('cardCountBadge').style.display = findTradeCombo(humanCards) ? 'flex' : 'none';
  // Play/pause only matters (and is only clickable) while an AI is actually taking its turn.
  const aiTurn = !p.isHuman && !game.over;
  $('btnPauseAI').disabled = !aiTurn;
  $('btnPauseAI').textContent = aiPaused ? '▶️' : '⏸️';
  $('btnPauseAI').title = aiPaused ? 'Tiếp tục lượt AI' : 'Tạm dừng lượt AI';
}

function renderGame(){
  if(!game) return;
  renderTopbar();
  renderPlayerList();
  // Rendered before drawGameCanvas() since its fitScale computation measures the overlay
  // elements' current on-screen size (see the "safe area" comment there).
  renderPhaseActions();
  drawGameCanvas();
  positionLogPanel(); // after renderPhaseActions() specifically — #gameRightPanelWrap's height
                       // (which this tracks) depends on how many phase-action buttons it just drew
  if(aiPaused && !currentPlayer().isHuman && !game.over){
    setActionHint('⏸️ Đã tạm dừng lượt của '+currentPlayer().name+'. Bấm ▶️ ở góc trên để tiếp tục.');
  }
}

/* ---------------- Game canvas click handling ---------------- */
// Shared by the click handler below and the setup-place press-and-hold wiring (08-wiring.js).
function getTerritoryFromCanvasEvent(canvas, evt){
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width/rect.width, scaleY = canvas.height/rect.height;
  const x=(evt.clientX-rect.left)*scaleX, y=(evt.clientY-rect.top)*scaleY;
  // Cell size in bitmap px, derived from the canvas's actual current size rather than the base
  // mapData.cellSize, so this stays correct at any zoom level (drawGameCanvas resizes the
  // canvas by the zoom/fit scale but never touches mapData.cellSize itself).
  const cellW = canvas.width/mapData.cols, cellH = canvas.height/mapData.rows;
  const c=Math.floor(x/cellW), r=Math.floor(y/cellH);
  if(!inBounds(mapData,c,r)) return -1;
  return mapData.cellTerritory[cellIndex(mapData,c,r)];
}

// Set by the click-and-drag panning wiring (08-wiring.js) right before the 'click' that
// naturally follows a mouseup would otherwise fire, so a drag doesn't also get treated as a
// territory click.
let suppressNextClick = false;
function gameCanvasClick(evt){
  if(suppressNextClick){ suppressNextClick = false; return; }
  if(game.over) return;
  const p = currentPlayer();
  if(!p.isHuman) return;
  // setup-place and reinforce are both handled entirely by the pointerdown/hold wiring instead
  // (so holding down can keep placing armies) — see $('gameCanvas') pointer wiring in 08-wiring.js.
  if(game.phase==='setup-place' || game.phase==='reinforce') return;
  const terrId = getTerritoryFromCanvasEvent($('gameCanvas'), evt);
  if(terrId===-1) return;

  if(game.phase==='attack'){
    if(game.owner[terrId]===p.id){
      game.selectedFrom = terrId; game.selectedTo=null;
    } else if(game.selectedFrom!=null){
      game.selectedTo = terrId;
    }
    renderGame();
    return;
  }
  if(game.phase==='fortify'){
    if(game.owner[terrId]===p.id){
      if(game.selectedFrom===null || game.owner[game.selectedTo]!==p.id) {
        if(game.selectedFrom===null){ game.selectedFrom=terrId; }
        else { game.selectedTo=terrId; }
      } else {
        game.selectedFrom=terrId; game.selectedTo=null;
      }
    }
    renderGame();
    return;
  }
}

