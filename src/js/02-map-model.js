/* =========================================================================
   MAP DATA MODEL
   cellTerritory: Int16Array flat, length cols*rows, value = territoryId or -1
   ========================================================================= */
let mapData = null;
let spectatorMode = false; // true = every player is AI-controlled and events are slowed down for watching
function aiDelay(base){ return spectatorMode ? RUNTIME_CONFIG.spectatorModeDelayMs : base; }

/* ---------------- Pausable AI turn scheduling ----------------
   An AI turn is a chain of steps (reinforce -> attack loop -> fortify -> end turn), each one
   scheduled a bit later via setTimeout so the player can watch it happen. To let the ▶️/⏸️
   button in the topbar pause that chain, every one of those setTimeout calls goes through
   aiSchedule() instead of setTimeout directly: if the game is paused by the time a step's
   timer fires, the step is stashed (not run) instead, and setAIPaused(false) runs it
   immediately — so resuming continues the exact same chain rather than restarting it. */
let aiPaused = false;
let pendingAIResume = null;
function aiSchedule(fn, delay){
  setTimeout(()=>{
    if(aiPaused){ pendingAIResume = fn; return; }
    fn();
  }, delay);
}
function setAIPaused(paused){
  aiPaused = paused;
  if(!paused && pendingAIResume){
    const fn = pendingAIResume; pendingAIResume = null;
    if(game && !game.over) fn();
  }
}

function newMap(cols, rows, name){
  return {
    name: name || "Bản đồ mới",
    cols, rows,
    cellSize: Math.floor(Math.min(960/cols, 600/rows)),
    cellTerritory: new Int16Array(cols*rows).fill(-1),
    territories: {},   // id -> {id,name,continentId,color,cells:[[c,r]],neighbors:Set,centroid:{x,y}}
    continents: {},    // id -> {id,name,color,bonus}
    nextTerrId: 1,
    nextContId: 1,
    _terrBoundaryCache: {}, // terrId -> smoothed pixel-space loops, see getTerritoryBoundaryLoops()
    _contBoundaryCache: {}, // contId -> smoothed pixel-space loops, see getContinentBoundaryLoops()
  };
}

// Plain-JSON (de)serialization of a map, shared by the editor's export/import (03-editor.js)
// and by game save/load (04-game-state.js) — a saved-game file bundles one of these alongside
// the game state so loading it doesn't depend on whatever map happens to be open already.
function mapToPlainObject(map){
  return {
    name: map.name, cols: map.cols, rows: map.rows, cellSize: map.cellSize,
    cellTerritory: Array.from(map.cellTerritory),
    territories: Object.values(map.territories).map(t=>({id:t.id,name:t.name,continentId:t.continentId,color:t.color})),
    continents: Object.values(map.continents).map(c=>({id:c.id,name:c.name,color:c.color,bonus:c.bonus})),
    nextTerrId: map.nextTerrId, nextContId: map.nextContId,
  };
}
function mapFromPlainObject(obj){
  const map = newMap(obj.cols, obj.rows, obj.name);
  map.cellSize = obj.cellSize || map.cellSize;
  map.cellTerritory = new Int16Array(obj.cellTerritory);
  (obj.territories||[]).forEach(t=>{
    map.territories[t.id] = {id:t.id,name:t.name,continentId:t.continentId,color:t.color,cells:[],neighbors:new Set(),centroid:{x:0,y:0}};
  });
  (obj.continents||[]).forEach(c=>{ map.continents[c.id] = {id:c.id,name:c.name,color:c.color,bonus:c.bonus}; });
  for(let r=0;r<map.rows;r++) for(let c=0;c<map.cols;c++){
    const id = map.cellTerritory[cellIndex(map,c,r)];
    if(id!==-1 && map.territories[id]) map.territories[id].cells.push([c,r]);
  }
  map.nextTerrId = obj.nextTerrId || (Math.max(0,...Object.keys(map.territories).map(Number))+1);
  map.nextContId = obj.nextContId || (Math.max(0,...Object.keys(map.continents).map(Number))+1);
  recomputeGraph(map);
  return map;
}

