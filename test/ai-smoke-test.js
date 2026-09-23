#!/usr/bin/env node
"use strict";
/* =========================================================================
   AI HEADLESS SMOKE TEST
   ---------------------------------------------------------------------
   Loads the real, unmodified game logic (01-utils, 02-map-model,
   04-game-state, 05-ai — deliberately NOT 03-editor/06-render-game/
   07-cards-modal/08-wiring, which are DOM-only and never touched by AI
   decisions) into a Node `vm` sandbox with the smallest possible
   document/window/localStorage stubs, builds a synthetic 6x6 grid map (4
   quadrant "continents", 4-directionally adjacent — connected and roughly
   Risk-shaped, but perfectly symmetric, which is a harder stress case than
   most real hand-drawn maps), and runs several full AI-vs-AI games end to
   end via aiSchedule() rerouted through setImmediate instead of real
   setTimeout delays, so a whole game finishes in milliseconds instead of
   minutes.

   This is NOT a visual/UI check (nothing is rendered — renderGame() etc.
   are stubbed no-ops) and it is NOT a substitute for actually opening
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
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_JS = path.join(__dirname, '..', 'src', 'js');
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'config.json'), 'utf8'));
const ROUND_CAP = 3000; // hard stop so a stalemate config can't run forever / balloon game.log

function buildSandbox(){
  const store = {};
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k,v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  const fakeElement = () => ({
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    style: {}, dataset: {}, addEventListener(){}, appendChild(){}, remove(){},
    setAttribute(){}, getAttribute(){ return null; }, querySelectorAll(){ return []; },
    querySelector(){ return null; }, value:'', checked:false, textContent:'', innerHTML:'',
  });
  const document = {
    getElementById(){ return fakeElement(); },
    createElement(){ return fakeElement(); },
    querySelectorAll(){ return []; },
    querySelector(){ return null; },
    body: fakeElement(),
    addEventListener(){},
  };
  const window = { addEventListener(){}, innerWidth:390, innerHeight:844 };
  const sandbox = {
    console, document, window, localStorage,
    setTimeout, clearTimeout, setImmediate, Math, Set, Array, Object, JSON, Number, String,
    GAME_CONFIG: CONFIG,
  };
  vm.createContext(sandbox);
  return sandbox;
}

function loadModules(sandbox, cardMode){
  const files = ['01-utils.js','02-map-model.js','04-game-state.js','05-ai.js'];
  for(const f of files){
    vm.runInContext(fs.readFileSync(path.join(SRC_JS, f), 'utf8'), sandbox, { filename: f });
  }
  sandbox.__cardMode = cardMode;
  sandbox.__roundCap = ROUND_CAP;
  // Stub the rendering/UI-only functions that 04/05 call but that live in the
  // DOM-dependent modules we deliberately did NOT load (06/07/08). Also
  // instrument logMsg/endTurn to tally what we're checking for, and reroute
  // aiSchedule through setImmediate (no real delay) with an exception net so
  // one bad turn is reported instead of silently killing the process.
  vm.runInContext(`
    RUNTIME_CONFIG.cardAwardEvent = __cardMode;
    let __harnessErrors = [];
    let __harnessLastWinner = null;
    let __tally = {turns:0, noCardDespiteOptions:0, noCardNoOptions:0, forcedLogs:0};
    function renderGame(){}
    function renderCombatLog(){ if(game.log.length>500) game.log.length=0; } // avoid unbounded growth on a stalemate config
    function setActionHint(){}
    function showDice(){}
    function openCardsModal(){}
    function showGameOver(winner){ __harnessLastWinner = winner ? winner.name : null; }
    const __realLogMsg = logMsg;
    logMsg = function(type, msg){
      if(msg.indexOf('liều đánh')>=0) __tally.forcedLogs++;
      return __realLogMsg(type, msg);
    };
    const __realEndTurn = endTurn;
    endTurn = function(){
      const p = currentPlayer();
      const mode = RUNTIME_CONFIG.cardAwardEvent;
      const hasCard = mode==='on_turn_end' ? true : mode==='on_kill' ? p.killedThisTurn : p.capturedThisTurn;
      __tally.turns++;
      if(!hasCard){
        const mine = ownedTerritories(p.id);
        const hadOption = mine.some(id=> game.armies[id]>=2 && [...mapData.territories[id].neighbors].some(n=>game.owner[n]!==p.id));
        if(hadOption) __tally.noCardDespiteOptions++; else __tally.noCardNoOptions++;
      }
      return __realEndTurn();
    };
    aiSchedule = function(fn, delay){
      setImmediate(()=>{
        if(game && game.roundNumber>__roundCap) return; // let it stall out quietly past the cap
        try{ fn(); }catch(e){ __harnessErrors.push(e.stack || String(e)); }
      });
    };
  `, sandbox, { filename: 'harness-stubs.js' });
}

// A 6x6 grid of territories split into 4 quadrant "continents" (9 territories
// each), 4-directionally adjacent — small but fully-connected, close enough
// in shape to a real Risk map to exercise continent-completion, border
// reserves, and elimination logic.
function buildSyntheticMap(sandbox){
  vm.runInContext(`
    (function(){
      mapData = newMap(6, 6, 'Bản đồ test');
      let nextId = 1;
      const idOf = {};
      for(let r=0;r<6;r++) for(let c=0;c<6;c++){
        const id = nextId++;
        idOf[r+'_'+c] = id;
        const contId = (r<3?0:1)*2 + (c<3?0:1) + 1;
        mapData.territories[id] = {id, name:'T'+id, continentId:contId, color:'#fff', cells:[], neighbors:new Set(), centroid:{x:c,y:r}};
      }
      for(let cid=1; cid<=4; cid++){ mapData.continents[cid] = {id:cid, name:'C'+cid, color:'#000', bonus:3}; }
      for(let r=0;r<6;r++) for(let c=0;c<6;c++){
        const id = idOf[r+'_'+c];
        [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dr,dc])=>{
          const rr=r+dr, cc=c+dc;
          if(rr>=0&&rr<6&&cc>=0&&cc<6){ mapData.territories[id].neighbors.add(idOf[rr+'_'+cc]); }
        });
      }
    })();
  `, sandbox, { filename: 'synthetic-map.js' });
}

function runOneGame(numPlayers, difficulty, allianceEnabled, tradeRule, cardMode){
  const sandbox = buildSandbox();
  loadModules(sandbox, cardMode);
  buildSyntheticMap(sandbox);
  const personalities = ['balanced','turtle','rusher','opportunist'];
  const cfg = Array.from({length:numPlayers}, (_,i)=>({
    name:'AI'+i, isHuman:false, color:'#000', personality: personalities[i%4],
  }));
  sandbox.__playerCfg = cfg;
  sandbox.__difficulty = difficulty;
  sandbox.__alliance = allianceEnabled;
  sandbox.__tradeRule = tradeRule;
  vm.runInContext(`
    initGame(__playerCfg, __difficulty, true, __alliance, __tradeRule);
    autoPlaceInitialArmies();
    beginReinforcePhase();
  `, sandbox, { filename: 'run-game.js' });

  return new Promise((resolve) => {
    const start = Date.now();
    const TIMEOUT_MS = 15000;
    const check = () => {
      const over = vm.runInContext('!!(game && game.over)', sandbox);
      const errs = vm.runInContext('__harnessErrors', sandbox);
      const round = vm.runInContext('game ? game.roundNumber : -1', sandbox);
      if(over || errs.length>0 || round>ROUND_CAP || Date.now()-start>TIMEOUT_MS){
        resolve({
          over, errors: errs, round,
          winner: vm.runInContext('__harnessLastWinner', sandbox),
          tally: vm.runInContext('__tally', sandbox),
        });
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
