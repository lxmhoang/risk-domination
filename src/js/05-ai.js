/* =========================================================================
   AI LOGIC
   ---------------------------------------------------------------------
   No external file/spec — this comment block IS the AI's "design doc".
   Every decision is a simple weighted-scoring heuristic, not lookahead/
   minimax or ML. But the turn isn't just four independently-scored steps
   run back to back — it starts with ONE overall campaign decision that the
   rest of the turn serves:

   0. TURN INTENT (see pickAITurnIntent()): before touching any armies, the
      AI looks at the WHOLE board once and commits to a single campaign for
      the turn — finish a continent, kill off a crippled opponent, brace a
      threatened border, or just push at its weakest front. Reinforce,
      attack AND fortify then all read that same intent and bias their
      scoring toward it, instead of each step re-deciding "what matters"
      from scratch in isolation. This is the one part of the AI that
      resembles how a human actually plans a turn.

   Everything below is scoring detail for the four steps that CARRY OUT that
   intent, run in sequence (reinforce -> attack -> fortify -> end turn):

   1. RESERVE AWARENESS ("biết giữ quân"): before attacking FROM a territory,
      the AI first sets aside a defensive reserve sized to the strongest
      OTHER enemy neighbor that territory faces (see reserveFor()). Only the
      surplus above that reserve is considered "usable" for the attack-odds
      calculation, so a stack sitting next to a second, untouched threat
      won't get thrown entirely at the first juicy target. The reserve
      shrinks on Hard and grows on Easy (aggressiveThreshold in
      difficultyProfile()).
   2. CONTINENT AWARENESS ("giữ châu lục để ăn điểm"): capturing a territory
      that completes a continent gets a large score bonus (attackScore()),
      and reinforcement placement (pickAIReinforceTarget) favors defending
      the borders of continents the AI already fully owns, or pushing to
      finish one that's one territory away.
   3. KILL PRIORITY ("diệt hẳn player ngoắc ngoải"): an opponent reduced to
      very few territories is a soft target worth going a little out of your
      way for, because eliminating them transfers their whole card hand to
      the killer (see checkElimination) — the fewer territories/the more
      cards they're holding, the bigger the score bonus to finish them off.
      The AI is also more cautious about picking fights with whoever is
      currently the strongest player (evaluatePlayerPower), unless it's
      already comparably strong itself.
   4. PERSONALITY (per-AI flavor on top of difficulty): each AI player has a
      `personality` (see AI_PERSONALITIES) that nudges the same knobs — how
      big a reserve to keep, how eager to chase continents/kills — so AIs at
      the same difficulty still play distinctly from each other.
   5. ALLIANCE (optional, game.allianceEnabled): when on, and one player has
      pulled CLEARLY ahead of the field (findAllianceLeader() — margin-gated,
      not just "whoever's highest this turn"), every OTHER AI is reluctant to
      fight fellow non-leaders and instead prefers piling onto the leader — a
      loose "gang up on the leader" dynamic instead of every AI treating all
      rivals the same. The leader itself is exempt and just plays normally.
   ========================================================================= */

const AI_PERSONALITIES = {
  balanced:    { label:'Cân bằng',              thresholdAdj: 0,     reserveMult:1.0, killBonusMult:1.0, continentBonusMult:1.0 },
  turtle:      { label:'Rùa (thủ chắc)',         thresholdAdj: 0.4,   reserveMult:1.6, killBonusMult:0.7, continentBonusMult:1.2 },
  rusher:      { label:'Xông pha (háo chiến)',   thresholdAdj:-0.35,  reserveMult:0.4, killBonusMult:1.0, continentBonusMult:0.8 },
  opportunist: { label:'Cơ hội (săn con mồi yếu)', thresholdAdj:-0.1, reserveMult:0.9, killBonusMult:1.8, continentBonusMult:0.9 },
};