function cellIndex(map,c,r){ return r*map.cols + c; }
function inBounds(map,c,r){ return c>=0 && c<map.cols && r>=0 && r<map.rows; }

function createTerritory(map, name){
  const id = map.nextTerrId++;
  map.territories[id] = {
    id, name: (name && finalizeTerrName(name)) || defaultTerrName(id), continentId: null,
    color: PALETTE_TERR[(id-1) % PALETTE_TERR.length],
    cells: [], neighbors: new Set(), centroid:{x:0,y:0}
  };
  return map.territories[id];
}
function createContinent(map, name, color){
  const id = map.nextContId++;
  map.continents[id] = { id, name: (name && finalizeContName(name)) || defaultContName(id), color: color || PALETTE_CONT[(id-1)%PALETTE_CONT.length], bonus: 2 };
  return map.continents[id];
}

// ---------------- Smooth territory/continent boundary rendering ----------------
// Territories are still just sets of grid cells underneath (adjacency, ownership, click
// hit-testing all stay cell-based) — this only affects how a territory's outline is DRAWN:
// its outer edge (and any water "holes" inside it) is traced by walking cell edges (marching-
// squares style), then rounded from blocky right angles into an organic curve with a couple
// passes of Chaikin's corner-cutting algorithm. Purely a rendering concern.
//
// inSet(c,r) => whether cell (c,r) belongs to the mask being traced. Emitting each filled
// cell's edges in this specific order/direction makes the outer boundary of a blob come out
// clockwise and any hole inside it come out counter-clockwise automatically — which is exactly
// what canvas's default "nonzero" fill rule needs to render holes as holes.
function traceMaskBoundary(inSet){
  const edges = new Map(); // "x_y" (edge start corner) -> [x2,y2] (edge end corner)
  const k = (x,y)=> x+'_'+y;
  inSet.cells.forEach(([c,r])=>{
    if(!inSet(c,r-1)) edges.set(k(c,r), [c+1,r]);
    if(!inSet(c+1,r)) edges.set(k(c+1,r), [c+1,r+1]);
    if(!inSet(c,r+1)) edges.set(k(c+1,r+1), [c,r+1]);
    if(!inSet(c-1,r)) edges.set(k(c,r+1), [c,r]);
  });
  const loops = [];
  const visited = new Set();
  for(const startKey of edges.keys()){
    if(visited.has(startKey)) continue;
    const loop = [];
    let curKey = startKey, guard = 0;
    while(!visited.has(curKey) && edges.has(curKey) && guard++<200000){
      visited.add(curKey);
      loop.push(curKey.split('_').map(Number));
      const [nx,ny] = edges.get(curKey);
      curKey = k(nx,ny);
    }
    if(loop.length>=3) loops.push(loop);
  }
  return loops;
}

// One pass replaces each edge (P0,P1) with 2 points at 25%/75% along it, cutting every corner
// down and rounding it; a couple of passes is enough to look like a smooth organic curve.
function chaikinSmooth(loop, iterations){
  let pts = loop;
  for(let it=0; it<iterations; it++){
    const next = []; const n = pts.length;
    for(let i=0;i<n;i++){
      const [x0,y0] = pts[i]; const [x1,y1] = pts[(i+1)%n];
      next.push([x0+(x1-x0)*0.25, y0+(y1-y0)*0.25]);
      next.push([x0+(x1-x0)*0.75, y0+(y1-y0)*0.75]);
    }
    pts = next;
  }
  return pts;
}

function traceAndSmoothCells(map, cellList){
  const cellSet = new Set(cellList.map(([c,r])=> c+'_'+r));
  const inSet = (c,r)=> cellSet.has(c+'_'+r);
  inSet.cells = cellList;
  const cs = map.cellSize;
  return traceMaskBoundary(inSet).map(loop => chaikinSmooth(loop.map(([x,y])=>[x*cs,y*cs]), 2));
}

// Smoothed outer boundary (+ any water-hole boundaries) of a single territory, in pixel space,
// cached until invalidateBoundaryCache() drops it (see paintCell() below).
function getTerritoryBoundaryLoops(map, terrId){
  const t = map.territories[terrId];
  if(!t || t.cells.length===0) return [];
  if(!map._terrBoundaryCache) map._terrBoundaryCache = {};
  if(map._terrBoundaryCache[terrId]) return map._terrBoundaryCache[terrId];
  const loops = traceAndSmoothCells(map, t.cells);
  map._terrBoundaryCache[terrId] = loops;
  return loops;
}

