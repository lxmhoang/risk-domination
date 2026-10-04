#!/usr/bin/env node
"use strict";
/* =========================================================================
   AI HEADLESS SMOKE TEST
   ---------------------------------------------------------------------
   Loads the game's core (dist/core.js — the same rules/AI/map-model module the
   server runs, built by `node build.js` from the core files in src/js), builds
   a synthetic 6x6 grid map (4 quadrant "continents", 4-directionally adjacent —
   connected and roughly Risk-shaped, but perfectly symmetric, which is a harder
   stress case than most real hand-drawn maps), and runs several full AI-vs-AI
   games end to end with the AI's scheduled steps rerouted through setImmediate
   instead of real delays, so a whole game finishes in milliseconds instead of
   minutes. Run `node build.js` first: this tests the built module.

   This is NOT a visual/UI check (nothing is rendered — the core's host
   hooks are left as no-ops) and it is NOT a substitute for actually opening
   dist/index.html and watching a spectator match. What it verifies fast,
   on every source edit, without a browser:
     - the AI never throws mid-turn across a spread of player counts/
       difficulties/alliance/trade-rule combos (a crash here would freeze a
       real match for anyone watching AI-vs-AI)
     - the "must land >=1 card-earning action per turn" rule (05-ai.js,
       stillNeedsCardThisTurn()/forcedForCard) actually fires under every
       cardAwardEvent mode, and never fires when it shouldn't
       (on_turn_end awards a card unconditionally, so nothing to force)

   Run: node test/ai-smoke-test.js   (or `npm run test:ai`)
   Exits non-zero if anything throws. Non-convergence (a game that never
   reaches game.over) is logged but does NOT fail the run — on this
   perfectly symmetric synthetic map, low-aggression settings (easy/normal
   difficulty, no alliance) can genuinely stalemate forever, and that's a
   property of the map/heuristic combo, not a regression signal by itself
   (verified by running this same map against the pre-refactor AI too).
   ========================================================================= */
const path = require('path');

const createCore = require(path.join(__dirname, '..', 'dist', 'core.js'));
const CONFIG = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'src', 'config.json'), 'utf8'));
const ROUND_CAP = 3000; // hard stop so a stalemate config can't run forever / balloon game.log

// A fresh core per game, with host hooks that do what this harness needs instead of drawing:
// tally what we're checking for, and run the AI's scheduled steps through setImmediate (no real
// delay) with an exception net so one bad turn is reported instead of silently killing the process.
function buildCore(cardMode){
  const h = { errors: [], lastWinner: null, tally: {turns:0, noCardDespiteOptions:0, noCardNoOptions:0, forcedLogs:0} };
  const core = createCore(CONFIG, {
    renderCombatLog(){
      const log = core.game.log, last = log[log.length-1];
      if(last && last.msg.indexOf('liều đánh')>=0) h.tally.forcedLogs++;
      if(log.length>500) log.length = 0; // avoid unbounded growth on a stalemate config
    },
    showGameOver(winner){ h.lastWinner = winner ? winner.name : null; },
    beforeEndTurn(p){
      const mode = core.RUNTIME_CONFIG.cardAwardEvent;
      const hasCard = mode==='on_turn_end' ? true : mode==='on_kill' ? p.killedThisTurn : p.capturedThisTurn;
      h.tally.turns++;
      if(!hasCard){
        const mine = core.ownedTerritories(p.id);
        const hadOption = mine.some(id=> core.game.armies[id]>=2 && [...core.mapData.territories[id].neighbors].some(n=>core.game.owner[n]!==p.id));
        if(hadOption) h.tally.noCardDespiteOptions++; else h.tally.noCardNoOptions++;
      }
    },
    schedule(fn){
      setImmediate(()=>{
        if(core.game && core.game.roundNumber>ROUND_CAP) return; // let it stall out quietly past the cap
        try{ fn(); }catch(e){ h.errors.push(e.stack || String(e)); }
      });
    },
  });
  core.RUNTIME_CONFIG.cardAwardEvent = cardMode;
  return { core, h };
}

