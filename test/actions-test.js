#!/usr/bin/env node
"use strict";
/* =========================================================================
   ACTIONS TEST
   ---------------------------------------------------------------------
   applyAction() (src/js/04b-actions.js) is the only way a player changes a
   game, and on the server it is the only thing standing between a tampered
   client and the game state. This plays a human seat through real turns and
   checks that legal moves work and every illegal one is refused without
   changing anything.

   Run: node test/actions-test.js   (after `node build.js`)
   ========================================================================= */
const path = require('path');
const assert = require('assert');
const createCore = require(path.join(__dirname, '..', 'dist', 'core.js'));
const CONFIG = require(path.join(__dirname, '..', 'src', 'config.json'));

function newGame(seed){
  const queue = [];
  const core = createCore(CONFIG, { schedule(fn){ queue.push(fn); } });
  // AI turns run to completion; stops as soon as it's the human's move (or the game ends)
  core.drain = ()=>{ let n = 0; while(queue.length && n++ < 100000) queue.shift()(); };
  const plan = core.computeMapGenPlan(true);
  core.mapData = core.generateSeededMap('map-'+seed, plan.cols, plan.rows, plan.numTerr, plan.numCont);
  const cfg = [{name:'Bạn', isHuman:true, color:'#f00', personality:'balanced'}]
    .concat(['turtle','rusher','opportunist'].map((pers,i)=>({name:'AI'+i, isHuman:false, color:'#000', personality:pers})));
  core.initGame(cfg, 'normal', false, false, 'progressive', 'game-'+seed);
  core.autoPlaceInitialArmies();
  core.beginReinforcePhase();
  core.drain();
  return core;
}
const snapshot = core=> JSON.stringify(core.game);
const mine = core=> core.ownedTerritories(0);
const enemyNeighbors = (core, id)=> [...core.mapData.territories[id].neighbors].filter(n=> core.game.owner[n]!==0);

// A refused action must leave the game exactly as it was.
function refuse(core, pid, action, error){
  const before = snapshot(core);
  const res = core.applyAction(pid, action);
  assert.deepStrictEqual(res, {ok:false, error}, JSON.stringify(action)+' -> '+JSON.stringify(res));
  assert.ok(snapshot(core)===before, 'refused action changed the game: '+JSON.stringify(action));
}
function accept(core, action){
  const res = core.applyAction(0, action);
  assert.ok(res.ok, JSON.stringify(action)+' -> '+JSON.stringify(res));
  return res.result;
}

