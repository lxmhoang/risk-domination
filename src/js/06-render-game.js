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
}
function spawnCaptureParticles(x, y, color){
  const n = 14;
  for(let i=0;i<n;i++){
    const angle = (Math.PI*2*i/n) + Math.random()*0.5;
    const speed = 1.2+Math.random()*1.8;
    captureParticles.push({x, y, vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed, color, start:performance.now()});
  }
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
const GAME_ZOOM_MIN = 1, GAME_ZOOM_MAX = 4;
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
  // "Safe area" = the wrap's box minus the fixed overlays around the edges (top icon controls,
  // left player list, right phase-action buttons, bottom turn-info panel) plus a little
  // breathing room. This is what zoom=1 (== GAME_ZOOM_MIN) fits the map into, so at minimum
  // zoom the overlays only ever sit over empty background, never over the map itself — "zoom
  // out hết cỡ thì bản đồ lọt thỏm vào giữa, chừa khoảng trống xung quanh".
  const margin = 16;
  const topH = $('gameControlsTop').getBoundingClientRect().height;
  const leftW = $('gamePlayerListWrap').getBoundingClientRect().width;
  const rightW = $('gamePhaseActionsWrap').getBoundingClientRect().width;
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
  // army badges
  Object.values(mapData.territories).forEach(t=>{
    if(t.cells.length===0) return;
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
    const x=t.centroid.x, y=t.centroid.y;
    // Drop shadow behind the chip + a small off-center gradient inside it — turns the flat
    // dark disc into a slightly "raised" badge. Shadow is scoped with save/restore so it
    // doesn't also bleed onto the stroke/text drawn right after.
    ctx.save();
    ctx.shadowColor='rgba(0,0,0,0.5)'; ctx.shadowBlur=4; ctx.shadowOffsetY=2;
    ctx.beginPath(); ctx.arc(x,y,13,0,Math.PI*2);
    const badgeGrad = ctx.createRadialGradient(x-4,y-5,1, x,y,15);
    badgeGrad.addColorStop(0, 'rgba(52,58,78,0.95)');
    badgeGrad.addColorStop(1, 'rgba(8,10,18,0.92)');
    ctx.fillStyle = badgeGrad;
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.stroke();
    ctx.fillStyle='#fff'; ctx.font='bold 12px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(armyCount, x, y+1);
    ctx.font='9px sans-serif'; ctx.fillStyle='rgba(255,255,255,0.75)';
    ctx.fillText(t.name, x, y+22);
  });
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
    captureParticles.length>0 || (!reducedMotion && (game.selectedFrom!=null || game.selectedTo!=null));
  if(stillAnimating) scheduleAnimFrame();
}

function renderPlayerList(){
  const wrap = $('playerList'); wrap.innerHTML='';
  game.players.forEach(p=>{
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
  const defenderName = game.players[game.owner[toId]].name;
  const res = doBattle(fromId, toId);
  recordBattleStat(p.name, defenderName, fromName, toName, res.attLoss+res.defLoss);
  if(game.armies[game.selectedFrom]<2) game.selectedFrom=null;
  renderGame();
  showAttackResultModal(fromId, toId, {
    captured: res.captured, attLoss: res.attLoss, defLoss: res.defLoss, rounds: 1,
    moving: res.moving, maxMovable: res.maxMovable,
  });
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
  if(game.armies[fromId]<2) game.selectedFrom=null;
  renderGame();
  if(rounds>0){
    showAttackResultModal(fromId, toId, {
      captured, attLoss: attLossTotal, defLoss: defLossTotal, rounds,
      moving: lastRes ? lastRes.moving : null, maxMovable: lastRes ? lastRes.maxMovable : null,
    });
  }
}
// Shared by the fortify-phase button and its keyboard shortcut (08-wiring.js).
function canFortifyNow(p){
  return game.selectedFrom!=null && game.selectedTo!=null && game.selectedFrom!==game.selectedTo &&
    game.owner[game.selectedFrom]===p.id && game.owner[game.selectedTo]===p.id &&
    pathExistsOwned(game.selectedFrom, game.selectedTo, p.id) && game.armies[game.selectedFrom]>1;
}

function renderPhaseActions(){
  const wrap = $('phaseActions'); wrap.innerHTML='';
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
    const allOutBtn = el('button','danger',withShortcut('💥 Công triệt để','C')); allOutBtn.id='btnAllOutAttack'; allOutBtn.disabled=!ready;
    allOutBtn.title='Phím tắt: C';
    allOutBtn.addEventListener('click', allOutAttack);
    wrap.appendChild(allOutBtn);
    const atkBtn = el('button','danger',withShortcut('⚔️ Tấn công','T')); atkBtn.id='btnDoAttack'; atkBtn.disabled=!ready;
    atkBtn.title='Phím tắt: T';
    atkBtn.addEventListener('click', doSingleAttack);
    wrap.appendChild(atkBtn);
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