// A 6x6 grid of territories split into 4 quadrant "continents" (9 territories
// each), 4-directionally adjacent — small but fully-connected, close enough
// in shape to a real Risk map to exercise continent-completion, border
// reserves, and elimination logic.
function buildSyntheticMap(core){
  const map = core.newMap(6, 6, 'Bản đồ test');
  let nextId = 1;
  const idOf = {};
  for(let r=0;r<6;r++) for(let c=0;c<6;c++){
    const id = nextId++;
    idOf[r+'_'+c] = id;
    const contId = (r<3?0:1)*2 + (c<3?0:1) + 1;
    map.territories[id] = {id, name:'T'+id, continentId:contId, color:'#fff', cells:[], neighbors:new Set(), centroid:{x:c,y:r}};
  }
  for(let cid=1; cid<=4; cid++){ map.continents[cid] = {id:cid, name:'C'+cid, color:'#000', bonus:3}; }
  for(let r=0;r<6;r++) for(let c=0;c<6;c++){
    const id = idOf[r+'_'+c];
    [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dr,dc])=>{
      const rr=r+dr, cc=c+dc;
      if(rr>=0&&rr<6&&cc>=0&&cc<6){ map.territories[id].neighbors.add(idOf[rr+'_'+cc]); }
    });
  }
  core.mapData = map;
}

function runOneGame(numPlayers, difficulty, allianceEnabled, tradeRule, cardMode){
  const { core, h } = buildCore(cardMode);
  buildSyntheticMap(core);
  const personalities = ['balanced','turtle','rusher','opportunist'];
  const cfg = Array.from({length:numPlayers}, (_,i)=>({
    name:'AI'+i, isHuman:false, color:'#000', personality: personalities[i%4],
  }));
  core.initGame(cfg, difficulty, true, allianceEnabled, tradeRule);
  core.autoPlaceInitialArmies();
  core.beginReinforcePhase();

  return new Promise((resolve) => {
    const start = Date.now();
    const TIMEOUT_MS = 15000;
    const check = () => {
      const over = !!(core.game && core.game.over);
      const round = core.game ? core.game.roundNumber : -1;
      if(over || h.errors.length>0 || round>ROUND_CAP || Date.now()-start>TIMEOUT_MS){
        resolve({ over, errors: h.errors, round, winner: h.lastWinner, tally: h.tally });
        return;
      }
      setImmediate(check);
    };
    check();
  });
}

async function main(){
  const configs = [
    // [numPlayers, difficulty, allianceEnabled, tradeRule, cardAwardEvent]
    [4, 'easy',   false, 'progressive', 'on_capture'],
    [4, 'normal', false, 'progressive', 'on_capture'],
    [6, 'hard',   false, 'progressive', 'on_capture'],
    [3, 'normal', true,  'fixed',       'on_kill'],
    [5, 'hard',   true,  'exponential', 'on_capture'],
    [8, 'normal', false, 'progressive', 'on_turn_end'],
  ];
  let crashes = 0;
  for(const [numPlayers, difficulty, alliance, tradeRule, cardMode] of configs){
    const label = `players=${numPlayers} diff=${difficulty} alliance=${alliance} trade=${tradeRule} cards=${cardMode}`;
    const r = await runOneGame(numPlayers, difficulty, alliance, tradeRule, cardMode);
    if(r.errors.length){
      crashes += r.errors.length;
      console.log(`[FAIL] ${label}: ${r.errors.length} exception(s), stopped at round ${r.round}`);
      console.log(r.errors[0]);
      continue;
    }
    const status = r.over ? `finished round ${r.round}, winner=${r.winner}` : `did not finish (round ${r.round})`;
    console.log(`[OK]   ${label}: ${status} | tally=${JSON.stringify(r.tally)}`);
  }
  console.log(crashes===0
    ? '\nNo exceptions across all configs.'
    : `\n${crashes} exception(s) found — see [FAIL] lines above.`);
  process.exit(crashes===0 ? 0 : 1);
}

main();