// Two gates the #1 player (by evaluatePlayerPower) must BOTH clear before the alliance
// mechanic (game.allianceEnabled) recognizes them as "the leader" worth ganging up on — see
// findAllianceLeader() below:
//  - ALLIANCE_LEADER_VS_FIELD_RATIO: strong enough to threaten the WHOLE rest of the field,
//    not just edge out the closest rival — e.g. with 5 other players, being 1.3x the #2 player
//    means little if the #1 is still weaker than the other 4 combined, since they wouldn't
//    need to team up to handle him.
//  - ALLIANCE_LEADER_MARGIN: clearly ahead of the single closest rival specifically — without
//    this, a 1-army edge in an otherwise close 2-player-ish spread could still pass the field
//    check above.
const ALLIANCE_LEADER_VS_FIELD_RATIO = 0.8;
const ALLIANCE_LEADER_MARGIN = 1.3;

// Alliance-specific "who's the leader" check — considers EVERY alive player (including
// whoever is currently acting), unlike the plain "wary of the strongest opponent" logic in
// attackScore() which only ever looks at OTHER players. That distinction matters here:
// without including self, the actual strongest player on the board could never recognize
// ITSELF as the leader, and would end up applying the "gang up"/reluctance bonuses to its own
// attacks instead of being exempt from them. Returns null when no one clears both gates above.
function findAllianceLeader(){
  const powers = game.players.filter(pl=>pl.alive)
    .map(pl=>({id:pl.id, power:evaluatePlayerPower(pl.id)}))
    .sort((a,b)=>b.power-a.power);
  if(powers.length<2) return null;
  const top = powers[0], rest = powers.slice(1);
  const restTotal = rest.reduce((s,x)=>s+x.power, 0);
  if(top.power < restTotal*ALLIANCE_LEADER_VS_FIELD_RATIO) return null;
  if(top.power < rest[0].power*ALLIANCE_LEADER_MARGIN) return null;
  return top.id;
}

function difficultyProfile(diff, personality){
  // baseThreshold: minimum armies-vs-armies ratio required to attack at all.
  // reserveFactor: how much of a bordering third-party threat to keep in
  //   reserve rather than throw into an attack (higher = more cautious).
  const base = diff==='easy' ? {baseThreshold:2.0, reserveFactor:1.0}
             : diff==='hard' ? {baseThreshold:1.15, reserveFactor:0.3}
             : {baseThreshold:1.5, reserveFactor:0.6};
  const trait = AI_PERSONALITIES[personality] || AI_PERSONALITIES.balanced;
  return {
    baseThreshold: Math.max(1.05, base.baseThreshold + trait.thresholdAdj),
    reserveFactor: Math.max(0, base.reserveFactor * trait.reserveMult),
    killBonusMult: trait.killBonusMult,
    continentBonusMult: trait.continentBonusMult,
  };
}
function difficultyThreshold(diff){ return difficultyProfile(diff).baseThreshold; }

function evaluatePlayerPower(pid){
  const mine = ownedTerritories(pid);
  const armies = mine.reduce((s,id)=> s+(game.armies[id]||0), 0);
  return armies + mine.length*2;
}

// Would owning `terrId` complete every territory of its continent for `pid`?
function completesContinentFor(pid, terrId){
  const t = mapData.territories[terrId];
  if(!t || t.continentId==null) return false;
  const contTerrs = Object.values(mapData.territories).filter(x=>x.continentId===t.continentId);
  return contTerrs.every(x=> x.id===terrId || game.owner[x.id]===pid);
}

