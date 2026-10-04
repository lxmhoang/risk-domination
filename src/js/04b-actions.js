/* =========================================================================
   PLAYER ACTIONS (core)
   ---------------------------------------------------------------------
   The one way a human player changes a game: applyAction(pid, action). It
   checks the move against the rules — whose turn, which phase, who owns what,
   how many armies — and only then carries it out with the functions in
   04-game-state.js. The browser calls it for every click (dispatch() in
   07b-game-ui.js); the server calls it for every request, so nothing a client
   sends is trusted beyond "this player asks to do this".

   Actions:
     {type:'place', terrId}                 one army: initial placement or reinforcement
     {type:'trade', cards:[i,j,k]}          trade in three cards (positions in the hand)
     {type:'attack', from, to, allOut}      one dice round, or keep rolling until it ends
     {type:'moveAfterCapture', count}       extra armies into the territory just captured
     {type:'endAttack'}
     {type:'fortify', from, to, count}
     {type:'endTurn'}

   Returns {ok:true, result} or {ok:false, error:<code>}.
   ========================================================================= */

// A hand this big has to be traded down before doing anything else.
const FORCED_TRADE_HAND = 5;

function isTerritoryId(id){ return Number.isInteger(id) && !!mapData.territories[id]; }

// Back to the reinforce phase with nothing to place, so the only way forward is trading cards
// (which hands out armies to place, which leads back into the attack phase).
function bounceToForcedTrade(){
  game.phase = 'reinforce';
  game.reinforceRemaining = 0;
  game.pendingCapture = null;
}

// One human attack: a single dice round, or (allOut) round after round until the target falls
// or the source can't attack any more. Assumes the attack is legal.
function performAttack(p, fromId, toId, allOut){
  const fromName = mapData.territories[fromId].name, toName = mapData.territories[toId].name;
  const defenderId = game.owner[toId];
  const defenderName = game.players[defenderId].name;
  const fromCountBefore = game.armies[fromId], toCountBefore = game.armies[toId];
  let rounds = 0, attLoss = 0, defLoss = 0, captured = false, lastRes = null;
  if(allOut){
    // silent rounds, then one summary — same as the AI's battleBatch() in 05-ai.js
    while(game.armies[fromId]>=2 && canAttack(fromId, toId, p.id)){
      lastRes = doBattle(fromId, toId, {silent:true});
      rounds++; attLoss += lastRes.attLoss; defLoss += lastRes.defLoss;
      if(lastRes.captured){ captured = true; break; }
    }
    const roundsLabel = rounds>1 ? ` (${rounds} hiệp)` : '';
    logMsg('attack', `${p.name} tấn công ${toName} từ ${fromName}${roundsLabel}: mất ${attLoss}, đối phương mất ${defLoss}.`, [p.id, defenderId]);
    host.showDice(lastRes.ad, lastRes.dd, lastRes.results);
    if(captured) logMsg('capture', `${p.name} chiếm được ${toName}!`, [p.id, defenderId]);
  } else {
    lastRes = doBattle(fromId, toId);
    rounds = 1; attLoss = lastRes.attLoss; defLoss = lastRes.defLoss; captured = lastRes.captured;
  }
  recordBattleStat(p.name, defenderName, fromName, toName, attLoss+defLoss);
  // Captured with armies to spare: the player may send more in (moveAfterCapture) until their
  // next action. The rule's minimum has already moved (see doBattle()).
  const extraMax = captured && !game.over ? lastRes.maxMovable-lastRes.moving : 0;
  game.pendingCapture = extraMax>0 ? {from:fromId, to:toId} : null;
  // Eliminating someone hands over their cards — a hand of 5+ has to be traded down right away.
  const mustTrade = !game.over && p.cards.length>=FORCED_TRADE_HAND;
  if(mustTrade) bounceToForcedTrade();
  return {
    fromId, toId, defenderId, rounds, attLoss, defLoss, captured,
    fromCountBefore, toCountBefore, fromCountAfter: game.armies[fromId], toCountAfter: game.armies[toId],
    moved: captured ? lastRes.moving : 0, extraMax: mustTrade ? 0 : extraMax, mustTrade, over: game.over,
  };
}

