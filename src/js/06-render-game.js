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

function drawGameCanvas(){
  const canvas = $('gameCanvas');
  const cs = mapData.cellSize;
  canvas.width = mapData.cols*cs;
  canvas.height = mapData.rows*cs;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle='#123a56';
  ctx.fillRect(0,0,canvas.width,canvas.height);

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
      ctx.fillRect(0,0,canvas.width,canvas.height);
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
    const name = el('div','pname');
    name.innerHTML = `<span class="pdot" style="background:${p.color}"></span> ${p.name} ${p.isHuman?'(Bạn)':''}`;
    const mine = ownedTerritories(p.id);
    const totalArmies = mine.reduce((s,id)=>s+(game.armies[id]||0),0);
    const contsHeld = Object.values(mapData.continents).filter(cont=>{
      const ct = Object.values(mapData.territories).filter(t=>t.continentId===cont.id).map(t=>t.id);
      return ct.length>0 && ct.every(id=>game.owner[id]===p.id);
    }).length;
    // Each stat is icon + number with a separately-tagged text label, so mobile CSS can
    // hide just the ".stat-label" words and keep the game readable as icon+number only.
    const stats = el('div','pstats');
    [['🗺️',mine.length,'vùng'],['⚔️',totalArmies,'quân'],['🌍',contsHeld,'châu lục'],['🃏',p.cards.length,'thẻ']].forEach(([icon,val,label])=>{
      stats.appendChild(el('span','stat-item', `${icon} ${val}<span class="stat-label"> ${label}</span>`));
    });
    card.appendChild(name); card.appendChild(stats);
    wrap.appendChild(card);
  });
}

// Picks side-by-side ("map-landscape": map left, narrow control rail right) vs stacked
// ("map-portrait": map on top, controls below) for the mobile game screen — see the CSS
// in style.css for the actual re-layout, this just decides which one to apply.
//
// Deciding this from the map's cols/rows alone (wide map -> side-by-side) sounds right but
// backfires on an ordinary portrait phone: a wide map crammed into a side-by-side layout
// only gets (screen width minus the rail) to work with, and since it's WIDE it needs a lot
// of width per unit of height, so it ends up tiny — measured on a 390x844 viewport with a
// 40x20 map, side-by-side rendered a 270x135 canvas vs 370x185 (~2x the area) when forced
// to stack instead. So instead of trusting the map's shape in isolation, this picks whichever
// candidate actually gives the map more room — the thing the "ưu tiên hiển thị map đầy đủ" ask
// actually cares about. (Desktop is untouched: the CSS only acts on these classes below the
// 980px breakpoint — kept wide enough to also cover phones held in landscape orientation.)
//
// This used to estimate the two candidates' available space from guessed pixel constants
// (topbar height, rail width, ...), which drifted out of sync with the real CSS and badly
// under/over-estimated on short landscape viewports (e.g. a 915x412 window ended up with a
// tiny, height-bound map because the guessed "controls" height budget was way off). Instead,
// this now toggles each class on for real, measures the actual #gameCanvasWrap box the CSS
// produces, and keeps whichever real measurement wins — no guessed numbers to go stale.
function updateGameLayoutOrientation(){
  const el = $('screen-game');
  if(window.innerWidth > 980){ el.classList.remove('map-landscape','map-portrait'); return; }

  // .log-open (see 08-wiring.js) swaps the map and log's positions within map-landscape, which
  // would otherwise throw off the measurement below (the map would measure as its shrunk,
  // swapped-in-the-rail size instead of its normal one). Decide landscape-vs-portrait based on
  // the default arrangement, then restore whatever the log's actual open/closed state was.
  const wasLogOpen = el.classList.contains('log-open');
  el.classList.remove('log-open');

  const mapRatio = mapData.cols / mapData.rows; // width/height the canvas wants
  // Max area of a mapRatio-shaped rectangle that fits in a w×h box (contain-fit).
  const containArea = (w,h) => (w<=0||h<=0) ? 0 : ((w/h > mapRatio) ? h*h*mapRatio : w*w/mapRatio);
  function measure(mode){
    el.classList.remove('map-landscape','map-portrait');
    el.classList.add(mode);
    const box = $('gameCanvasWrap').getBoundingClientRect();
    return containArea(box.width, box.height);
  }
  const areaLandscape = measure('map-landscape');
  const areaPortrait = measure('map-portrait');
  const landscape = areaLandscape >= areaPortrait;
  el.classList.toggle('map-landscape', landscape);
  el.classList.toggle('map-portrait', !landscape);
  el.classList.toggle('log-open', wasLogOpen);
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
  updateGameLayoutOrientation();
  renderTopbar();
  renderPlayerList();
  drawGameCanvas();
  renderPhaseActions();
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
  const c=Math.floor(x/mapData.cellSize), r=Math.floor(y/mapData.cellSize);
  if(!inBounds(mapData,c,r)) return -1;
  return mapData.cellTerritory[cellIndex(mapData,c,r)];
}

function gameCanvasClick(evt){
  if(game.over) return;
  const p = currentPlayer();
  if(!p.isHuman) return;
  // setup-place is handled entirely by the pointerdown/hold wiring instead (so holding down
  // can keep placing armies) — see $('gameCanvas') pointer wiring in 08-wiring.js.
  if(game.phase==='setup-place') return;
  const terrId = getTerritoryFromCanvasEvent($('gameCanvas'), evt);
  if(terrId===-1) return;

  if(game.phase==='reinforce'){
    placeReinforcement(terrId);
    return;
  }
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

