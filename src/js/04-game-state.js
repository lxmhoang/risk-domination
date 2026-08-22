/* =========================================================================
   GAME STATE
   ========================================================================= */
let game = null; // set on start
let showContinentsGame = false;

function standardStartingArmies(numPlayers){
  const table = {2:40,3:35,4:30,5:25,6:20};
  return table[numPlayers] || 20;
}

const CARD_TYPES = ['infantry','cavalry','artillery'];
const CARD_ICON = {infantry:'🪖', cavalry:'🐎', artillery:'💣'};
const TRADE_VALUES = [4,6,8,10,12,15,20];

function tradeInValue(tradeCount){
  if(tradeCount < TRADE_VALUES.length) return TRADE_VALUES[tradeCount];
  return TRADE_VALUES[TRADE_VALUES.length-1] + (tradeCount-TRADE_VALUES.length+1)*5;
}

// playerConfigs: [{name, color, personality, isHuman}, ...] — index 0 is "you" (a real human
// unless spectator mode made them AI-controlled too), built by readPlayerConfigs() in the
// setup screen.
function initGame(playerConfigs, difficulty, spectator, allianceEnabled){
  spectatorMode = !!spectator;
  aiPaused = false; pendingAIResume = null;
  const startArmies = standardStartingArmies(playerConfigs.length);
  // totalReinforced/totalKills are cumulative since game start (shown in the topbar), unlike
  // the per-turn capturedThisTurn/killedThisTurn flags which reset every endTurn().
  const players = playerConfigs.map((cfg,id)=>({
    id, name:cfg.name, isHuman:cfg.isHuman, color:cfg.color, alive:true, cards:[],
    capturedThisTurn:false, killedThisTurn:false, totalReinforced:startArmies, totalKills:0,
    personality: cfg.isHuman ? 'balanced' : cfg.personality, eliminatedRound:null,
  }));
  const terrIds = shuffle(Object.keys(mapData.territories).map(Number));
  const owner = {}; const armies = {};
  terrIds.forEach((id,i)=>{ owner[id] = i % players.length; armies[id] = 1; });

  const pool = {};
  players.forEach(p=> pool[p.id] = startArmies - terrIds.filter(id=>owner[id]===p.id).length);

  game = {
    players, owner, armies, pool,
    turnOrder: shuffle(players.map(p=>p.id)),
    turnIdx: 0,
    phase: 'setup-place', // setup-place -> reinforce -> attack -> fortify
    difficulty,
    roundNumber: 1, // +1 each time turnIdx wraps back to the start of turnOrder (see endTurn())
    reinforceRemaining: 0,
    tradeCount: 0,
    selectedFrom: null, selectedTo: null,
    log: [],
    over: false,
    allianceEnabled: !!allianceEnabled,
    biggestBattle: null, // set by recordBattleStat(), shown on the end-game summary screen
  };
  logMsg('info', 'Ván chơi bắt đầu! '+players.length+' người chơi trên bản đồ "'+mapData.name+'".');
}

function currentPlayerId(){ return game.turnOrder[game.turnIdx]; }
function currentPlayer(){ return game.players[currentPlayerId()]; }
function ownedTerritories(pid){ return Object.keys(game.owner).map(Number).filter(id=>game.owner[id]===pid); }
function isAlive(pid){ return game.players[pid].alive; }

function logMsg(type,msg){
  game.log.push({type,msg});
  renderCombatLog();
}

/* ---------------- Setup placement (initial armies) ---------------- */
function allPoolsEmpty(){ return game.players.every(p=> !p.alive || game.pool[p.id]<=0); }

