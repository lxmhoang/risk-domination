"use strict";
/* =========================================================================
   GAME ENGINE — the shared core (../dist/core.js), driven by the server
   ---------------------------------------------------------------------
   The core keeps the current game in module-level variables, so this wraps it
   in two synchronous functions that each load a game, do one thing, and hand
   the new state back:

     createGame(options)             -> { map, state, view, events }
     applyAction(game, action)       -> { ok:false, error } | { ok:true, result, state, view, events }

   Nothing here awaits, so one engine can serve every game in the process.

   `state` is the whole game, kept on the server. `view` is what the player is
   allowed to see of it (no random-generator state, no other players' cards).
   `events` is everything that happened, in order, for the client to play back
   exactly as the offline game would have shown it — AI turns included, since
   the AI's scheduled steps are run here to the end instead of on timers.
   ========================================================================= */
const crypto = require('crypto');
const path = require('path');
const createCore = require(path.join(__dirname, '..', 'dist', 'core.js'));

const HUMAN = 0;              // the player's seat; every other seat is an AI
const MAX_AI_STEPS = 100000;  // far beyond any real run of AI turns
const LOG_KEEP = 200;         // log lines kept in the stored state

const DIFFICULTIES = ['easy', 'normal', 'hard'];
const TRADE_RULES = ['fixed', 'progressive', 'exponential'];

