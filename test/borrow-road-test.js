#!/usr/bin/env node
"use strict";
/* =========================================================================
   ALLIANCE "BORROW ROAD" (mượn đường) TEST
   ---------------------------------------------------------------------
   While the alliance has a common enemy (game.commonEnemy), a non-leader may attack the leader's
   territory across any chain of other players' territories (allianceBorrowHops intermediate
   provinces at most), and may fortify between its own territories across such a chain when the
   destination borders the leader. Without a common enemy, or for the leader itself, nothing
   changes. Run `node build.js` first.
   ========================================================================= */
const fs = require('fs'), path = require('path');
const createCore = require(path.join(__dirname, '..', 'dist', 'core.js'));
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'config.json'), 'utf8'));
const core = createCore(CONFIG, {});
core.RUNTIME_CONFIG.allianceBorrowHops = 99; // the test sets its own limit, whatever src/config.json ships
// Line of 8 territories: 1(P0) 2(P1) 3(P1) 4(P2) 5(P3 leader) 6(P3) 7(P0) 8(P1)
const map = core.newMap(8, 1, 't');
for(let i=1;i<=8;i++) map.territories[i] = {id:i, name:'T'+i, continentId:1, color:'#fff', cells:[], neighbors:new Set(), centroid:{x:i,y:0}};
for(let i=1;i<8;i++){ map.territories[i].neighbors.add(i+1); map.territories[i+1].neighbors.add(i); }
map.continents[1] = {id:1, name:'C', color:'#000', bonus:3};
core.mapData = map;
const cfg = [0,1,2,3].map(i=>({name:'P'+i, isHuman:false, color:'#000', personality:'balanced'}));
core.initGame(cfg, 'normal', true, true, 'progressive');
const g = core.game;
[0,1,1,2,3,3,0,1].forEach((o,i)=>{ g.owner[i+1] = o; g.armies[i+1] = 5; });
let bad = 0;
const check = (cond, msg)=>{ console.log((cond?'[OK]   ':'[FAIL] ')+msg); if(!cond) bad++; };

check(!core.canAttack(1,5,0), 'no common enemy: T1 cannot hit the far leader tile T5');
g.commonEnemy = {id:3, startPower:100};
check(core.canAttack(1,5,0), 'common enemy marked: T1 hits T5 across P1 and P2 land');
check(core.canAttack(4,5,2), 'adjacent attack still works');
check(!core.canAttack(1,4,0), 'borrow road never reaches non-leader tiles (T4 is not adjacent to T1)');
check(!core.canAttack(5,1,3), 'the common enemy itself gets no borrowed road');
g.armies[1] = 1;
check(!core.canAttack(1,5,0), 'still needs >= 2 armies on the attacking tile');
g.armies[1] = 5;
// T7(P0) is adjacent to T6 (leader): T1 -> T6 would have to cross the leader's own T5, so it is blocked
check(!core.canAttack(1,6,0), 'a chain may not pass through the leader\'s own land');
core.RUNTIME_CONFIG.allianceBorrowHops = 2;
check(!core.canAttack(1,5,0), 'hop limit 2: the 3 intermediate provinces T2,T3,T4 are too many');
core.RUNTIME_CONFIG.allianceBorrowHops = 3;
check(core.canAttack(1,5,0), 'hop limit 3: exactly 3 intermediate provinces is allowed');
core.RUNTIME_CONFIG.allianceBorrowHops = 0;
check(!core.canAttack(1,5,0), 'hop limit 0 switches the rule off');
core.RUNTIME_CONFIG.allianceBorrowHops = 99;
check(core.attackTargetsFrom(1,0).includes(5), 'attackTargetsFrom lists the borrowed target');
check(core.attackersOf(5,0).includes(1) && core.attackersOf(5,0).includes(7)===false, 'attackersOf(T5): T1 yes; T7 cannot reach T5 without crossing T6');

// fortify: T1 -> T7 are both P0 but separated by P1,P2 (and the leader's T5/T6). The destination
// must border the leader: T7 borders T6, but the chain from T1 would cross leader land, so no.
check(!core.pathExistsOwned(1,7,0), 'no borrowed fortify through the leader\'s land');
// P0 captures T5: now P0 owns 1 and 5, split by P1/P2 land; T5 borders leader T6
g.owner[5] = 0;
check(core.pathExistsOwned(1,5,0), 'fortify into a captured island that borders the leader works across ally land');
check(core.pathExistsOwned(5,1,0) === false, 'reverse fortify (destination T1 does not border the leader) is not borrowed');
g.commonEnemy = null;
check(!core.pathExistsOwned(1,5,0), 'without a common enemy the island is cut off again');
process.exit(bad?1:0);
