/* =========================================================================
   GAME STATE
   ========================================================================= */
let game = null; // set on start
let showContinentsGame = false;
// Combat-log filter (toggled by btnToggleLogFilter, see 08-wiring.js): when true,
// renderCombatLog() only shows entries tagged with player 0's id — "your" slot, same
// convention as isHuman:i===0 in readPlayerConfigs() (still true even in spectator mode,
// where index 0 is AI-controlled but is still nominally "your" side).
let logFilterMine = false;

function standardStartingArmies(numPlayers){
  const table = {2:40,3:35,4:30,5:25,6:20};
  return table[numPlayers] || 20;
}

const CARD_TYPES = ['infantry','cavalry','artillery'];
const CARD_ICON = {infantry:'🪖', cavalry:'🐎', artillery:'💣'};
const TRADE_VALUES = [4,6,8,10,12,15,20];

// Three trade-bonus rules a game can be started with (see game.tradeRule, chosen in setup):
//  - fixed:       classic escalating table, but it PLATEAUS at the last table value forever
//                 once reached — no reason to ever hold cards, every trade from then on pays
//                 exactly the same.
//  - progressive: the table keeps climbing forever (+5 per trade) based on a count SHARED by
//                 all players — trading later (after opponents have also traded) pays more, so
//                 holding cards is a real (if risky) strategy. This is the game's original/
//                 default behavior.
//  - exponential: value compounds ~1.3x per trade, but tracked PER PLAYER instead of globally —
//                 an opponent trading a lot doesn't help or hurt you; only your OWN trade count
//                 matters, so the earlier and more often YOU personally trade, the faster your
//                 own trades ramp up.
function tradeInValue(rule, tradeCount, personalTradeCount){
  if(rule==='exponential') return Math.round(4*Math.pow(1.3, personalTradeCount));
  if(rule==='fixed') return TRADE_VALUES[Math.min(tradeCount, TRADE_VALUES.length-1)];
  // progressive (default)
  if(tradeCount < TRADE_VALUES.length) return TRADE_VALUES[tradeCount];
  return TRADE_VALUES[TRADE_VALUES.length-1] + (tradeCount-TRADE_VALUES.length+1)*5;
}

