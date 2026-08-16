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
   ========================================================================= */

function difficultyProfile(diff){
  // baseThreshold: minimum armies-vs-armies ratio required to attack at all.
  // reserveFactor: how much of a bordering third-party threat to keep in
  //   reserve rather than throw into an attack (higher = more cautious).
  if(diff==='easy')  return {baseThreshold:2.0, reserveFactor:1.0};
  if(diff==='hard')  return {baseThreshold:1.15, reserveFactor:0.3};
  return {baseThreshold:1.5, reserveFactor:0.6};
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
  while(guard++<10){
    const combo = findTradeCombo(p.cards);
    const forced = p.cards.length>=5;
    if(!combo) break;
    if(!forced && Math.random()<0.4 && p.cards.length<5) break; // sometimes hold cards
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
  const value = tradeInValue(game.tradeCount);
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
  const profile = difficultyProfile(game.difficulty);
  const opponents = game.players.filter(pl=>pl.alive && pl.id!==pid);
  const myPower = evaluatePlayerPower(pid);
  let leaderId = null, leaderPower = -1;
  opponents.forEach(pl=>{ const pw = evaluatePlayerPower(pl.id); if(pw>leaderPower){ leaderPower=pw; leaderId=pl.id; } });

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
    if(completesContinentFor(pid, toId)) bonus += 2.5;
    const defenderId = game.owner[toId];
    const defP = defenderId!=null ? game.players[defenderId] : null;
    if(defP){
      const defTerrCount = ownedTerritories(defenderId).length;
      if(defTerrCount<=2) bonus += 1.5 + defP.cards.length*0.4; // finish them off for the cards
      if(defenderId===leaderId && myPower<leaderPower*1.1) bonus -= 0.6; // wary of picking a fight I can't afford
    }
    return {ratio, score:ratio+bonus, bonus};
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
    doBattle(bestOpt.from, bestOpt.to);
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

