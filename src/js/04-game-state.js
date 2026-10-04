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

// Three trade-bonus rules a game can be started with (see game.tradeRule, chosen in setup):
//  - fixed:       classic escalating table, but it PLATEAUS at the last table value forever
//                 once reached — no reason to ever hold cards, every trade from then on pays
//                 exactly the same.
// The table (tradeValues), the progressive step and the exponential base/growth are from the config.
//  - progressive: the table keeps climbing forever (+5 per trade) based on a count SHARED by
//                 all players — trading later (after opponents have also traded) pays more, so
//                 holding cards is a real (if risky) strategy. This is the game's original/
//                 default behavior.
//  - exponential: value compounds ~1.3x per trade, but tracked PER PLAYER instead of globally —
//                 an opponent trading a lot doesn't help or hurt you; only your OWN trade count
//                 matters, so the earlier and more often YOU personally trade, the faster your
//                 own trades ramp up.
function tradeInValue(rule, tradeCount, personalTradeCount){
  const C = RUNTIME_CONFIG, table = C.tradeValues;
  if(rule==='exponential') return Math.round(C.tradeExpBase*Math.pow(C.tradeExpGrowth, personalTradeCount));
  if(rule==='fixed') return table[Math.min(tradeCount, table.length-1)];
  // progressive (default)
  if(tradeCount < table.length) return table[tradeCount];
  return table[table.length-1] + (tradeCount-table.length+1)*C.tradeProgressiveStep;
}

// playerConfigs: [{name, color, personality, isHuman}, ...] — index 0 is "you" (a real human
// unless spectator mode made them AI-controlled too), built by readPlayerConfigs() in the
// setup screen.
// seed: optional — everything random in the game follows from it (see random() in
// 00-core-utils.js); left out, a fresh one is picked.
function initGame(playerConfigs, difficulty, spectator, allianceEnabled, tradeRule, seed){
  if(seed==null) seed = newRandomSeed();
  game = { rng: seedRng(seed) }; // live from here on, so the shuffles below already use it
  spectatorMode = !!spectator;
  aiPaused = false; pendingAIResume = null;
  host.onGameInit(); // the browser resets zoom and leftover fades/tweens from the last game
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
    seed, rng: game.rng,
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
  host.renderCombatLog();
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
      host.renderGame();
      advanceSetupTurn();
    }, 120);
  } else {
    host.renderGame();
    host.setActionHint('Nhấp vào lãnh thổ của bạn để đặt quân. Còn lại: '+game.pool[p.id]);
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
  host.renderGame();
  if(allPoolsEmpty()){ beginReinforcePhase(); }
  else { host.setActionHint('Còn lại: '+game.pool[p.id]+' quân để đặt.'); advanceSetupTurn(); }
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

/* ---------------- Reinforcement ---------------- */
// Same math computeReinforcements() used to do inline, just broken out into its parts (base
// from territory count + which continents kicked in a bonus) so the reinforce-phase log line
// can show WHERE the number came from instead of just the final total.
function reinforcementBreakdown(pid){
  const mine = ownedTerritories(pid);
  const base = Math.max(RUNTIME_CONFIG.reinforceMin, Math.floor(mine.length/RUNTIME_CONFIG.reinforceDivisor));
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
  host.showTurnIntro(p);
  game.phase='reinforce';
  const breakdown = reinforcementBreakdown(p.id);
  game.reinforceRemaining = breakdown.total;
  p.totalReinforced += game.reinforceRemaining;
  const parts = [`${breakdown.territoryCount} lãnh thổ → ${breakdown.base}`]
    .concat(breakdown.continentBonuses.map(c=>`${c.name} +${c.bonus}`));
  logMsg('info', `${p.name} nhận ${game.reinforceRemaining} quân tăng viện (${parts.join(', ')}).`, p.id);
  // Render right away regardless of whose turn this is — otherwise the previous (human) turn's
  // phase-end button/phase badge would stay on screen, still clickable, for the whole
  // TURN_INTRO_TOTAL_MS delay below before the AI actually starts acting.
  host.renderGame();
  if(!p.isHuman){
    // Held off by the turn-intro banner's own lifetime (see TURN_INTRO_TOTAL_MS) so the AI
    // doesn't start acting while the "lượt của X" banner is still showing/fading for the
    // previous turn's viewer. Goes through aiSchedule (not a raw setTimeout) so pausing the AI
    // mid-banner still works.
    aiSchedule(()=> aiRunFullTurn(p.id), TURN_INTRO_TOTAL_MS);
  } else {
    // forced trade if 5+ cards
    if(p.cards.length>=5){ host.openCardsModal(true); }
    host.setActionHint('Nhấp vào lãnh thổ của bạn để đặt quân. Còn lại: '+game.reinforceRemaining);
  }
}

function placeReinforcement(terrId){
  const p = currentPlayer();
  if(game.owner[terrId]!==p.id) return false;
  if(game.reinforceRemaining<=0) return false;
  game.armies[terrId]++;
  game.reinforceRemaining--;
  host.renderGame();
  // Auto-advances once every troop is placed — unlike attack/fortify, there's no real decision
  // left to make in reinforce once the pool hits 0, so a manual "kết thúc" click here would just
  // be a needless extra tap. (If the player has 5+ cards, the forced-trade modal blocks placing
  // the LAST troops until they trade down — see startReinforce()/endAttackPhase() — so this only
  // ever fires once that's already resolved.)
  if(game.reinforceRemaining<=0){
    beginAttackPhase();
  } else {
    host.setActionHint('Còn lại: '+game.reinforceRemaining+' quân để đặt.');
  }
  return true;
}

/* ---------------- Attack ---------------- */
function beginAttackPhase(){
  game.phase='attack';
  game.selectedFrom=null; game.selectedTo=null;
  // "Kết thúc tấn công" only reveals itself ATTACK_END_BUTTON_DELAY_MS after landing here (see
  // renderPhaseActions() in 06-render-game.js) — a fresh timestamp every time this phase is
  // (re-)entered, including the forced-card-trade bounce-back in endAttackPhase() that returns
  // here, so that always gets its own full wait too.
  game.attackPhaseEnteredAt = Date.now();
  host.renderGame();
  host.setActionHint('Chọn lãnh thổ của bạn (≥2 quân) rồi lãnh thổ địch liền kề để tấn công.');
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
  if(!silent) host.showDice(ad,dd,results);
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
  if(!silent) host.renderGame();
  return {attLoss,defLoss,captured,ad,dd,results,moving,maxMovable};
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
    host.showGameOver(alivePlayers[0]);
  }
}

/* ---------------- Fortify ---------------- */
function beginFortifyPhase(){
  game.phase='fortify';
  game.selectedFrom=null; game.selectedTo=null;
  host.renderGame();
  if(!currentPlayer().isHuman) return; // handled by AI routine
  host.setActionHint('Chọn lãnh thổ nguồn rồi đích để chuyển quân, hoặc kết thúc lượt.');
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
  host.beforeEndTurn(p);
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