// ---------------------------------------------------------------------
// TURN INTENT ("chiến lược tổng thể của lượt"): computed ONCE at the start
// of the turn (aiRunFullTurn), before reinforce/attack/fortify run. Rather
// than each of those three steps scoring its own options in isolation, they
// all read the same `intent` and bias their scoring toward it — a turn spent
// "closing out a continent" reinforces, attacks AND fortifies toward that
// continent instead of three unrelated locally-greedy choices that just
// happen to run back to back. This mirrors how a human plans a turn: look at
// the whole board first, decide the ONE thing this turn is for, then spend
// every action in service of that — rather than re-deciding from scratch at
// every step.
//
// Picked in priority order, first match wins (a human commits to one
// campaign per turn, not several at once):
//   1. finish_continent — one territory away from completing a continent,
//      and that missing territory already borders one of mine (i.e. it's
//      actually reachable this turn, not just "close" on the map).
//   2. kill_weak        — a live opponent down to <=2 territories exists and
//      borders one of mine (finishing them off steals their whole hand).
//   3. defend           — my worst-outgunned border is badly threatened and
//      I'm not the strongest player on the board (can't afford to ignore it
//      to go adventuring elsewhere).
//   4. expand           — no urgent campaign: fall back to pushing at my
//      weakest local front (same territory `defend` would have picked, just
//      without the "danger" framing).
function pickAITurnIntent(pid){
  const mine = ownedTerritories(pid);
  const myPower = evaluatePlayerPower(pid);
  const opponents = game.players.filter(pl=>pl.alive && pl.id!==pid);
  let leaderPower = -1;
  opponents.forEach(pl=>{ leaderPower = Math.max(leaderPower, evaluatePlayerPower(pl.id)); });

  const continentIds = new Set(mine.map(id=>mapData.territories[id].continentId).filter(c=>c!=null));
  for(const contId of continentIds){
    const contTerrs = Object.values(mapData.territories).filter(t=>t.continentId===contId);
    const missing = contTerrs.filter(t=>game.owner[t.id]!==pid);
    if(missing.length===1 && [...missing[0].neighbors].some(n=>game.owner[n]===pid)){
      return {type:'finish_continent', continentId:contId, focusTerrId:missing[0].id};
    }
  }

  let weakTarget=null, weakCount=Infinity;
  opponents.forEach(pl=>{
    const terrs = ownedTerritories(pl.id);
    if(terrs.length===0 || terrs.length>2) return;
    const reachable = terrs.some(tid=>[...mapData.territories[tid].neighbors].some(n=>game.owner[n]===pid));
    if(reachable && terrs.length<weakCount){ weakCount=terrs.length; weakTarget=pl.id; }
  });
  if(weakTarget!=null) return {type:'kill_weak', targetPlayerId:weakTarget};

  let worstBorder=null, worstDeficit=-Infinity;
  mine.forEach(id=>{
    const t = mapData.territories[id];
    const enemyNb = [...t.neighbors].filter(n=>game.owner[n]!==pid);
    if(!enemyNb.length) return;
    const maxEnemy = Math.max(...enemyNb.map(n=>game.armies[n]));
    const deficit = maxEnemy - game.armies[id];
    if(deficit>worstDeficit){ worstDeficit=deficit; worstBorder=id; }
  });
  if(worstBorder!=null && worstDeficit>=2 && myPower<leaderPower){
    return {type:'defend', focusTerrId:worstBorder};
  }

  return {type:'expand', focusTerrId:worstBorder};
}

function pickAIReinforceTarget(pid, mine, intent){
  let best=null, bestScore=-Infinity;
  mine.forEach(id=>{
    const t = mapData.territories[id];
    const enemyNb = [...t.neighbors].filter(n=>game.owner[n]!==pid);
    if(enemyNb.length===0) return; // only border territories are worth reinforcing
    const maxEnemyArmy = Math.max(...enemyNb.map(n=>game.armies[n]));
    let score = maxEnemyArmy - game.armies[id];
    if(t.continentId!=null){
      const contTerrs = Object.values(mapData.territories).filter(x=>x.continentId===t.continentId);
      const ownedCount = contTerrs.filter(x=>game.owner[x.id]===pid).length;
      if(ownedCount===contTerrs.length) score += 1.5;       // defend a continent I already hold
      else if(ownedCount>=contTerrs.length-1) score += 0.8; // one territory away from completing it
    }
    // Nudge reinforcement toward wherever this turn's chosen campaign (see
    // pickAITurnIntent) is actually happening, so troops don't land on some
    // unrelated border just because it scored marginally higher locally.
    if(intent){
      if(intent.type==='finish_continent' && t.continentId===intent.continentId) score += 1.2;
      else if(intent.type==='kill_weak' && enemyNb.some(n=>game.owner[n]===intent.targetPlayerId)) score += 1.2;
      else if((intent.type==='defend'||intent.type==='expand') && id===intent.focusTerrId) score += 1.0;
    }
    if(score>bestScore){ bestScore=score; best=id; }
  });
  if(best===null) best = randChoice(mine);
  return best;
}