// Smoothed outer boundary of an entire continent (the union of all its member territories'
// cells) — used only for the thicker continent-outline overlay in continent view.
function getContinentBoundaryLoops(map, contId){
  if(!map._contBoundaryCache) map._contBoundaryCache = {};
  if(map._contBoundaryCache[contId]) return map._contBoundaryCache[contId];
  const cellList = [];
  Object.values(map.territories).forEach(t=>{ if(t.continentId===contId) cellList.push(...t.cells); });
  const loops = cellList.length ? traceAndSmoothCells(map, cellList) : [];
  map._contBoundaryCache[contId] = loops;
  return loops;
}

// Territory shape changes invalidate that territory's own cached boundary; continent shapes
// are unions of territories so any cell change could affect any continent's outline — cheap
// enough to just drop that whole (much smaller) cache rather than track it precisely.
function invalidateBoundaryCache(map, terrId){
  if(map._terrBoundaryCache) delete map._terrBoundaryCache[terrId];
  map._contBoundaryCache = {};
}

function paintCell(map, c, r, terrId){
  if(!inBounds(map,c,r)) return;
  const idx = cellIndex(map,c,r);
  const old = map.cellTerritory[idx];
  if(old === terrId) return;
  if(old !== -1 && map.territories[old]){
    const t = map.territories[old];
    const i = t.cells.findIndex(cc=>cc[0]===c&&cc[1]===r);
    if(i>=0) t.cells.splice(i,1);
    invalidateBoundaryCache(map, old);
  }
  map.cellTerritory[idx] = terrId;
  if(terrId !== -1 && map.territories[terrId]){
    map.territories[terrId].cells.push([c,r]);
    invalidateBoundaryCache(map, terrId);
  }
}

function bucketFill(map, c, r, newId){
  const idx = cellIndex(map,c,r);
  const target = map.cellTerritory[idx];
  if(target === newId) return;
  const stack = [[c,r]];
  const visited = new Set();
  while(stack.length){
    const [cc,rr] = stack.pop();
    const key = cc+","+rr;
    if(visited.has(key)) continue;
    visited.add(key);
    if(!inBounds(map,cc,rr)) continue;
    if(map.cellTerritory[cellIndex(map,cc,rr)] !== target) continue;
    paintCell(map,cc,rr,newId);
    stack.push([cc+1,rr],[cc-1,rr],[cc,rr+1],[cc,rr-1]);
  }
}

function recomputeGraph(map){
  // neighbors + centroids
  Object.values(map.territories).forEach(t=>{ t.neighbors = new Set(); t.centroid={x:0,y:0}; });
  for(let r=0;r<map.rows;r++){
    for(let c=0;c<map.cols;c++){
      const id = map.cellTerritory[cellIndex(map,c,r)];
      if(id===-1) continue;
      // right neighbor
      if(c+1<map.cols){
        const id2 = map.cellTerritory[cellIndex(map,c+1,r)];
        if(id2!==-1 && id2!==id){ map.territories[id]?.neighbors.add(id2); map.territories[id2]?.neighbors.add(id); }
      }
      // down neighbor
      if(r+1<map.rows){
        const id2 = map.cellTerritory[cellIndex(map,c,r+1)];
        if(id2!==-1 && id2!==id){ map.territories[id]?.neighbors.add(id2); map.territories[id2]?.neighbors.add(id); }
      }
    }
  }
  Object.values(map.territories).forEach(t=>{
    if(t.cells.length===0){ t.centroid={x:-1,y:-1}; return; }
    let sx=0,sy=0;
    t.cells.forEach(([c,r])=>{ sx += c+0.5; sy += r+0.5; });
    t.centroid = { x: (sx/t.cells.length)*map.cellSize, y: (sy/t.cells.length)*map.cellSize };
  });
}

/* ---------------- Procedural random map generator ---------------- */
/* Generate an organic water mask (1 = water, 0 = land) covering roughly waterRatio of the grid,
   grown from a handful of random blobs so coastlines look natural rather than speckled noise. */