function setupPlaceNext(){
  // if human has pool left, wait for click; else auto-place for AI/human w/ 0
  if(allPoolsEmpty()){
    beginReinforcePhase();
    return;
  }
  const p = currentPlayer();
  if(game.pool[p.id] <= 0){
    advanceSetupTurn();
    return;
  }
  if(!p.isHuman){
    // AI auto place 1 army on a border territory (or random).
    // Kept fast (no spectator delay) even in "watch AI" mode — placing armies one at a
    // time isn't interesting to watch slowly, so this phase always runs at full speed;
    // the 1s pacing kicks in starting from the reinforce/attack/fortify phases instead.
    aiSchedule(()=>{
      if(!game || game.over) return;
      const mine = ownedTerritories(p.id);
      const target = pickAIReinforceTarget(p.id, mine);
      game.armies[target]++;
      game.pool[p.id]--;
      renderGame();
      advanceSetupTurn();
    }, 120);
  } else {
    renderGame();
    setActionHint('Đặt quân ban đầu: nhấp vào lãnh thổ của bạn để đặt 1 quân. Còn lại: '+game.pool[p.id]);
  }
}
function advanceSetupTurn(){
  game.turnIdx = (game.turnIdx+1) % game.turnOrder.length;
  setupPlaceNext();
}

// Alternative to the turn-based setupPlaceNext() flow: dump every player's starting
// pool onto their own territories at random, all at once, then go straight to
// reinforce. Used when the "Đặt quân thủ công lúc bắt đầu" setting is off.
function autoPlaceInitialArmies(){
  game.players.forEach(p=>{
    const mine = ownedTerritories(p.id);
    while(game.pool[p.id]>0){
      game.armies[randChoice(mine)]++;
      game.pool[p.id]--;
    }
  });
}

function beginReinforcePhase(){
  game.turnIdx = 0;
  game.phase = 'reinforce';
  startReinforce();
}

/* ---------------- Reinforcement ---------------- */
function computeReinforcements(pid){
  const mine = ownedTerritories(pid);
  let base = Math.max(3, Math.floor(mine.length/3));
  Object.values(mapData.continents).forEach(cont=>{
    const contTerrs = Object.values(mapData.territories).filter(t=>t.continentId===cont.id).map(t=>t.id);
    if(contTerrs.length>0 && contTerrs.every(id=>game.owner[id]===pid)) base += cont.bonus;
  });
  return base;
}

function startReinforce(){
  const p = currentPlayer();
  game.phase='reinforce';
  game.reinforceRemaining = computeReinforcements(p.id);
  p.totalReinforced += game.reinforceRemaining;
  logMsg('info', p.name+' nhận '+game.reinforceRemaining+' quân tăng viện.');
  if(!p.isHuman){
    aiRunFullTurn(p.id);
  } else {
    // forced trade if 5+ cards
    if(p.cards.length>=5){ openCardsModal(true); }
    renderGame();
    setActionHint('Giai đoạn tăng viện: nhấp vào lãnh thổ của bạn để đặt quân. Còn lại: '+game.reinforceRemaining);
  }
}

function placeReinforcement(terrId){
  const p = currentPlayer();
  if(game.owner[terrId]!==p.id) return false;
  if(game.reinforceRemaining<=0) return false;
  game.armies[terrId]++;
  game.reinforceRemaining--;
  renderGame();
  if(game.reinforceRemaining<=0){
    beginAttackPhase();
  } else {
    setActionHint('Giai đoạn tăng viện: còn lại '+game.reinforceRemaining+' quân.');
  }
  return true;
}

/* ---------------- Attack ---------------- */
function beginAttackPhase(){
  game.phase='attack';
  game.selectedFrom=null; game.selectedTo=null;
  renderGame();
  setActionHint('Giai đoạn tấn công: chọn lãnh thổ của bạn (có ≥2 quân) rồi chọn lãnh thổ địch liền kề để tấn công. Nhấn "Kết thúc tấn công" khi xong.');
}

function canAttack(fromId,toId,pid){
  if(game.owner[fromId]!==pid) return false;
  if(game.owner[toId]===pid) return false;
  if(game.armies[fromId]<2) return false;
  return mapData.territories[fromId].neighbors.has(toId);
}