function aiRunFullTurn(pid){
  setActionHint(game.players[pid].name+' đang suy nghĩ...');
  const intent = pickAITurnIntent(pid);
  aiSchedule(()=>{ aiReinforceStep(pid, intent); }, aiDelay(300));
}

function aiReinforceStep(pid, intent){
  intent = intent || pickAITurnIntent(pid); // e.g. resuming a save mid-phase, see importGameJSON
  const p = game.players[pid];
  aiTryTradeCards(p);
  let guard=0;
  while(game.reinforceRemaining>0 && guard++<200){
    const mine = ownedTerritories(pid);
    const target = pickAIReinforceTarget(pid, mine, intent);
    game.armies[target]++;
    game.reinforceRemaining--;
  }
  renderGame();
  aiSchedule(()=> aiAttackStep(pid, intent), aiDelay(350));
}

function aiTryTradeCards(p){
  let guard=0;
  // How willing the AI is to hold a valid combo instead of cashing it in immediately depends
  // on which trade rule is active (see tradeInValue() for what each rule means):
  //  - progressive: the shared global count only goes up, so a LATER trade always pays MORE —
  //    holding is a real (if risky, since forced at 5 cards) strategy, so hold fairly often.
  //  - fixed: value plateaus at a fixed cap, so once there, waiting gains nothing — trade ASAP.
  //  - exponential: only the player's OWN trade count matters, and it compounds — the sooner
  //    (and more often) this AI personally trades, the faster ITS OWN future trades ramp up, so
  //    trade ASAP rather than sitting on cards that aren't growing in value by waiting.
  const holdChance = game.tradeRule==='progressive' ? 0.7 : 0.1;
  while(guard++<10){
    const combo = findTradeCombo(p.cards);
    const forced = p.cards.length>=5;
    if(!combo) break;
    if(!forced && Math.random()<holdChance && p.cards.length<5) break; // sometimes hold cards
    tradeCards(p, combo);
  }
}

function findTradeCombo(cards){
  if(cards.length<3) return null;
  for(let i=0;i<cards.length;i++) for(let j=i+1;j<cards.length;j++) for(let k=j+1;k<cards.length;k++){
    const set=[cards[i],cards[j],cards[k]];
    const uniq = new Set(set);
    if(uniq.size===1 || uniq.size===3) return [i,j,k];
  }
  return null;
}

function tradeCards(p, indices){
  const idxSorted = indices.slice().sort((a,b)=>b-a);
  const removed = idxSorted.map(i=>p.cards[i]);
  idxSorted.forEach(i=> p.cards.splice(i,1));
  game.tradeCount++;
  p.personalTradeCount = (p.personalTradeCount||0)+1;
  const value = tradeInValue(game.tradeRule, game.tradeCount, p.personalTradeCount);
  p.totalReinforced += value;
  if(game.phase==='reinforce' && currentPlayerId()===p.id){
    game.reinforceRemaining += value;
  } else {
    game.pool[p.id] = (game.pool[p.id]||0) + value;
  }
  logMsg('info', p.name+' đổi thẻ bài lấy '+value+' quân.', p.id);
  renderGame();
}