/* Connected components of the territory adjacency graph. Water always breaks graph edges
   (see recomputeGraph), so each component is exactly one contiguous landmass/island. */
function findConnectedComponents(map){
  const seen = new Set();
  const comps = [];
  Object.keys(map.territories).map(Number).forEach(start=>{
    if(seen.has(start)) return;
    const comp = [];
    const stack=[start];
    seen.add(start);
    while(stack.length){
      const cur = stack.pop();
      comp.push(cur);
      map.territories[cur].neighbors.forEach(n=>{
        if(!seen.has(n)){ seen.add(n); stack.push(n); }
      });
    }
    comps.push(comp);
  });
  return comps;
}

/* Any whole landmass (one territory or a cluster of several, all cut off from the rest of the
   map by water) can never be attacked, reinforced into, or attacked FROM by anyone else — it's
   a dead island. Carve a thin land bridge through water from that island to the nearest other
   landmass so the entire map ends up as a single connected graph. Repeats since merging two
   components can occasionally still leave others isolated, and a single guarded pass keeps
   bridging until only one component remains (or we give up after enough tries). */
function ensureNoIsolatedTerritories(map){
  let guard=0;
  while(guard++<50){
    const comps = findConnectedComponents(map);
    if(comps.length<=1) break;
    // Bridge every component except the largest one out towards the rest of the map — the
    // largest is treated as "mainland" so smaller islands connect back to it (directly or,
    // after a later pass, transitively through another island they land next to).
    comps.sort((a,b)=> b.length-a.length);
    for(let i=1;i<comps.length;i++){
      bridgeComponentOut(map, comps[i]);
    }
    recomputeGraph(map);
  }
}

function bridgeComponentOut(map, compTerrIds){
  const compSet = new Set(compTerrIds);
  const cols = map.cols;
  const visited = new Set();
  const queue = [];
  compTerrIds.forEach(tid=>{
    const t = map.territories[tid];
    if(!t) return;
    t.cells.forEach(([c,r])=>{
      const idx = r*cols+c;
      if(!visited.has(idx)){ visited.add(idx); queue.push({c,r,parent:null,ownerTid:tid}); }
    });
  });
  // BFS outward from every cell of every territory in this component, travelling only through
  // water, until we reach a cell that belongs to a territory OUTSIDE this component.
  let qi = 0, target = null;
  while(qi<queue.length && !target){
    const cur = queue[qi++];
    for(const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nc=cur.c+dc, nr=cur.r+dr;
      if(!inBounds(map,nc,nr)) continue;
      const idx = nr*cols+nc;
      if(visited.has(idx)) continue;
      const cellTid = map.cellTerritory[idx];
      if(cellTid!==-1 && !compSet.has(cellTid)){ target = {c:nc,r:nr,parent:cur,srcTid:cur.ownerTid}; break; }
      if(cellTid===-1){ visited.add(idx); queue.push({c:nc,r:nr,parent:cur,ownerTid:cur.ownerTid}); }
    }
  }
  if(!target) return; // whole map is this one component — nothing to bridge to
  // walk back from the target's parent (the water cells forming the shortest path) and claim
  // them as the source territory's own land, stopping once back at that territory's own cells.
  const tid = target.srcTid;
  let cur = target.parent;
  while(cur && map.cellTerritory[cur.r*cols+cur.c] !== tid){
    paintCell(map, cur.c, cur.r, tid);
    cur = cur.parent;
  }
}