let checks = 0;
for(const seed of [1, 2, 3]){
  const core = newGame(seed);
  const g = ()=> core.game;
  assert.strictEqual(core.currentPlayerId(), 0, 'human to move after the AIs before them');
  assert.strictEqual(g().phase, 'reinforce');

  // ---- garbage and out-of-turn ----
  refuse(core, 0, null, 'bad_action');
  refuse(core, 0, {}, 'bad_action');
  refuse(core, 0, {type:'nope'}, 'bad_action');
  refuse(core, 1, {type:'endTurn'}, 'not_your_turn');     // an AI's seat
  refuse(core, 99, {type:'endTurn'}, 'not_your_turn');

  // ---- reinforce ----
  const enemyTerr = Object.keys(g().owner).map(Number).find(id=> g().owner[id]!==0);
  refuse(core, 0, {type:'place', terrId:enemyTerr}, 'not_your_territory');
  refuse(core, 0, {type:'place', terrId:'1'}, 'not_your_territory');
  refuse(core, 0, {type:'place', terrId:-5}, 'not_your_territory');
  refuse(core, 0, {type:'attack', from:mine(core)[0], to:enemyTerr}, 'wrong_phase');
  refuse(core, 0, {type:'endAttack'}, 'wrong_phase');
  refuse(core, 0, {type:'endTurn'}, 'wrong_phase');
  refuse(core, 0, {type:'fortify', from:1, to:2, count:1}, 'wrong_phase');
  refuse(core, 0, {type:'trade', cards:[0,1,2]}, 'bad_cards');   // empty hand
  // put everything on the border territory with the weakest enemy neighbour
  const front = mine(core).filter(id=> enemyNeighbors(core,id).length)
    .sort((a,b)=> Math.min(...enemyNeighbors(core,a).map(n=>g().armies[n])) - Math.min(...enemyNeighbors(core,b).map(n=>g().armies[n])))[0];
  const total = ()=> Object.values(g().armies).reduce((s,n)=>s+n,0);
  const toPlace = g().reinforceRemaining, totalBefore = total();
  for(let i=0;i<toPlace;i++) accept(core, {type:'place', terrId:front});
  assert.strictEqual(total(), totalBefore+toPlace, 'placing adds exactly the reinforcements');
  assert.strictEqual(g().phase, 'attack', 'placing the last army moves on to attack');
  refuse(core, 0, {type:'place', terrId:front}, 'wrong_phase');

  // ---- attack ----
  const target = enemyNeighbors(core, front).sort((a,b)=> g().armies[a]-g().armies[b])[0];
  const notAdjacent = Object.keys(g().owner).map(Number).find(id=> g().owner[id]!==0 && !core.mapData.territories[front].neighbors.has(id));
  refuse(core, 0, {type:'attack', from:front, to:notAdjacent}, 'illegal_attack');
  refuse(core, 0, {type:'attack', from:target, to:front}, 'illegal_attack');         // not my territory
  refuse(core, 0, {type:'attack', from:front, to:front}, 'illegal_attack');
  refuse(core, 0, {type:'attack', from:front, to:999999}, 'illegal_attack');
  refuse(core, 0, {type:'moveAfterCapture', count:1}, 'nothing_to_move');
  const sumBefore = g().armies[front]+g().armies[target];
  const r1 = accept(core, {type:'attack', from:front, to:target});
  assert.strictEqual(r1.rounds, 1);
  assert.ok(r1.attLoss+r1.defLoss>=1 && r1.attLoss+r1.defLoss<=2, 'one round loses 1 or 2 armies');
  assert.strictEqual(g().armies[front]+g().armies[target], sumBefore-r1.attLoss-r1.defLoss);
  if(!r1.captured && g().armies[front]>=2){
    const r2 = accept(core, {type:'attack', from:front, to:target, allOut:true});
    assert.ok(r2.captured || g().armies[front]===1, 'all-out ends with a capture or a spent source');
    if(r2.captured){
      assert.strictEqual(g().owner[target], 0);
      if(r2.extraMax>0){
        refuse(core, 0, {type:'moveAfterCapture', count:r2.extraMax+1}, 'bad_count');
        refuse(core, 0, {type:'moveAfterCapture', count:-1}, 'bad_count');
        refuse(core, 0, {type:'moveAfterCapture', count:0.5}, 'bad_count');
        const before = g().armies[target];
        accept(core, {type:'moveAfterCapture', count:r2.extraMax});
        assert.strictEqual(g().armies[target], before+r2.extraMax);
        assert.strictEqual(g().armies[front], 1);
        refuse(core, 0, {type:'moveAfterCapture', count:0}, 'nothing_to_move'); // only once
      }
    }
  }
  assert.ok(Object.values(g().armies).every(n=> n>=1), 'no territory is ever left empty');

  // ---- fortify ----
  accept(core, {type:'endAttack'});
  assert.strictEqual(g().phase, 'fortify');
  refuse(core, 0, {type:'attack', from:front, to:target}, 'wrong_phase');
  const src = mine(core).find(id=> g().armies[id]>=2 && [...core.mapData.territories[id].neighbors].some(n=> g().owner[n]===0));
  if(src!=null){
    const dst = [...core.mapData.territories[src].neighbors].find(n=> g().owner[n]===0);
    refuse(core, 0, {type:'fortify', from:src, to:dst, count:g().armies[src]}, 'bad_count'); // must leave 1 behind
    refuse(core, 0, {type:'fortify', from:src, to:dst, count:0}, 'bad_count');
    refuse(core, 0, {type:'fortify', from:src, to:src, count:1}, 'illegal_fortify');
    refuse(core, 0, {type:'fortify', from:src, to:enemyTerr, count:1}, 'illegal_fortify');
    refuse(core, 0, {type:'fortify', from:enemyTerr, to:dst, count:1}, 'illegal_fortify');
    const s = g().armies[src], d = g().armies[dst];
    accept(core, {type:'fortify', from:src, to:dst, count:s-1});
    assert.deepStrictEqual([g().armies[src], g().armies[dst]], [1, d+s-1]);
  }

  // ---- end turn: the AIs play, then it is the human's move again (or the game is over) ----
  const round = g().roundNumber;
  accept(core, {type:'endTurn'});
  refuse(core, 0, {type:'endTurn'}, 'not_your_turn');   // AIs haven't moved yet
  core.drain();
  if(!g().over && g().players[0].alive){
    assert.strictEqual(core.currentPlayerId(), 0);
    assert.strictEqual(g().phase, 'reinforce');
    assert.strictEqual(g().roundNumber, round+1);
  }

  // ---- forced card trade: 5 cards in hand blocks placing until traded down ----
  if(!g().over && g().players[0].alive){
    const p = g().players[0];
    p.cards = ['infantry','infantry','cavalry','artillery','infantry'];
    refuse(core, 0, {type:'place', terrId:mine(core)[0]}, 'must_trade_first');
    refuse(core, 0, {type:'trade', cards:[0,1,2]}, 'bad_cards');      // two alike + one other
    refuse(core, 0, {type:'trade', cards:[0,0,1]}, 'bad_cards');
    refuse(core, 0, {type:'trade', cards:[0,1,7]}, 'bad_cards');
    refuse(core, 0, {type:'trade', cards:[0,1]}, 'bad_cards');
    const remaining = g().reinforceRemaining;
    const t = accept(core, {type:'trade', cards:[0,1,4]});            // three infantry
    assert.ok(t.armies>0 && g().reinforceRemaining===remaining+t.armies);
    assert.deepStrictEqual(p.cards, ['cavalry','artillery']);
    accept(core, {type:'place', terrId:mine(core)[0]});
  }

  // ---- a finished game accepts nothing ----
  g().over = true;
  refuse(core, 0, {type:'endTurn'}, 'game_over');
  checks++;
}
console.log(`Actions: legal moves applied, illegal ones refused without side effects (${checks} games).`);