function aiAttackStep(pid, intent){
  intent = intent || pickAITurnIntent(pid); // e.g. resuming a save mid-phase, see importGameJSON
  game.phase='attack';
  const p = game.players[pid];
  const profile = difficultyProfile(game.difficulty, p.personality);
  const opponents = game.players.filter(pl=>pl.alive && pl.id!==pid);
  const myPower = evaluatePlayerPower(pid);
  let leaderId = null, leaderPower = -1;
  opponents.forEach(pl=>{ const pw = evaluatePlayerPower(pl.id); if(pw>leaderPower){ leaderPower=pw; leaderId=pl.id; } });
  // Only computed when the setting is on — findAllianceLeader() scans every alive player
  // (self included) and requires a real margin over the runner-up (see its own comment).
  const allianceLeaderId = game.allianceEnabled ? findAllianceLeader() : null;
  const iAmAllianceLeader = pid!=null && pid===allianceLeaderId;

  // How many armies a territory should keep in reserve, sized to the strongest
  // enemy neighbor it borders OTHER than the one currently being considered.
  function reserveFor(fromId, excludeTo){
    const t = mapData.territories[fromId];
    let maxOther = 0;
    t.neighbors.forEach(n=>{
      if(n===excludeTo) return;
      if(game.owner[n]!==pid) maxOther = Math.max(maxOther, game.armies[n]);
    });
    return Math.ceil(maxOther*profile.reserveFactor);
  }

  function attackScore(fromId, toId){
    const usable = Math.max(0, game.armies[fromId]-1-reserveFor(fromId,toId));
    if(usable<1) return null; // nothing safe to attack with once the reserve is set aside
    const ratio = (usable+1)/Math.max(1,game.armies[toId]);
    let bonus = 0;
    if(completesContinentFor(pid, toId)) bonus += 2.5*profile.continentBonusMult;
    const defenderId = game.owner[toId];
    const defP = defenderId!=null ? game.players[defenderId] : null;
    if(defP){
      const defTerrCount = ownedTerritories(defenderId).length;
      if(defTerrCount<=2) bonus += (1.5 + defP.cards.length*0.4)*profile.killBonusMult; // finish them off for the cards
      if(defenderId===leaderId && myPower<leaderPower*1.1) bonus -= 0.6; // wary of picking a fight I can't afford
      if(allianceLeaderId!=null && !iAmAllianceLeader){
        if(defenderId===allianceLeaderId) bonus += 1.2; // gang up on the runaway leader
        else bonus -= 0.8;                              // reluctant to fight a fellow underdog instead
      }
    }
    // Keep this attack aligned with this turn's chosen campaign (see
    // pickAITurnIntent) instead of chasing whatever pair scores highest in
    // isolation this round.
    if(intent.type==='finish_continent' && mapData.territories[toId].continentId===intent.continentId) bonus += 0.8;
    else if(intent.type==='kill_weak' && defenderId===intent.targetPlayerId) bonus += 1.0;
    else if(intent.type==='defend') bonus -= 0.3; // hold back this turn rather than adventure elsewhere
    return {ratio, score:ratio+bonus, bonus};
  }

  // Fights repeated silent rounds against the same target while the attack is still
  // profitable (reserve/threshold re-checked every round, since armies shrink round by
  // round), so a huge army-count mismatch resolves in one go instead of needing hundreds
  // of individually-delayed AI turns. Only the final round's dice are shown, and all the
  // rounds get folded into one combat-log line, since the in-between rounds have no delay
  // to actually be seen anyway.
  const BATCH_GUARD = 5000;
  // force: skip the normal odds threshold (still bound by attackScore's reserve/usable
  // safety floor, just not "is this a good idea") — used by the "guarantee a card every
  // turn" rule below to push through a marginal fight it would otherwise walk away from.
  function battleBatch(fromId, toId, fromName, toName, defenderName, force){
    let rounds=0, attLossTotal=0, defLossTotal=0, captured=false, lastRes=null;
    while(rounds<BATCH_GUARD){
      if(game.armies[fromId]<2) break;
      const ev = attackScore(fromId, toId);
      if(!ev) break;
      if(!force){
        const threshold = Math.max(1.05, profile.baseThreshold - ev.bonus*0.3);
        if(ev.ratio<threshold) break;
      }
      lastRes = doBattle(fromId, toId, {silent:true});
      rounds++;
      attLossTotal += lastRes.attLoss;
      defLossTotal += lastRes.defLoss;
      // Recorded every round (not just once after the loop) so that if THIS round's capture
      // ends the game (checkElimination -> checkWinCondition -> showGameOver runs synchronously
      // inside doBattle, before control even returns here), the summary screen already reflects
      // this battle's running total instead of a stale earlier record.
      recordBattleStat(p.name, defenderName, fromName, toName, attLossTotal+defLossTotal);
      if(lastRes.captured){ captured=true; break; }
    }
    return {rounds, attLossTotal, defLossTotal, captured, lastRes};
  }

  // EXPERIMENTAL RULE: every AI turn must land at least 1 card-earning action (a capture
  // under 'on_capture'/default, a kill under 'on_kill'; 'on_turn_end' always awards one
  // regardless so there's nothing to force). Checked fresh each step() call against the
  // player's own capturedThisTurn/killedThisTurn flags (same ones endTurn() reads), so it
  // stops forcing the instant the requirement is already met — normal odds-based attacking
  // resumes right after.
  function stillNeedsCardThisTurn(){
    const mode = RUNTIME_CONFIG.cardAwardEvent;
    if(mode==='on_turn_end') return false;
    if(mode==='on_kill') return !p.killedThisTurn;
    return !p.capturedThisTurn; // 'on_capture' (default)
  }

  let guard=0;
  function step(){
    if(game.over) return;
    guard++;
    if(guard>60){ game.selectedFrom=null; game.selectedTo=null; aiFortifyStep(pid, intent); return; }
    const mine = ownedTerritories(pid);
    let bestOpt=null, bestEval=null;
    for(const from of mine){
      if(game.armies[from]<2) continue;
      const t = mapData.territories[from];
      for(const to of t.neighbors){
        if(game.owner[to]===pid) continue;
        const ev = attackScore(from, to);
        if(!ev) continue;
        if(!bestEval || ev.score>bestEval.score){ bestEval=ev; bestOpt={from,to}; }
      }
    }
    // bonuses (continent completion / finishing off a weak player) justify taking slightly
    // worse pure odds than the difficulty's base threshold would normally allow.
    const effectiveThreshold = bestEval ? Math.max(1.05, profile.baseThreshold - bestEval.bonus*0.3) : Infinity;
    const meetsThreshold = !!bestOpt && bestEval.ratio>=effectiveThreshold;
    const forcedForCard = !meetsThreshold && !!bestOpt && stillNeedsCardThisTurn();
    if(!bestOpt || (!meetsThreshold && !forcedForCard)){
      game.selectedFrom=null; game.selectedTo=null;
      aiFortifyStep(pid, intent); return;
    }

    const { from, to } = bestOpt;
    // Same selectedFrom/selectedTo the human attack UI uses — this is what makes the pulsing
    // badges and the animated arrow (drawGameCanvas, see attackAnim in 06-render-game.js) show
    // up for an AI's move too, not just a human's. Shown for one aiDelay() beat (the AI's
    // existing "thinking" pause, previously just empty wait time) before actually fighting.
    game.selectedFrom = from; game.selectedTo = to;
    renderGame();
    if(game.over) return;
    aiSchedule(()=> executeAttack(from, to, forcedForCard), aiDelay(260));
  }
  function executeAttack(from, to, forcedForCard){
    if(game.over) return;
    const fromName = mapData.territories[from].name, toName = mapData.territories[to].name;
    const defenderId = game.owner[to];
    const defenderName = game.players[defenderId].name;
    const attackerColor = p.color, defenderColor = game.players[defenderId].color;
    if(forcedForCard) logMsg('info', p.name+' liều đánh '+toName+' để kiếm bài.', [pid, defenderId]);
    const fromCountBefore = game.armies[from], toCountBefore = game.armies[to];
    const result = battleBatch(from, to, fromName, toName, defenderName, forcedForCard);
    const fromCountAfter = game.armies[from], toCountAfter = game.armies[to];
    function nextDecision(){
      game.selectedFrom=null; game.selectedTo=null;
      if(game.over) return;
      // Deliberately NOT aiDelay() here: in spectator mode that ignores its argument and always
      // waits the full configured spectator delay — stacking a second one of those on top of the
      // one already spent before the strike (see step()) plus the ~1.1s attackAnim itself would
      // make every attack take several seconds. The animation just played already gave viewers
      // something to watch; this is just a small breather before the next decision, not a second
      // full "thinking pause".
      aiSchedule(step, 80);
    }
    if(result.rounds<=0){ renderGame(); nextDecision(); return; }
    const roundsLabel = result.rounds>1 ? ` (${result.rounds} hiệp)` : '';
    logMsg('attack', `${p.name} tấn công ${toName} từ ${fromName}${roundsLabel}: mất ${result.attLossTotal}, đối phương mất ${result.defLossTotal}.`, [pid, defenderId]);
    if(result.lastRes) showDice(result.lastRes.ad, result.lastRes.dd, result.lastRes.results);
    if(result.captured) logMsg('capture', `${p.name} chiếm được ${toName}!`, [pid, defenderId]);
    // startAttackAnim's onDone fires once the fly/impact/return sequence finishes (see
    // 06-render-game.js) — the next attack decision waits for that instead of firing right
    // after the battle resolves, same as the human attack flow.
    startAttackAnim({
      fromId:from, toId:to, attLoss:result.attLossTotal, defLoss:result.defLossTotal, captured:result.captured,
      fromCountBefore, toCountBefore, fromCountAfter, toCountAfter, attackerColor, defenderColor,
    }, nextDecision);
    renderGame();
  }
  step();
}