function doBattle(fromId,toId,opts){
  // silent: skip dice display/log/render for this single round — used by the AI's
  // battleBatch() to fight many rounds back-to-back without a render per round, then
  // the caller shows the dice/log/render once for the whole batch (see 05-ai.js).
  const silent = !!(opts && opts.silent);
  const attArmies = game.armies[fromId];
  const defArmies = game.armies[toId];
  const attDice = clamp(attArmies-1,1,3);
  const defDice = clamp(defArmies,1,2);
  const ad = Array.from({length:attDice},rollDie).sort((a,b)=>b-a);
  const dd = Array.from({length:defDice},rollDie).sort((a,b)=>b-a);
  let attLoss=0, defLoss=0;
  const pairs = Math.min(ad.length,dd.length);
  const results=[];
  for(let i=0;i<pairs;i++){
    if(ad[i]>dd[i]){ defLoss++; results.push({a:ad[i],d:dd[i],win:true}); }
    else { attLoss++; results.push({a:ad[i],d:dd[i],win:false}); }
  }
  game.armies[fromId]-=attLoss;
  game.armies[toId]-=defLoss;
  if(!silent) showDice(ad,dd,results);
  const attP = game.players[game.owner[fromId]];
  const defP = game.players[game.owner[toId]];
  if(defLoss>0) attP.killedThisTurn = true; // feeds the 'on_kill' cardAwardEvent mode
  attP.totalKills += defLoss; // cumulative since game start, shown in the topbar
  if(!silent) logMsg('attack', `${attP.name} tấn công ${mapData.territories[toId].name} từ ${mapData.territories[fromId].name}: mất ${attLoss}, đối phương mất ${defLoss}.`);
  let captured=false;
  if(game.armies[toId]<=0){
    captured=true;
    // Risk rule: must move at least as many armies as dice used in the winning roll. Apply that
    // guaranteed minimum immediately so game state is always valid, then — for the human player —
    // offer a styled modal to move more (up to everything but 1) instead of blocking with a
    // native browser prompt.
    const conquerMin = attDice;
    const maxMovable = game.armies[fromId]-1;
    const moving = Math.max(1, Math.min(conquerMin, maxMovable));
    const oldOwner = game.owner[toId];
    game.owner[toId] = game.owner[fromId];
    game.armies[toId] = moving;
    game.armies[fromId] -= moving;
    attP.capturedThisTurn = true;
    if(!silent) logMsg('capture', `${attP.name} chiếm được ${mapData.territories[toId].name}!`);
    checkElimination(oldOwner, attP.id);
    if(attP.isHuman && maxMovable>moving){
      openCaptureMoveModal(fromId, toId, moving, maxMovable);
    }
  }
  if(!silent) renderGame();
  return {attLoss,defLoss,captured,ad,dd,results};
}