// playerConfigs: [{name, color, personality, isHuman}, ...] — index 0 is "you" (a real human
// unless spectator mode made them AI-controlled too), built by readPlayerConfigs() in the
// setup screen.
function initGame(playerConfigs, difficulty, spectator, allianceEnabled, tradeRule){
  spectatorMode = !!spectator;
  aiPaused = false; pendingAIResume = null;
  gameZoom = 1;
  resetRenderAnimState(); // no leftover fades/tweens from whatever was drawn before this game
  const startArmies = standardStartingArmies(playerConfigs.length);
  // totalReinforced/totalKills are cumulative since game start (shown in the topbar), unlike
  // the per-turn capturedThisTurn/killedThisTurn flags which reset every endTurn().
  const players = playerConfigs.map((cfg,id)=>({
    id, name:cfg.name, isHuman:cfg.isHuman, color:cfg.color, alive:true, cards:[],
    capturedThisTurn:false, killedThisTurn:false, totalReinforced:startArmies, totalKills:0,
    personality: cfg.isHuman ? 'balanced' : cfg.personality, eliminatedRound:null,
    personalTradeCount: 0, // only used by the 'exponential' trade rule (see tradeInValue())
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
    tradeRule: tradeRule || 'progressive',
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

// playerIds: which player(s) this entry is "about" — a single id, an array of ids, or
// omitted for a global/system message (game start, etc). Read by renderCombatLog() when
// logFilterMine is on: an entry with no playerIds always shows, one with playerIds only
// shows if player 0 ("you", see logFilterMine above) is among them.
function logMsg(type,msg,playerIds){
  const ids = playerIds==null ? null : (Array.isArray(playerIds) ? playerIds : [playerIds]);
  game.log.push({type,msg,playerIds:ids});
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

// Places 1 army for the human into `terrId` if it's currently their turn/valid, same effect as
// a single click during setup-place. Returns whether a placement actually happened.
function attemptSetupPlacement(terrId){
  if(!game || game.over || game.phase!=='setup-place') return false;
  const p = currentPlayer();
  if(!p.isHuman || terrId===-1 || game.owner[terrId]!==p.id || game.pool[p.id]<=0) return false;
  game.armies[terrId]++; game.pool[p.id]--;
  renderGame();
  if(allPoolsEmpty()){ beginReinforcePhase(); }
  else { setActionHint('Còn lại: '+game.pool[p.id]+' quân để đặt.'); advanceSetupTurn(); }
  return true;
}

// Whether a press-and-hold placement loop should keep waiting for another turn to come back
// around (turn order cycles through the AI between each of the human's own placements, so
// most ticks while holding land mid-AI-turn — that's not a reason to stop), vs give up
// entirely because the phase ended or this spot/player can no longer place here.
function canKeepHoldingSetupPlacement(terrId){
  if(!game || game.over || game.phase!=='setup-place') return false;
  const p = currentPlayer();
  if(p.isHuman && (game.owner[terrId]!==p.id || game.pool[p.id]<=0)) return false;
  return true;
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
  // Captured here (not at initGame time) since this is the point where territory/army
  // placement is actually finalized — reached the same way whether that came from the
  // auto-place fast path or a full manual setup-place sequence. Read back by
  // replaySameGame() so "Chơi lại" on the game-over screen can restart from this exact
  // starting position (same map/players/territories/armies) instead of a fresh shuffle.
  game.startSnapshot = {
    players: game.players.map(p=>({name:p.name, isHuman:p.isHuman, color:p.color, personality:p.personality})),
    owner: {...game.owner},
    armies: {...game.armies},
    turnOrder: [...game.turnOrder],
    difficulty: game.difficulty,
    allianceEnabled: game.allianceEnabled,
    tradeRule: game.tradeRule,
    spectatorMode: spectatorMode,
  };
  startReinforce();
}

// "Chơi lại" (game-over screen): rebuilds the exact starting position captured by
// beginReinforcePhase() — same map (mapData is untouched since game-over), same players/
// difficulty/settings, same territory-owner/army layout — then plays out fresh from there.
// Dice rolls, AI randomness, and any human choices are NOT replayed, so the match itself
// will very likely unfold differently this time; only the starting position is identical.
function replaySameGame(){
  const snap = game.startSnapshot;
  if(!snap) return;
  const playerConfigs = snap.players.map(p=>({name:p.name, isHuman:p.isHuman, color:p.color, personality:p.personality}));
  initGame(playerConfigs, snap.difficulty, snap.spectatorMode, snap.allianceEnabled, snap.tradeRule);
  game.owner = {...snap.owner};
  game.armies = {...snap.armies};
  game.turnOrder = [...snap.turnOrder];
  game.players.forEach(p=>{ game.pool[p.id] = 0; });
  showScreen('screen-game');
  beginReinforcePhase();
}

/* ---------------- Reinforcement ---------------- */
// Same math computeReinforcements() used to do inline, just broken out into its parts (base
// from territory count + which continents kicked in a bonus) so the reinforce-phase log line
// can show WHERE the number came from instead of just the final total.
function reinforcementBreakdown(pid){
  const mine = ownedTerritories(pid);
  const base = Math.max(3, Math.floor(mine.length/3));
  const continentBonuses = [];
  Object.values(mapData.continents).forEach(cont=>{
    const contTerrs = Object.values(mapData.territories).filter(t=>t.continentId===cont.id).map(t=>t.id);
    if(contTerrs.length>0 && contTerrs.every(id=>game.owner[id]===pid)) continentBonuses.push({name:cont.name, bonus:cont.bonus});
  });
  const total = base + continentBonuses.reduce((s,c)=>s+c.bonus, 0);
  return {total, base, territoryCount:mine.length, continentBonuses};
}
function computeReinforcements(pid){ return reinforcementBreakdown(pid).total; }

function startReinforce(){
  const p = currentPlayer();
  game.phase='reinforce';
  const breakdown = reinforcementBreakdown(p.id);
  game.reinforceRemaining = breakdown.total;
  p.totalReinforced += game.reinforceRemaining;
  const parts = [`${breakdown.territoryCount} lãnh thổ → ${breakdown.base}`]
    .concat(breakdown.continentBonuses.map(c=>`${c.name} +${c.bonus}`));
  logMsg('info', `${p.name} nhận ${game.reinforceRemaining} quân tăng viện (${parts.join(', ')}).`, p.id);
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
  if(!silent) logMsg('attack', `${attP.name} tấn công ${mapData.territories[toId].name} từ ${mapData.territories[fromId].name}: mất ${attLoss}, đối phương mất ${defLoss}.`, [attP.id, defP.id]);
  let captured=false, moving=null, maxMovable=null;
  if(game.armies[toId]<=0){
    captured=true;
    // Risk rule: must move at least as many armies as dice used in the winning roll. Apply
    // that guaranteed minimum immediately so game state is always valid; the caller (human
    // attack entry points in 06-render-game.js) decides whether to offer a modal to move
    // more — doBattle() itself doesn't, since it's also called silently by the AI/all-out
    // batch loop where no modal should ever appear mid-batch.
    const conquerMin = attDice;
    maxMovable = game.armies[fromId]-1;
    moving = Math.max(1, Math.min(conquerMin, maxMovable));
    const oldOwner = game.owner[toId];
    game.owner[toId] = game.owner[fromId];
    game.armies[toId] = moving;
    game.armies[fromId] -= moving;
    attP.capturedThisTurn = true;
    if(!silent) logMsg('capture', `${attP.name} chiếm được ${mapData.territories[toId].name}!`, [attP.id, oldOwner]);
    checkElimination(oldOwner, attP.id);
  }
  if(!silent) renderGame();
  return {attLoss,defLoss,captured,ad,dd,results,moving,maxMovable};
}

// Shown by the human attack entry points (doSingleAttack()/allOutAttack() in
// 06-render-game.js) after a fight resolves — folds "kết quả trận đánh" (who lost how many,
// over how many rounds) into the same dialog as the "chiếm được" troop-move decision when the
// attack also captured the territory, instead of only ever showing that decision (and only
// when there was a non-trivial amount to redistribute) while every other outcome sat in the
// combat log alone.
function showAttackResultModal(fromId, toId, info){
  // info: {captured, attLoss, defLoss, rounds, moving, maxMovable} — moving/maxMovable are
  // only meaningful when captured is true.
  const fromName = mapData.territories[fromId].name;
  const toName = mapData.territories[toId].name;
  const overlay = el('div','modal-overlay');
  const modal = el('div','modal');
  let keyHandler = null;
  function close(){
    if(keyHandler) document.removeEventListener('keydown', keyHandler);
    document.body.removeChild(overlay);
  }
  function addCloseButton(){
    const closeBtn = el('button','primary',withShortcut('Đóng','X')); closeBtn.title='Phím tắt: X';
    closeBtn.addEventListener('click', close);
    modal.appendChild(closeBtn);
    keyHandler = e=>{ if(e.key.toLowerCase()==='x'){ e.preventDefault(); close(); } };
    document.addEventListener('keydown', keyHandler);
  }

  const roundsLabel = info.rounds>1 ? ` qua ${info.rounds} hiệp` : '';
  const resultLine = `Bạn mất ${info.attLoss} quân, đối phương mất ${info.defLoss} quân${roundsLabel}.`;

  if(!info.captured){
    modal.appendChild(el('h3','', `⚔️ Không chiếm được "${toName}"`));
    modal.appendChild(el('p','', resultLine));
    addCloseButton();
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    return;
  }

  const alreadyMoved = info.moving, maxMovableArg = info.maxMovable;
  const extraMax = maxMovableArg - alreadyMoved; // how many MORE can move beyond the guaranteed minimum
  modal.appendChild(el('h3','', `🎉 Chiếm được "${toName}"!`));
  modal.appendChild(el('p','', resultLine));
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
    const quickMin = el('button','ghost',withShortcut('Giữ nguyên (+0)','G')); quickMin.title='Phím tắt: G';
    quickMin.addEventListener('click', ()=>{ slider.value='0'; slider.dispatchEvent(new Event('input')); });
    const quickMax = el('button','ghost',withShortcut('Tối đa (+'+extraMax+')','T')); quickMax.title='Phím tắt: T';
    quickMax.addEventListener('click', ()=>{ slider.value=String(extraMax); slider.dispatchEvent(new Event('input')); });
    const confirmBtn = el('button','primary',withShortcut('Xác nhận','X')); confirmBtn.title='Phím tắt: X';
    confirmBtn.addEventListener('click', ()=>{
      const extra = Number(slider.value);
      game.armies[fromId] -= extra;
      game.armies[toId] += extra;
      close();
      renderGame();
    });
    btnRow.appendChild(quickMin); btnRow.appendChild(quickMax); btnRow.appendChild(confirmBtn);
    modal.appendChild(btnRow);

    keyHandler = function(e){
      const key = e.key.toLowerCase();
      if(key==='g'){ e.preventDefault(); quickMin.click(); }
      else if(key==='t'){ e.preventDefault(); quickMax.click(); }
      else if(key==='x'){ e.preventDefault(); confirmBtn.click(); }
    };
    document.addEventListener('keydown', keyHandler);
    // sync the big from/to numbers with the slider's initial value (defaults to max extra) —
    // without this they show the pre-transfer counts until the user drags the slider once.
    slider.dispatchEvent(new Event('input'));
  } else {
    addCloseButton();
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
    logMsg('capture', `${p.name} đã bị loại khỏi ván chơi!`, byPid==null ? pid : [pid, byPid]);
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
    logMsg('info', p.name+' nhận được 1 thẻ bài '+CARD_ICON[type]+'.', p.id);
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

/* ---------------- Save / load an in-progress game ---------------- */
// A save file bundles the map (same plain shape used by the map editor's export) together
// with the `game` object itself, which is already plain JSON-serializable data (no Sets,
// Maps, or function references live on it — those are all on mapData instead).
const GAME_SAVE_FORMAT_VERSION = 1;

function exportGameJSON(){
  const out = {
    formatVersion: GAME_SAVE_FORMAT_VERSION,
    savedAt: Date.now(),
    spectatorMode,
    mapData: mapToPlainObject(mapData),
    game,
  };
  const blob = new Blob([JSON.stringify(out)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0,16).replace(/[:T]/g,'-');
  a.href = url; a.download = 'risk-save-'+stamp+'.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importGameJSON(obj){
  if(!obj || !obj.mapData || !obj.game) throw new Error('File không đúng định dạng ván chơi đã lưu.');
  mapData = mapFromPlainObject(obj.mapData);
  game = obj.game;
  spectatorMode = !!obj.spectatorMode;
  aiPaused = false; pendingAIResume = null;
  gameZoom = 1;
  resetRenderAnimState(); // no leftover fades/tweens from whatever was on screen before loading
  showScreen('screen-game');
  renderGame();
  renderCombatLog();
  if(game.over) return;
  // If it was an AI's turn (or still mid initial placement) when saved, nothing is scheduled
  // to continue it on its own — kick the appropriate step back off from wherever it left off.
  // Each of these reads current game state fresh rather than re-deriving it (e.g. aiReinforceStep
  // just keeps spending game.reinforceRemaining, it doesn't recompute/re-grant it), so resuming
  // mid-phase is safe and doesn't double up any army grants.
  if(game.phase==='setup-place'){
    setupPlaceNext();
  } else {
    const cp = currentPlayer();
    if(!cp.isHuman){
      if(game.phase==='reinforce') aiReinforceStep(cp.id);
      else if(game.phase==='attack') aiAttackStep(cp.id);
      else if(game.phase==='fortify') aiFortifyStep(cp.id);
    }
  }
}

