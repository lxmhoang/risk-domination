#!/usr/bin/env node
"use strict";
/* =========================================================================
   ALLIANCE "COMMON ENEMY" TEST
   ---------------------------------------------------------------------
   The leader gets marked (game.commonEnemy) and the gang-up follows the mark: it persists after
   the player stops being the leader, ignores another leader meanwhile, and is released once the
   marked player's power falls under allianceReleaseFraction of what it was when marked — only
   then does the current leader (if any) become the new mark. Run `node build.js` first.
   ========================================================================= */
const fs = require('fs'), path = require('path');
const createCore = require(path.join(__dirname, '..', 'dist', 'core.js'));
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'config.json'), 'utf8'));
const core = createCore(CONFIG, {});
// 4 players; each owns 6 territories of a 24-territory line-up (adjacency irrelevant here)
const map = core.newMap(24, 1, 't');
for(let i=1;i<=24;i++) map.territories[i] = {id:i, name:'T'+i, continentId:1, color:'#fff', cells:[], neighbors:new Set(), centroid:{x:i,y:0}};
map.continents[1] = {id:1, name:'C', color:'#000', bonus:3};
core.mapData = map;
const cfg = [0,1,2,3].map(i=>({name:'P'+i, isHuman:false, color:'#000', personality:'balanced'}));
core.initGame(cfg, 'normal', true, true, 'progressive');
const g = core.game;
for(let i=1;i<=24;i++){ g.owner[i] = (i-1)%4; g.armies[i] = 3; }
const setArmies = (pid, each)=>{ for(let i=1;i<=24;i++) if(g.owner[i]===pid) g.armies[i] = each; };
let bad = 0;
const check = (cond, msg)=>{ console.log((cond?'[OK]   ':'[FAIL] ')+msg); if(!cond) bad++; };

check(core.updateCommonEnemy()===null, 'nobody is marked while no one leads');
setArmies(0, 30); // P0 far ahead
check(core.updateCommonEnemy()===0 && g.commonEnemy.id===0, 'the leader gets marked');
const start = g.commonEnemy.startPower;
setArmies(0, 14); // down to under half its power, which is still above the release fraction…
core.RUNTIME_CONFIG.allianceLeaderVsField = 5; // …and the leader gate is made strict enough that it no longer passes it
check(core.findAllianceLeader()!==0, 'P0 is no longer the leader…');
check(core.updateCommonEnemy()===0, '…but is still the common enemy');
core.RUNTIME_CONFIG.allianceLeaderVsField = CONFIG.allianceLeaderVsField;
setArmies(1, 40); // someone else becomes the leader meanwhile
check(core.findAllianceLeader()===1, 'P1 is now the leader');
check(core.updateCommonEnemy()===0, 'the mark stays on P0, P1 is not ganged up on');
setArmies(0, 1); // power well under 1/3 of start
check(core.evaluatePlayerPower(0) < start*CONFIG.allianceReleaseFraction, 'P0 fell under the release fraction');
check(core.updateCommonEnemy()===1 && g.commonEnemy.id===1, 'mark released; the leader P1 becomes the new common enemy');
g.players[1].alive = false;
check(core.updateCommonEnemy()!==1, 'an eliminated mark is dropped');
process.exit(bad?1:0);