// Lays down a jagged coastal band of water hugging all 4 edges of the grid, with an
// organic (random-walk + smoothing), varying depth per edge column/row instead of a
// straight-ruled ring — so territories that grow up against it later trace a natural-looking
// coastline rather than following the map's rectangular bounding box. Runs before territories
// (and before the interior lake blobs below) are generated, and independently of the
// water-ratio slider, since it's about edge shape rather than total lake area.
function applyCoastalBand(water, cols, rows){
  const minDim = Math.min(cols, rows);
  const minDepth = clamp(Math.round(minDim*0.06), 1, 3);
  const maxDepth = clamp(Math.round(minDim*0.18), minDepth+2, Math.max(minDepth+2, Math.floor(minDim/3)));
  function walkDepths(length){
    const raw = new Array(length);
    let d = minDepth + rand(maxDepth-minDepth+1);
    for(let i=0;i<length;i++){ d = clamp(d + rand(3)-1, minDepth, maxDepth); raw[i] = d; }
    // two smoothing passes turn the per-step jitter into gentle, coastline-like curves
    let smoothed = raw;
    for(let pass=0; pass<2; pass++){
      const src = smoothed, next = new Array(length);
      for(let i=0;i<length;i++){
        let sum=0, cnt=0;
        for(let k=-2;k<=2;k++){ const j=i+k; if(j>=0 && j<length){ sum+=src[j]; cnt++; } }
        next[i] = Math.round(sum/cnt);
      }
      smoothed = next;
    }
    return smoothed;
  }
  const topDepth = walkDepths(cols), bottomDepth = walkDepths(cols);
  const leftDepth = walkDepths(rows), rightDepth = walkDepths(rows);
  for(let c=0;c<cols;c++){
    for(let r=0;r<topDepth[c];r++) water[r*cols+c]=1;
    for(let r=0;r<bottomDepth[c];r++) water[(rows-1-r)*cols+c]=1;
  }
  for(let r=0;r<rows;r++){
    for(let c=0;c<leftDepth[r];c++) water[r*cols+c]=1;
    for(let c=0;c<rightDepth[r];c++) water[r*cols+(cols-1-c)]=1;
  }
}

function generateWaterMask(cols, rows, waterRatio, spread){
  const total = cols*rows;
  const water = new Uint8Array(total);
  applyCoastalBand(water, cols, rows);
  const targetWater = Math.round(total*clamp(waterRatio,0,0.7));
  if(targetWater<=0) return water;
  // spread (0-1): how scattered the water is. At 0, few big blobs grow into large lakes/seas
  // (the original behavior); at 1, the same total water area is seeded from many more, smaller
  // blobs with a lower per-cell fill chance so the coastline comes out raggeder and more spread
  // out across the map instead of piling into 1-2 big clumps.
  const s = clamp(spread===undefined?0.4:spread, 0, 1);
  const baseBlobs = clamp(Math.round(Math.sqrt(total)/9), 1, 6);
  const maxBlobs = Math.max(baseBlobs, Math.round(total/120));
  const numBlobs = clamp(Math.round(baseBlobs + s*(maxBlobs-baseBlobs)), 1, maxBlobs);
  const fillProb = 0.88 - s*0.33;
  const allCells = [];
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++) allCells.push([c,r]);
  const seeds = shuffle(allCells).slice(0, numBlobs);
  let frontier = seeds.map(([c,r])=>({c,r}));
  let count = 0;
  seeds.forEach(([c,r])=>{ const idx=r*cols+c; if(!water[idx]){ water[idx]=1; count++; } });
  let guard=0;
  while(count<targetWater && guard++<20000){
    if(frontier.length===0){
      // stuck (surrounded) - seed a fresh blob elsewhere to keep growing
      const remaining = allCells.filter(([c,r])=>!water[r*cols+c]);
      if(remaining.length===0) break;
      const [c,r] = randChoice(remaining);
      water[r*cols+c]=1; count++;
      frontier = [{c,r}];
      continue;
    }
    frontier = shuffle(frontier);
    const next = [];
    for(const {c,r} of frontier){
      if(count>=targetWater) break;
      const dirs = shuffle([[1,0],[-1,0],[0,1],[0,-1]]);
      for(const [dc,dr] of dirs){
        if(count>=targetWater) break;
        const nc=c+dc, nr=r+dr;
        if(nc<0||nc>=cols||nr<0||nr>=rows) continue;
        const idx = nr*cols+nc;
        if(water[idx]) continue;
        if(Math.random()<fillProb){ water[idx]=1; count++; next.push({c:nc,r:nr}); }
      }
    }
    frontier = next;
  }
  return water;
}