function applyAction(pid, action){
  const res = runAction(pid, action);
  // The chance to send more armies into a captured territory lapses with the next move made
  // (a refused action changes nothing at all, this included).
  if(res.ok && action.type!=='attack' && action.type!=='moveAfterCapture' && game.pendingCapture) game.pendingCapture = null;
  return res;
}
function runAction(pid, action){
  const fail = error=> ({ok:false, error});
  if(!game || game.over) return fail('game_over');
  if(!action || typeof action.type!=='string') return fail('bad_action');
  if(currentPlayerId()!==pid) return fail('not_your_turn');
  const p = game.players[pid];
  if(!p || !p.isHuman || !p.alive) return fail('not_your_turn');

  switch(action.type){
    case 'place': {
      const terrId = action.terrId;
      if(!isTerritoryId(terrId) || game.owner[terrId]!==pid) return fail('not_your_territory');
      if(game.phase==='setup-place'){
        if(game.pool[pid]<=0) return fail('nothing_to_place');
        attemptSetupPlacement(terrId);
        return {ok:true, result:{}};
      }
      if(game.phase!=='reinforce') return fail('wrong_phase');
      if(p.cards.length>=FORCED_TRADE_HAND) return fail('must_trade_first');
      if(game.reinforceRemaining<=0) return fail('nothing_to_place');
      placeReinforcement(terrId);
      return {ok:true, result:{}};
    }
    case 'trade': {
      if(game.phase!=='reinforce') return fail('wrong_phase');
      const idx = action.cards;
      if(!Array.isArray(idx) || idx.length!==3 || new Set(idx).size!==3 ||
         !idx.every(i=> Number.isInteger(i) && i>=0 && i<p.cards.length)) return fail('bad_cards');
      const kinds = new Set(idx.map(i=>p.cards[i])).size;
      if(kinds!==1 && kinds!==3) return fail('bad_cards');
      const before = game.reinforceRemaining;
      tradeCards(p, idx);
      return {ok:true, result:{armies: game.reinforceRemaining-before, mustTrade: p.cards.length>=FORCED_TRADE_HAND}};
    }
    case 'attack': {
      if(game.phase!=='attack') return fail('wrong_phase');
      const {from, to} = action;
      if(!isTerritoryId(from) || !isTerritoryId(to) || !canAttack(from, to, pid)) return fail('illegal_attack');
      return {ok:true, result: performAttack(p, from, to, !!action.allOut)};
    }
    case 'moveAfterCapture': {
      const pc = game.pendingCapture;
      if(game.phase!=='attack' || !pc) return fail('nothing_to_move');
      const count = action.count;
      if(!Number.isInteger(count) || count<0 || count>game.armies[pc.from]-1) return fail('bad_count');
      game.armies[pc.from] -= count; game.armies[pc.to] += count;
      game.pendingCapture = null;
      host.renderGame();
      return {ok:true, result:{from:pc.from, to:pc.to, count}};
    }
    case 'endAttack': {
      if(game.phase!=='attack') return fail('wrong_phase');
      if(p.cards.length>=FORCED_TRADE_HAND){
        bounceToForcedTrade();
        host.renderGame();
        return {ok:true, result:{mustTrade:true}};
      }
      beginFortifyPhase();
      return {ok:true, result:{mustTrade:false}};
    }
    case 'fortify': {
      if(game.phase!=='fortify') return fail('wrong_phase');
      const {from, to, count} = action;
      if(!isTerritoryId(from) || !isTerritoryId(to) || from===to ||
         game.owner[from]!==pid || game.owner[to]!==pid || !pathExistsOwned(from, to, pid)) return fail('illegal_fortify');
      if(!Number.isInteger(count) || count<1 || count>game.armies[from]-1) return fail('bad_count');
      game.armies[from] -= count; game.armies[to] += count;
      logMsg('info', p.name+' chuyển '+count+' quân từ '+mapData.territories[from].name+' sang '+mapData.territories[to].name+'.', pid);
      host.renderGame();
      return {ok:true, result:{from, to, count}};
    }
    case 'endTurn': {
      if(game.phase!=='fortify') return fail('wrong_phase');
      endTurn();
      return {ok:true, result:{}};
    }
  }
  return fail('bad_action');
}
