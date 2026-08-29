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
  // narrower side. Explicit margin-left/top (overriding the CSS margin:auto for just those two
  // properties) position it precisely between the actual measured edges instead.
  const safeLeft = leftW+margin, safeRight = wrap.clientWidth-rightW-margin;
  const safeTop = topH+margin, safeBottom = wrap.clientHeight-bottomH-margin;
  canvas.style.marginLeft = Math.max(margin, (safeLeft+safeRight)/2 - canvas.width/2)+'px';
  canvas.style.marginTop = Math.max(margin, (safeTop+safeBottom)/2 - canvas.height/2)+'px';
  canvas.style.marginRight = '0';
  canvas.style.marginBottom = '0';
  const ctx = canvas.getContext('2d');
  ctx.scale(displayScale, displayScale); // canvas.width/height assignment above already reset the transform to identity
  ctx.fillStyle='#123a56';
  ctx.fillRect(0,0,nativeW,nativeH);

  const terrs = Object.values(mapData.territories).filter(t=>t.cells.length>0);
  terrs.forEach(t=>{
    let color;
    if(showContinentsGame){
      const cont = t.continentId!=null ? mapData.continents[t.continentId] : null;
      color = cont ? cont.color : '#3a3f52';
    } else {
      const ownerId = game.owner[t.id];
      color = ownerId!==undefined ? playerOf(ownerId).color : '#444';
    }
    pathFromLoops(ctx, getTerritoryBoundaryLoops(mapData, t.id));
    ctx.fillStyle = color;
    ctx.fill();
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
  // selection highlight
  [['selectedFrom','#fff'],['selectedTo','#f2b84b']].forEach(([key,col])=>{
    const id = game[key];
    if(id!=null && mapData.territories[id]){
      pathFromLoops(ctx, getTerritoryBoundaryLoops(mapData, id));
      ctx.strokeStyle=col; ctx.lineWidth=3;
      ctx.stroke();
    }
  });
  // army badges
  Object.values(mapData.territories).forEach(t=>{
    if(t.cells.length===0) return;
    const armyCount = game.armies[t.id];
    if(armyCount===undefined) return;
    const x=t.centroid.x, y=t.centroid.y;
    ctx.beginPath(); ctx.arc(x,y,13,0,Math.PI*2);
    ctx.fillStyle='rgba(10,14,24,0.85)'; ctx.fill();
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
      ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.fillText(label, pos.x+1, pos.y-19);
      ctx.fillStyle='#fff'; ctx.fillText(label, pos.x, pos.y-20);
    });
  }
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
    const line2 = el('div','pline2');
    [['🗺️',mine.length],['🌍',contsHeld],['🃏',p.cards.length]].forEach(([icon,val])=>{
      line2.appendChild(el('span','stat-item', `${icon} ${val}`));
    });
    card.appendChild(line1); card.appendChild(line2);
    wrap.appendChild(card);
  });
}


function renderCombatLog(){
  const wrap = $('combatLog');
  wrap.innerHTML='';
  game.log.slice(-60).reverse().forEach(entry=>{
    const d = el('div','log-entry '+entry.type, entry.msg);
    wrap.appendChild(d);
  });
}

function showDice(ad,dd,results){
  const box = $('diceBox'); box.innerHTML='';
  const g1 = el('div','dice-group');
  ad.forEach((v,i)=>{ const win = i<results.length? results[i].win : null; g1.appendChild(el('div','die'+(win===true?' win':win===false?' lose':''), v)); });
  const g2 = el('div','dice-group');
  dd.forEach((v,i)=>{ const win = i<results.length? !results[i].win : null; g2.appendChild(el('div','die'+(win===true?' win':win===false?' lose':''), v)); });
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
}
// Keeps attacking the same target back-to-back (same silent-round-then-summarize approach as
// the AI's battleBatch() in 05-ai.js) until the source runs dry or the target is captured.
function allOutAttack(){
  const p = currentPlayer();
  if(!canAttackNow(p)) return;
  const fromId = game.selectedFrom, toId = game.selectedTo;
  const fromName = mapData.territories[fromId].name, toName = mapData.territories[toId].name;
  const defenderName = game.players[game.owner[toId]].name;
  let rounds=0, attLossTotal=0, defLossTotal=0, captured=false, lastRes=null;
  while(game.armies[fromId]>=2 && canAttack(fromId,toId,p.id)){
    lastRes = doBattle(fromId, toId, {silent:true});
    rounds++; attLossTotal += lastRes.attLoss; defLossTotal += lastRes.defLoss;
    if(lastRes.captured){ captured=true; break; }
  }
  if(rounds>0){
    const roundsLabel = rounds>1 ? ` (${rounds} hiệp)` : '';
    logMsg('attack', `${p.name} tấn công ${toName} từ ${fromName}${roundsLabel}: mất ${attLossTotal}, đối phương mất ${defLossTotal}.`);
    if(lastRes) showDice(lastRes.ad, lastRes.dd, lastRes.results);
    if(captured) logMsg('capture', `${p.name} chiếm được ${toName}!`);
    recordBattleStat(p.name, defenderName, fromName, toName, attLossTotal+defLossTotal);
  }
  if(game.armies[fromId]<2) game.selectedFrom=null;
  renderGame();
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
    logMsg('info', p.name+' chuyển '+n+' quân từ '+fromName+' sang '+toName+'.');
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
  $('cardCountBadge').textContent = game.players[0].cards.length;
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