function generateRandomMap(cols, rows, numTerr, numCont, name, waterRatio, waterSpread){
  const map = newMap(cols, rows, name);
  const water = generateWaterMask(cols, rows, waterRatio===undefined?0.28:waterRatio, waterSpread);
  map.water = water; // keep for reference/export if needed later

  const landCells = [];
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){ if(!water[r*cols+c]) landCells.push([c,r]); }

  if(landCells.length===0){
    // degenerate case (100% water requested) - fall back to a small land patch so the map is playable
    for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){ if(r<Math.max(2,Math.floor(rows/4))){ water[r*cols+c]=0; landCells.push([c,r]); } }
  }

  const effectiveNumTerr = Math.max(1, Math.min(numTerr, landCells.length));
  const seeds = shuffle(landCells).slice(0, effectiveNumTerr);
  const terrs = seeds.map((s)=> createTerritory(map));
  const frontier = []; // {c,r,terrId}
  seeds.forEach((s,i)=>{
    map.cellTerritory[cellIndex(map,s[0],s[1])] = terrs[i].id;
    terrs[i].cells.push([s[0],s[1]]);
    frontier.push([s[0],s[1],terrs[i].id]);
  });
  // multi-source randomized BFS growth, restricted to land cells
  let queue = frontier;
  while(queue.length){
    queue = shuffle(queue);
    const next = [];
    for(const [c,r,tid] of queue){
      const dirs = shuffle([[1,0],[-1,0],[0,1],[0,-1]]);
      for(const [dc,dr] of dirs){
        const nc=c+dc, nr=r+dr;
        if(!inBounds(map,nc,nr)) continue;
        const idx = cellIndex(map,nc,nr);
        if(water[idx]) continue;
        if(map.cellTerritory[idx] === -1){
          map.cellTerritory[idx] = tid;
          map.territories[tid].cells.push([nc,nr]);
          next.push([nc,nr,tid]);
        }
      }
    }
    queue = next;
  }
  // water can split land into separate islands with no seed of their own — claim any leftover
  // land cells (as new territories) so the whole coastline ends up owned by someone.
  let leftoverGuard=0;
  while(leftoverGuard++<2000){
    const unfilled = landCells.filter(([c,r])=> map.cellTerritory[cellIndex(map,c,r)]===-1);
    if(unfilled.length===0) break;
    const [sc,sr] = randChoice(unfilled);
    const t = createTerritory(map);
    let q = [[sc,sr]];
    map.cellTerritory[cellIndex(map,sc,sr)] = t.id; t.cells.push([sc,sr]);
    while(q.length){
      q = shuffle(q);
      const next=[];
      for(const [c,r] of q){
        for(const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]){
          const nc=c+dc, nr=r+dr;
          if(!inBounds(map,nc,nr)) continue;
          const idx = cellIndex(map,nc,nr);
          if(water[idx]) continue;
          if(map.cellTerritory[idx]===-1){
            map.cellTerritory[idx]=t.id; t.cells.push([nc,nr]); next.push([nc,nr]);
          }
        }
      }
      q = next;
    }
  }
  recomputeGraph(map);
  ensureNoIsolatedTerritories(map);

  for(let i=0;i<numCont;i++) createContinent(map);
  reassignContinents(map);
  return map;
}

