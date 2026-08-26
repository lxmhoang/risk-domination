/* =========================================================================
   AI LOGIC
   ---------------------------------------------------------------------
   No external file/spec — this comment block IS the AI's "design doc".
   Each AI turn runs four steps in sequence (reinforce -> attack -> fortify
   -> end turn), and every decision is a simple weighted-scoring heuristic,
   not lookahead/minimax or ML. Three strategic layers on top of the basic
   "attack the best odds" behavior:

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
   5. ALLIANCE (optional, game.allianceEnabled): when on, an AI that isn't
      currently the strongest player is reluctant to fight OTHER non-leaders
      and instead prefers piling onto whoever IS the leader — a loose "gang
      up on the leader" dynamic instead of every AI treating all rivals the
      same.
   ========================================================================= */

const AI_PERSONALITIES = {
  balanced:    { label:'Cân bằng',              thresholdAdj: 0,     reserveMult:1.0, killBonusMult:1.0, continentBonusMult:1.0 },
  turtle:      { label:'Rùa (thủ chắc)',         thresholdAdj: 0.4,   reserveMult:1.6, killBonusMult:0.7, continentBonusMult:1.2 },
  rusher:      { label:'Xông pha (háo chiến)',   thresholdAdj:-0.35,  reserveMult:0.4, killBonusMult:1.0, continentBonusMult:0.8 },
  opportunist: { label:'Cơ hội (săn con mồi yếu)', thresholdAdj:-0.1, reserveMult:0.9, killBonusMult:1.8, continentBonusMult:0.9 },
};

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

function pickAIReinforceTarget(pid, mine){
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
    if(score>bestScore){ bestScore=score; best=id; }
  });
  if(best===null) best = randChoice(mine);
  return best;
}

function aiRunFullTurn(pid){
  setActionHint(game.players[pid].name+' đang suy nghĩ...');
  aiSchedule(()=>{ aiReinforceStep(pid); }, aiDelay(300));
}

function aiReinforceStep(pid){
  const p = game.players[pid];
  aiTryTradeCards(p);
  let guard=0;
  while(game.reinforceRemaining>0 && guard++<200){
    const mine = ownedTerritories(pid);
    const target = pickAIReinforceTarget(pid, mine);
    game.armies[target]++;
    game.reinforceRemaining--;
  }
  renderGame();
  aiSchedule(()=> aiAttackStep(pid), aiDelay(350));
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
  logMsg('info', p.name+' đổi thẻ bài lấy '+value+' quân.');
  renderGame();
}

function aiAttackStep(pid){
  game.phase='attack';
  const p = game.players[pid];
  const profile = difficultyProfile(game.difficulty, p.personality);
  const opponents = game.players.filter(pl=>pl.alive && pl.id!==pid);
  const myPower = evaluatePlayerPower(pid);
  let leaderId = null, leaderPower = -1;
  opponents.forEach(pl=>{ const pw = evaluatePlayerPower(pl.id); if(pw>leaderPower){ leaderPower=pw; leaderId=pl.id; } });
  const iAmLeader = pid===leaderId;

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
      if(game.allianceEnabled && !iAmLeader){
        if(defenderId===leaderId) bonus += 1.2;   // gang up on whoever is currently strongest
        else bonus -= 0.8;                        // reluctant to fight a fellow underdog instead
      }
    }
    return {ratio, score:ratio+bonus, bonus};
  }

  // Fights repeated silent rounds against the same target while the attack is still
  // profitable (reserve/threshold re-checked every round, since armies shrink round by
  // round), so a huge army-count mismatch resolves in one go instead of needing hundreds
  // of individually-delayed AI turns. Only the final round's dice are shown, and all the
  // rounds get folded into one combat-log line, since the in-between rounds have no delay
  // to actually be seen anyway.
  const BATCH_GUARD = 5000;
  function battleBatch(fromId, toId, fromName, toName, defenderName){
    let rounds=0, attLossTotal=0, defLossTotal=0, captured=false, lastRes=null;
    while(rounds<BATCH_GUARD){
      if(game.armies[fromId]<2) break;
      const ev = attackScore(fromId, toId);
      if(!ev) break;
      const threshold = Math.max(1.05, profile.baseThreshold - ev.bonus*0.3);
      if(ev.ratio<threshold) break;
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

  let guard=0;
  function step(){
    if(game.over) return;
    guard++;
    if(guard>60){ aiFortifyStep(pid); return; }
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
    if(!bestOpt || bestEval.ratio<effectiveThreshold){ aiFortifyStep(pid); return; }

    const { from, to } = bestOpt;
    const fromName = mapData.territories[from].name, toName = mapData.territories[to].name;
    const defenderName = game.players[game.owner[to]].name;
    const result = battleBatch(from, to, fromName, toName, defenderName);
    if(result.rounds>0){
      const roundsLabel = result.rounds>1 ? ` (${result.rounds} hiệp)` : '';
      logMsg('attack', `${p.name} tấn công ${toName} từ ${fromName}${roundsLabel}: mất ${result.attLossTotal}, đối phương mất ${result.defLossTotal}.`);
      if(result.lastRes) showDice(result.lastRes.ad, result.lastRes.dd, result.lastRes.results);
      if(result.captured){
        logMsg('capture', `${p.name} chiếm được ${toName}!`);
      }
    }
    renderGame();
    if(game.over) return;
    aiSchedule(step, aiDelay(260));
  }
  step();
}

function aiFortifyStep(pid){
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
  if(interior.length && borders.length){
    const src = interior.sort((a,b)=>game.armies[b]-game.armies[a])[0];
    let bestDst=null;
    for(const dst of borders){
      if(pathExistsOwned(src,dst,pid) && src!==dst){ bestDst=dst; break; }
    }
    if(bestDst){
      const moving = game.armies[src]-1;
      if(moving>0){
        game.armies[src]-=moving; game.armies[bestDst]+=moving;
        logMsg('info', p.name+' tăng cường '+moving+' quân đến '+mapData.territories[bestDst].name+'.');
      }
    }
  }
  renderGame();
  aiSchedule(()=> endTurn(), aiDelay(400));
}

