#!/usr/bin/env node
"use strict";
// Engine test: a whole game played through createGame()/applyAction() by a simple scripted
// player, checking the state/view/events contract along the way.
const assert = require('assert');
const path = require('path');
const { makeEngine } = require('../engine.js');
const CONFIG = require(path.join(__dirname, '..', '..', 'src', 'config.json'));

const engine = makeEngine(CONFIG, 'test-secret');
const options = {
  players: [
    {name:'Bạn', color:'#ef5b6b', personality:'balanced'},
    {name:'Caesar', color:'#5b8def', personality:'rusher'},
    {name:'Napoleon', color:'#4ac97e', personality:'turtle'},
  ],
  difficulty:'easy', tradeRule:'progressive', alliance:false, globalMap:true,
};

// ---- bad options are refused ----
for(const [bad, err] of [
  [{...options, difficulty:'god'}, 'bad_difficulty'],
  [{...options, tradeRule:'x'}, 'bad_trade_rule'],
  [{...options, players: options.players.slice(0,1)}, 'bad_players'],
  [{...options, players: Array(7).fill(options.players[0])}, 'bad_players'],
  [{...options, players: [{...options.players[0], name:'<b>x</b>'}, options.players[1]]}, 'bad_player_name'],
  [{...options, players: [options.players[0], {...options.players[1], color:'#ef5b6b'}]}, 'bad_player_color'],
  [{...options, players: [options.players[0], {...options.players[1], personality:'__proto__'}]}, 'bad_personality'],
  [{...options, alliance:'yes'}, 'bad_options'],
]) assert.strictEqual(engine.createGame(bad).error, err);

// ---- create ----
const t0 = Date.now();
const created = engine.createGame(options);
const createMs = Date.now()-t0;
assert.ok(!created.error && created.map && created.state && created.view);
let game = { map: created.map, state: created.state, version: 0, config: null };
let view = created.view;
assert.strictEqual(view.rng, undefined, 'generator state must never reach the client');
assert.strictEqual(view.seed, undefined);
assert.ok(!JSON.stringify(created.events).includes('"rng"'));
assert.strictEqual(view.turnOrder[view.turnIdx], 0, 'stops at the human\'s move');
assert.strictEqual(view.phase, 'reinforce');
assert.ok(created.events.some(e=> e.t==='turn'), 'events include turn intros');

// ---- the events' patches rebuild the view exactly ----
function applyPatches(base, events){
  const v = JSON.parse(JSON.stringify(base));
  for(const e of events){
    if(!e.patch) continue;
    for(const k of Object.keys(e.patch)){
      if(k==='owner' || k==='armies') Object.assign(v[k], e.patch[k]); else v[k] = e.patch[k];
    }
  }
  return v;
}

const terr = id=> game.map.territories.find(t=> t.id===id);
function neighborsOf(id){
  // rebuild adjacency from the stored map the same way the client would: through the core
  return [...engine.core.mapFromPlainObject(game.map).territories[id].neighbors];
}
const adjacency = {};
for(const t of game.map.territories) adjacency[t.id] = neighborsOf(t.id);

function act(action){
  const before = view;
  const res = engine.applyAction(game, action);
  if(!res.ok) return res;
  const rebuilt = applyPatches(before, res.events);
  const differing = [...new Set([...Object.keys(rebuilt), ...Object.keys(res.view)])].filter(k=> JSON.stringify(rebuilt[k])!==JSON.stringify(res.view[k]));
  assert.ok(differing.length===0, 'patches must add up to the new view ('+action.type+'): '+differing.join(',')+' '+differing.map(k=>JSON.stringify(rebuilt[k])+' vs '+JSON.stringify(res.view[k])).join(' | ').slice(0,300));
  game = { ...game, state: res.state, version: game.version+1 };
  view = res.view;
  return res;
}

// ---- refused actions change nothing and say why ----
assert.deepStrictEqual(engine.applyAction(game, {type:'endTurn'}), {ok:false, error:'wrong_phase'});
assert.deepStrictEqual(engine.applyAction(game, {type:'attack', from:1, to:2}), {ok:false, error:'wrong_phase'});

// ---- play: reinforce the strongest front, attack all-out while ahead, end turn ----
let turns = 0, maxActMs = 0, aiEvents = 0;
while(!view.over && view.players[0].alive && turns<400){
  const mine = Object.keys(view.owner).map(Number).filter(id=> view.owner[id]===0);
  if(view.phase==='reinforce'){
    const me = view.players[0];
    if(me.cards.length>=5 || (me.cards.length>=3 && view.reinforceRemaining===0)){
      // find any valid set of three
      let combo = null;
      for(let i=0;i<me.cards.length && !combo;i++) for(let j=i+1;j<me.cards.length && !combo;j++) for(let k=j+1;k<me.cards.length;k++){
        const n = new Set([me.cards[i],me.cards[j],me.cards[k]]).size; if(n===1||n===3){ combo=[i,j,k]; break; }
      }
      assert.ok(combo, 'a hand of 5 always holds a set');
      assert.ok(act({type:'trade', cards:combo}).ok);
      continue;
    }
    const front = mine.filter(id=> adjacency[id].some(n=> view.owner[n]!==0)).sort((a,b)=> view.armies[b]-view.armies[a])[0] || mine[0];
    assert.ok(act({type:'place', terrId:front}).ok);
    continue;
  }
  if(view.phase==='attack'){
    let best = null;
    for(const f of mine){ if(view.armies[f]<3) continue;
      for(const t of adjacency[f]){ if(view.owner[t]===0) continue;
        const sc = view.armies[f]-view.armies[t]; if(sc>=2 && (!best || sc>best.sc)) best = {f,t,sc}; } }
    if(best){
      const r = act({type:'attack', from:best.f, to:best.t, allOut:true});
      assert.ok(r.ok && r.result.rounds>=1);
      if(r.result.extraMax>0) assert.ok(act({type:'moveAfterCapture', count:r.result.extraMax}).ok);
      continue;
    }
    assert.ok(act({type:'endAttack'}).ok);
    continue;
  }
  if(view.phase==='fortify'){
    const t1 = Date.now();
    const r = act({type:'endTurn'});
    maxActMs = Math.max(maxActMs, Date.now()-t1);
    assert.ok(r.ok);
    aiEvents += r.events.length;
    assert.ok(view.over || !view.players[0].alive || (view.turnOrder[view.turnIdx]===0 && view.phase==='reinforce'), 'after endTurn the AIs have all moved');
    // other players' cards are never revealed
    view.players.slice(1).forEach(p=> assert.ok(p.cards.every(c=> c==='?')));
    turns++;
    continue;
  }
  assert.fail('unexpected phase '+view.phase);
}
assert.ok(view.over, 'the scripted player should finish the game against easy AIs (turns='+turns+')');
assert.deepStrictEqual(engine.applyAction(game, {type:'endTurn'}), {ok:false, error:'game_over'});
assert.ok(JSON.parse(game.state).log.length<=200, 'stored log stays bounded');
console.log(`Engine: full game in ${turns} turns (create ${createMs}ms, slowest AI round ${maxActMs}ms, ${aiEvents} AI-round events, state ${Math.round(game.state.length/1024)}KB, map ${Math.round(JSON.stringify(game.map).length/1024)}KB).`);
