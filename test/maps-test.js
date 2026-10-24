#!/usr/bin/env node
"use strict";
/* =========================================================================
   MAP GALLERY TEST
   ---------------------------------------------------------------------
   Every src/maps/*.json (the setup screen's gallery) must load and be playable: every territory
   has land and a continent, the whole map is one connected graph (sea lanes included), each
   continent is connected inside itself, links point at real territories, and a short AI game
   runs on it without throwing. Run `node build.js` first (this uses dist/core.js).
   ========================================================================= */
const fs = require('fs'), path = require('path');
const createCore = require(path.join(__dirname, '..', 'dist', 'core.js'));
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'config.json'), 'utf8'));
const MAPS_DIR = path.join(__dirname, '..', 'src', 'maps');

function check(file){
  const problems = [];
  const obj = JSON.parse(fs.readFileSync(path.join(MAPS_DIR, file), 'utf8'));
  const errors = [];
  const core = createCore(CONFIG, {
    schedule(fn){ setImmediate(()=>{ if(core.game && core.game.roundNumber>150) return; try{ fn(); }catch(e){ errors.push(e.stack||String(e)); } }); },
  });
  const map = core.mapFromPlainObject(obj);
  core.mapData = map;
  const terrs = Object.values(map.territories);
  if(obj.cellTerritory.length!==obj.cols*obj.rows) problems.push('cellTerritory length != cols*rows');
  terrs.forEach(t=>{
    if(t.cells.length===0) problems.push(`${t.name}: no cells`);
    if(!map.continents[t.continentId]) problems.push(`${t.name}: no continent`);
  });
  (obj.links||[]).forEach(l=>{ if(!map.territories[l[0]] || !map.territories[l[1]]) problems.push('link to a missing territory: '+l); });
  const comps = core.findConnectedComponents(map);
  if(comps.length!==1) problems.push(`graph has ${comps.length} components (${comps.map(c=>c.length)})`);
  Object.values(map.continents).forEach(c=>{
    const ids = terrs.filter(t=>t.continentId===c.id).map(t=>t.id);
    if(ids.length===0){ problems.push(`${c.name}: empty continent`); return; }
    const seen = new Set([ids[0]]), stack = [ids[0]];
    while(stack.length){ const x = stack.pop(); map.territories[x].neighbors.forEach(n=>{ if(ids.includes(n) && !seen.has(n)){ seen.add(n); stack.push(n); } }); }
    if(seen.size!==ids.length) problems.push(`${c.name}: not connected inside itself`);
  });
  return new Promise(resolve=>{
    const cfg = Array.from({length:4}, (_,i)=>({ name:'AI'+i, isHuman:false, color:'#000', personality:['balanced','turtle','rusher','opportunist'][i] }));
    core.initGame(cfg, 'hard', true, true, 'progressive');
    core.autoPlaceInitialArmies(); core.beginReinforcePhase();
    const start = Date.now();
    const iv = setInterval(()=>{
      if(errors.length || core.game.over || core.game.roundNumber>150 || Date.now()-start>15000){
        clearInterval(iv);
        errors.forEach(e=> problems.push('AI game threw: '+e.split('\n')[0]));
        resolve({ name: obj.name, terrs: terrs.length, conts: Object.keys(map.continents).length, rounds: core.game.roundNumber, problems });
      }
    }, 10);
  });
}

(async()=>{
  const files = fs.readdirSync(MAPS_DIR).filter(f=>f.endsWith('.json')).sort();
  let bad = 0;
  for(const f of files){
    const r = await check(f);
    console.log(`${r.problems.length?'[FAIL]':'[OK]  '} ${f}: "${r.name}" ${r.terrs} territories, ${r.conts} continents, AI game reached round ${r.rounds}`);
    r.problems.forEach(p=> console.log('       - '+p));
    bad += r.problems.length;
  }
  if(bad) process.exit(1);
  console.log('Gallery maps: all playable.');
  process.exit(0);
})();