// Reassigns every territory's continentId across the map's EXISTING continents — never
// creates or deletes a continent. Used both right after generateRandomMap() seeds fresh
// continents above, and standalone by the editor's "Tự động chia lại" button to redo this
// on a map you've already been hand-editing (e.g. after adding a continent by hand, which
// otherwise starts out with zero territories — see createContinent()).
//
// Prefers continent borders that follow coastlines (water) rather than cutting through
// contiguous land: each connected landmass (component of the territory graph — water always
// breaks graph edges) is treated as a unit. Small landmasses are kept whole and merged
// wholesale into a continent; only the largest landmasses get split internally when there
// are more continents than landmasses.
function reassignContinents(map){
  const contIds = Object.keys(map.continents).map(Number);
  const numCont = contIds.length;
  if(numCont===0) return;

  const components = findConnectedComponents(map).map(ids=>({
    ids, size: ids.reduce((s,id)=> s+map.territories[id].cells.length, 0)
  }));
  components.sort((a,b)=> b.size-a.size);

  // How many continents does each landmass get? Proportional apportionment (the "largest
  // remainder" method used for seat allocation) rather than "1 baseline each + leftovers to
  // whoever's biggest" — the baseline approach let two very differently-sized landmasses both
  // end up as exactly 1 whole continent each whenever there happened to be enough continents
  // to go around 1-for-1, with no mechanism left to correct the size gap between them.
  let contsPerComponent;
  if(components.length <= numCont){
    const totalLand = components.reduce((s,c)=>s+c.size,0);
    const quotas = components.map(c=> c.size/totalLand*numCont);
    contsPerComponent = quotas.map(q=> Math.floor(q));
    let remaining = numCont - contsPerComponent.reduce((a,b)=>a+b,0);
    // remaining continents (from the fractional part of each quota) go to the landmasses
    // with the largest leftover remainder first — standard largest-remainder apportionment.
    const order = components.map((_,i)=>i).sort((a,b)=> (quotas[b]-contsPerComponent[b]) - (quotas[a]-contsPerComponent[a]));
    for(let k=0;k<remaining;k++) contsPerComponent[order[k]]++;
    // a landmass whose quota rounds down to 0 continents just falls through to the
    // leftover-merge step below instead of getting a whole (tiny) continent to itself.
  } else {
    // fewer continents than landmasses: keep the `numCont` largest landmasses as their own
    // continent, and merge every smaller landmass wholesale into one of those later.
    contsPerComponent = components.map((c,i)=> i<numCont ? 1 : 0);
  }

  const pool = shuffle(contIds.slice()); // drained exactly `numCont` times total below
  const contOwnedByComponent = components.map(()=>false);
  components.forEach((comp, ci)=>{
    const wantConts = contsPerComponent[ci];
    if(wantConts<=0) return;
    contOwnedByComponent[ci] = true;
    const myContIds = pool.splice(0, wantConts);
    const seedIds = shuffle(comp.ids).slice(0, myContIds.length);
    const assigned = {};
    // Round-robin growth (one claim per continent per pass, not a full-frontier flood) so
    // continents in the same landmass grow at an even rate — otherwise a seed that happens
    // to have more open neighbors nearby snowballs into a much bigger share of the landmass.
    const frontiers = myContIds.map((cont,i)=>{ assigned[seedIds[i]]=cont; return [seedIds[i]]; });
    let anyMoved = true;
    while(anyMoved){
      anyMoved = false;
      for(let fi=0; fi<frontiers.length; fi++){
        const q = frontiers[fi], cont = myContIds[fi];
        while(q.length){
          const tid = q.shift();
          const nbs = shuffle([...map.territories[tid].neighbors]).filter(nb=>assigned[nb]===undefined);
          if(nbs.length===0) continue; // exhausted, try the next queued tile instead
          assigned[nbs[0]] = cont;
          q.push(tid); // may still have more unclaimed neighbors later
          q.push(nbs[0]);
          anyMoved = true;
          break; // one claim per continent this pass, then move on to the next continent
        }
      }
    }
    comp.ids.forEach(tid=>{ map.territories[tid].continentId = assigned[tid] ?? myContIds[0]; });
  });

  // merge leftover landmasses (too small to warrant their own continent) wholesale into
  // whichever continent is CURRENTLY smallest — never split one (so this never introduces a
  // land border mid-component), while keeping overall continent sizes from drifting too far
  // apart from each other.
  const sizeOf = {}; contIds.forEach(id=> sizeOf[id]=0);
  Object.values(map.territories).forEach(t=>{ if(t.continentId!=null) sizeOf[t.continentId]++; });
  components.forEach((comp, ci)=>{
    if(contOwnedByComponent[ci]) return;
    let targetCont = contIds[0];
    contIds.forEach(id=>{ if(sizeOf[id]<sizeOf[targetCont]) targetCont=id; });
    comp.ids.forEach(tid=> map.territories[tid].continentId = targetCont);
    sizeOf[targetCont] += comp.ids.length;
  });

  // bonuses based on continent size
  Object.values(map.continents).forEach(cont=>{
    const size = Object.values(map.territories).filter(t=>t.continentId===cont.id).length;
    cont.bonus = Math.max(2, Math.round(size/2)+1);
  });
}