function makeEngine(defaultConfig, secret){
  let events = [];
  let lastView = null;      // view at the previous event, to send only what changed since
  const queue = [];

  // What changed in the view since the last event, as {key: newValue} (owner/armies per territory).
  function takePatch(){
    const now = viewOf(core.game);
    const patch = {};
    for(const k of Object.keys(now)){
      if(k==='owner' || k==='armies'){
        const d = {};
        for(const id of Object.keys(now[k])) if(!lastView || lastView[k][id]!==now[k][id]) d[id] = now[k][id];
        if(Object.keys(d).length) patch[k] = d;
      } else if(!lastView || JSON.stringify(lastView[k])!==JSON.stringify(now[k])) patch[k] = now[k];
    }
    lastView = now;
    return Object.keys(patch).length ? patch : undefined;
  }
  function emit(ev){ const patch = takePatch(); if(patch) ev.patch = patch; events.push(ev); }

  const core = createCore(defaultConfig, {
    renderGame(){ emit({t:'render'}); },
    renderCombatLog(){ const log = core.game.log; emit({t:'log', entry: log[log.length-1]}); },
    setActionHint(msg){ emit({t:'hint', msg}); },
    showDice(ad, dd, results){ emit({t:'dice', ad, dd, results}); },
    showTurnIntro(p){ emit({t:'turn', pid:p.id}); },
    openCardsModal(forced){ emit({t:'cards', forced:!!forced}); },
    showGameOver(winner){ emit({t:'over', winnerId: winner ? winner.id : null}); },
    startAttackAnim(info, onDone){ emit({t:'anim', info}); if(onDone) onDone(); },
    // an AI step the offline game would run after `ms`: the client waits, the server doesn't
    schedule(fn, ms){ emit({t:'wait', ms: Math.max(0, Math.round(ms)||0)}); queue.push(fn); },
  });

  // What the player may see. The log travels as events, not in the view.
  // A copy, detached from the live game object.
  function viewOf(g){
    const {rng, seed, startSnapshot, log, players, ...rest} = g;
    return JSON.parse(JSON.stringify({
      ...rest,
      players: players.map(p=> p.id===HUMAN ? p : {...p, cards: p.cards.map(()=> '?')}),
    }));
  }

  function begin(){ events = []; queue.length = 0; lastView = core.game ? viewOf(core.game) : null; }
  function runAI(){
    let n = 0;
    while(queue.length){
      if(n++ > MAX_AI_STEPS) throw new Error('AI did not finish its turn');
      queue.shift()();
    }
  }
  // A fresh, unpredictable generator state for each request. Derived from a server-side secret,
  // so the rolls a player has already seen say nothing about the next ones — and the same
  // game replays identically from its action log by anyone holding the secret.
  function reseed(gameSeed, version){
    const h = crypto.createHmac('sha256', secret).update(String(gameSeed)+':'+version).digest('hex');
    core.game.rng = core.seedRng(h);
  }
  function finish(){
    const g = core.game;
    if(g.log.length>LOG_KEEP) g.log.splice(0, g.log.length-LOG_KEEP);
    const tail = takePatch(); // anything that changed after the last hook fired
    if(tail) events.push({t:'render', patch:tail});
    const out = { state: JSON.stringify(g), view: viewOf(g), events, over: !!g.over };
    core.game = null; core.mapData = null;
    events = [];
    return out;
  }

  function validateOptions(o){
    if(!o || typeof o!=='object') return 'bad_options';
    if(!DIFFICULTIES.includes(o.difficulty)) return 'bad_difficulty';
    if(!TRADE_RULES.includes(o.tradeRule)) return 'bad_trade_rule';
    if(typeof o.alliance!=='boolean' || typeof o.globalMap!=='boolean') return 'bad_options';
    if(!Array.isArray(o.players) || o.players.length<2 || o.players.length>6) return 'bad_players';
    const colors = new Set();
    for(const p of o.players){
      if(!p || typeof p.name!=='string' || !p.name.trim() || p.name.length>24) return 'bad_player_name';
      if(/[<>&"'`]/.test(p.name)) return 'bad_player_name';
      if(typeof p.color!=='string' || !/^#[0-9a-fA-F]{6}$/.test(p.color) || colors.has(p.color.toLowerCase())) return 'bad_player_color';
      colors.add(p.color.toLowerCase());
      if(!Object.prototype.hasOwnProperty.call(core.AI_PERSONALITIES, p.personality)) return 'bad_personality';
    }
    return null;
  }

  // options: {players:[{name,color,personality}], difficulty, tradeRule, alliance, globalMap}
  // (players[0] is the human). Returns {error} or {map, state, view, events, seed, mapSeed}.
  function createGame(options, config){
    const error = validateOptions(options);
    if(error) return {error};
    core.RUNTIME_CONFIG = Object.assign({}, defaultConfig, config||{});
    const mapSeed = crypto.randomBytes(16).toString('hex');
    const seed = crypto.randomBytes(16).toString('hex');
    const plan = core.computeMapGenPlan(options.globalMap);
    const map = core.generateSeededMap(mapSeed, plan.cols, plan.rows, plan.numTerr, plan.numCont);
    map.wrapX = options.globalMap;
    core.recomputeGraph(map);
    core.mapData = map;
    core.spectatorMode = false;
    const playerConfigs = options.players.map((p,i)=>({
      name: p.name.trim(), color: p.color, personality: p.personality, isHuman: i===HUMAN,
    }));
    core.game = null;
    begin();
    core.initGame(playerConfigs, options.difficulty, false, options.alliance, options.tradeRule, seed);
    reseed(seed, 0);
    core.autoPlaceInitialArmies();
    core.beginReinforcePhase();
    runAI(); // any AIs ahead of the human in the turn order
    const mapPlain = core.mapToPlainObject(map);
    return { map: mapPlain, seed, mapSeed, ...finish() };
  }

  // game: {map (plain object), state (JSON string), version, config}
  function applyAction(game, action){
    core.RUNTIME_CONFIG = Object.assign({}, defaultConfig, game.config||{});
    core.mapData = core.mapFromPlainObject(game.map);
    core.game = JSON.parse(game.state);
    core.spectatorMode = false;
    begin();
    reseed(core.game.seed, game.version+1);
    const res = core.applyAction(HUMAN, action);
    if(!res.ok){ core.game = null; core.mapData = null; return res; }
    runAI(); // e.g. endTurn: every AI plays until it is the human's move again
    return { ok:true, result:res.result, ...finish() };
  }

  // The view of a stored game, for resuming it.
  function viewOfState(state){ return viewOf(JSON.parse(state)); }

  return { createGame, applyAction, viewOfState, core };
}

module.exports = { makeEngine, HUMAN };