function openCaptureMoveModal(fromId, toId, alreadyMoved, maxMovable){
  const fromName = mapData.territories[fromId].name;
  const toName = mapData.territories[toId].name;
  const extraMax = maxMovable - alreadyMoved; // how many MORE can move beyond the guaranteed minimum
  const overlay = el('div','modal-overlay');
  const modal = el('div','modal');
  modal.appendChild(el('h3','', `🎉 Chiếm được "${toName}"!`));
  modal.appendChild(el('p','', `Bạn có thể chuyển thêm quân từ "${fromName}" sang "${toName}" (đã chuyển tối thiểu ${alreadyMoved} quân theo luật).`));

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

  if(extraMax>0){
    const sliderRow = el('div',''); sliderRow.style.cssText='display:flex;align-items:center;gap:12px;margin:14px 0 6px;';
    const slider = document.createElement('input');
    slider.type='range'; slider.min='0'; slider.max=String(extraMax); slider.value=String(extraMax);
    slider.style.flex='1';
    const sliderLabel = el('span','', '+'+extraMax); sliderLabel.style.cssText='min-width:48px;text-align:center;font-weight:700;color:var(--good);';
    slider.addEventListener('input', ()=>{
      const extra = Number(slider.value);
      sliderLabel.textContent = '+'+extra;
      fromCount.textContent = String(game.armies[fromId]-extra);
      toCount.textContent = String(game.armies[toId]+extra);
    });
    sliderRow.appendChild(slider); sliderRow.appendChild(sliderLabel);
    modal.appendChild(sliderRow);
    modal.appendChild(el('p','', 'Kéo để chọn số quân chuyển thêm, tối thiểu 1 quân luôn phải ở lại '+fromName+'.')).style.cssText='font-size:11.5px;color:var(--muted);margin:0 0 10px;';

    const btnRow = el('div',''); btnRow.style.cssText='display:flex;gap:8px;';
    const quickMin = el('button','ghost','Giữ nguyên (+0)');
    quickMin.addEventListener('click', ()=>{ slider.value='0'; slider.dispatchEvent(new Event('input')); });
    const quickMax = el('button','ghost','Tối đa (+'+extraMax+')');
    quickMax.addEventListener('click', ()=>{ slider.value=String(extraMax); slider.dispatchEvent(new Event('input')); });
    const confirmBtn = el('button','primary','Xác nhận');
    confirmBtn.addEventListener('click', ()=>{
      const extra = Number(slider.value);
      game.armies[fromId] -= extra;
      game.armies[toId] += extra;
      document.body.removeChild(overlay);
      renderGame();
    });
    btnRow.appendChild(quickMin); btnRow.appendChild(quickMax); btnRow.appendChild(confirmBtn);
    modal.appendChild(btnRow);
  }

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// Tracks the single attack (1 human click, or 1 AI battleBatch) with the highest combined
// army loss across the whole game, shown on the end-game summary screen (showGameOver()).
function recordBattleStat(attackerName, defenderName, fromName, toName, totalLoss){
  if(totalLoss<=0) return;
  if(!game.biggestBattle || totalLoss > game.biggestBattle.totalLoss){
    game.biggestBattle = {attackerName, defenderName, fromName, toName, totalLoss, round: game.roundNumber};
  }
}

function checkElimination(pid, byPid){
  if(pid===undefined) return;
  const p = game.players[pid];
  if(!p.alive) return;
  if(ownedTerritories(pid).length===0){
    p.alive=false;
    p.eliminatedRound = game.roundNumber;
    logMsg('capture', `${p.name} đã bị loại khỏi ván chơi!`);
    // transfer cards
    const byP = game.players[byPid];
    if(byP && p.cards.length){ byP.cards = byP.cards.concat(p.cards); p.cards=[]; }
    checkWinCondition();
  }
}

function checkWinCondition(){
  const alivePlayers = game.players.filter(p=>p.alive);
  if(alivePlayers.length<=1){
    game.over=true;
    showGameOver(alivePlayers[0]);
  }
}

/* ---------------- Fortify ---------------- */
function beginFortifyPhase(){
  game.phase='fortify';
  game.selectedFrom=null; game.selectedTo=null;
  renderGame();
  if(!currentPlayer().isHuman) return; // handled by AI routine
  setActionHint('Giai đoạn tăng cường: chọn lãnh thổ nguồn rồi lãnh thổ đích (cùng phe, có đường nối) để chuyển quân, hoặc kết thúc lượt.');
}

function pathExistsOwned(fromId,toId,pid){
  const seen=new Set([fromId]); const stack=[fromId];
  while(stack.length){
    const cur=stack.pop();
    if(cur===toId) return true;
    mapData.territories[cur].neighbors.forEach(n=>{
      if(!seen.has(n) && game.owner[n]===pid){ seen.add(n); stack.push(n); }
    });
  }
  return false;
}

function endTurn(){
  const p = currentPlayer();
  // cardAwardEvent config (Settings screen) picks which of the 3 rules grants a card
  // at the end of this player's turn. Shared by human and AI turns alike, since both
  // go through this same function.
  const mode = RUNTIME_CONFIG.cardAwardEvent;
  const awardCard = mode==='on_turn_end' ? true
    : mode==='on_kill' ? p.killedThisTurn
    : p.capturedThisTurn; // 'on_capture' (default)
  if(awardCard){
    const type = CARD_TYPES[rand(3)];
    p.cards.push(type);
    logMsg('info', p.name+' nhận được 1 thẻ bài '+CARD_ICON[type]+'.');
  }
  p.capturedThisTurn=false;
  p.killedThisTurn=false;
  do {
    game.turnIdx = (game.turnIdx+1) % game.turnOrder.length;
    if(game.turnIdx===0) game.roundNumber++; // wrapped back to the start of turnOrder = a new round
  } while(!isAlive(currentPlayerId()));
  if(game.over) return;
  startReinforce();
}