function aiFortifyStep(pid, intent){
  intent = intent || pickAITurnIntent(pid); // e.g. resuming a save mid-phase, see importGameJSON
  game.phase='fortify';
  renderGame();
  const p = game.players[pid];
  // move armies from a safe interior territory to weakest border territory
  const mine = ownedTerritories(pid);
  const interior = mine.filter(id=>{
    const t = mapData.territories[id];
    return [...t.neighbors].every(n=>game.owner[n]===pid) && game.armies[id]>1;
  });
  const borders = mine.filter(id=>{
    const t = mapData.territories[id];
    return [...t.neighbors].some(n=>game.owner[n]!==pid);
  });
  // A border isn't just "a border" — prefer whichever one IS this turn's
  // chosen campaign (see pickAITurnIntent) before falling back to whichever
  // border a path happens to reach first, so the army sent forward actually
  // lands on next turn's front instead of a border unrelated to the plan.
  function isIntentFront(id){
    const t = mapData.territories[id];
    if(intent.type==='finish_continent') return t.continentId===intent.continentId;
    if(intent.type==='kill_weak') return [...t.neighbors].some(n=>game.owner[n]===intent.targetPlayerId);
    return id===intent.focusTerrId; // defend / expand
  }
  const orderedBorders = [...borders].sort((a,b)=> (isIntentFront(b)?1:0) - (isIntentFront(a)?1:0));
  if(interior.length && orderedBorders.length){
    const src = interior.sort((a,b)=>game.armies[b]-game.armies[a])[0];
    let bestDst=null;
    for(const dst of orderedBorders){
      if(pathExistsOwned(src,dst,pid) && src!==dst){ bestDst=dst; break; }
    }
    if(bestDst){
      const moving = game.armies[src]-1;
      if(moving>0){
        game.armies[src]-=moving; game.armies[bestDst]+=moving;
        logMsg('info', p.name+' tăng cường '+moving+' quân đến '+mapData.territories[bestDst].name+'.', pid);
      }
    }
  }
  renderGame();
  aiSchedule(()=> endTurn(), aiDelay(400));
}

