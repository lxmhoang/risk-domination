#!/usr/bin/env node
"use strict";
/* =========================================================================
   DETERMINISM TEST
   ---------------------------------------------------------------------
   Everything random in the core follows from a seed (see random() in
   src/js/00-core-utils.js). This checks that it really does:
     - the same map seed gives the same generated map, a different one doesn't;
     - the same game seed gives the same full AI-vs-AI game (every army,
       owner, card and log line), a different one doesn't.
   The server relies on this to replay a game from its action log.

   Run: node test/determinism-test.js   (after `node build.js`)
   ========================================================================= */
const path = require('path');
const assert = require('assert');
const createCore = require(path.join(__dirname, '..', 'dist', 'core.js'));
const CONFIG = require(path.join(__dirname, '..', 'src', 'config.json'));

// Runs the AI's scheduled steps one after another with no waiting, until nothing is left.
function makeCore(){
  const queue = [];
  const core = createCore(CONFIG, { schedule(fn){ queue.push(fn); } });
  core.drain = (maxSteps)=>{ let n = 0; while(queue.length && n++ < maxSteps) queue.shift()(); return n; };
  return core;
}

function mapFingerprint(core, map){ return JSON.stringify(core.mapToPlainObject(map)); }

function playGame(mapSeed, gameSeed){
  const core = makeCore();
  const plan = core.computeMapGenPlan(true);
  core.mapData = core.generateSeededMap(mapSeed, plan.cols, plan.rows, plan.numTerr, plan.numCont);
  const personalities = ['balanced','turtle','rusher','opportunist'];
  const cfg = Array.from({length:4}, (_,i)=>({ name:'AI'+i, isHuman:false, color:'#000', personality:personalities[i] }));
  core.initGame(cfg, 'hard', true, true, 'progressive', gameSeed);
  core.autoPlaceInitialArmies();
  core.beginReinforcePhase();
  core.drain(200000);
  return { map: mapFingerprint(core, core.mapData), state: JSON.stringify(core.game), over: core.game.over, round: core.game.roundNumber };
}

const a = playGame(111, 'game-seed-1');
const b = playGame(111, 'game-seed-1');
const c = playGame(111, 'game-seed-2');
const d = playGame(222, 'game-seed-1');

assert.ok(a.over, 'the seeded game should finish');
assert.strictEqual(a.map, b.map, 'same map seed must give the same map');
assert.strictEqual(a.state, b.state, 'same seeds must give the same game');
assert.notStrictEqual(a.map, d.map, 'a different map seed should give a different map');
assert.notStrictEqual(a.state, c.state, 'a different game seed should give a different game');

// host.random takes over from the seeded generator when set
const core = createCore(CONFIG, { random: ()=> 0 });
assert.strictEqual(core.rollDie(), 1, 'host.random should drive rollDie');

console.log(`Deterministic: same seeds -> identical map and game (finished in round ${a.round}); different seeds differ.`);
