/* =========================================================================
   MAP DATA MODEL
   cellTerritory: Int16Array flat, length cols*rows, value = territoryId or -1
   ========================================================================= */
let mapData = null;
let spectatorMode = false; // true = every player is AI-controlled and events are slowed down for watching
function aiDelay(base){ return spectatorMode ? RUNTIME_CONFIG.spectatorModeDelayMs : base; }

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
  };
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

function paintCell(map, c, r, terrId){
  if(!inBounds(map,c,r)) return;
  const idx = cellIndex(map,c,r);
  const old = map.cellTerritory[idx];
  if(old === terrId) return;
  if(old !== -1 && map.territories[old]){
    const t = map.territories[old];
    const i = t.cells.findIndex(cc=>cc[0]===c&&cc[1]===r);
    if(i>=0) t.cells.splice(i,1);
  }
  map.cellTerritory[idx] = terrId;
  if(terrId !== -1 && map.territories[terrId]){
    map.territories[terrId].cells.push([c,r]);
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

function generateWaterMask(cols, rows, waterRatio){
  const total = cols*rows;
  const water = new Uint8Array(total);
  const targetWater = Math.round(total*clamp(waterRatio,0,0.7));
  if(targetWater<=0) return water;
  const numBlobs = clamp(Math.round(Math.sqrt(cols*rows)/9), 1, 6);
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
        if(Math.random()<0.82){ water[idx]=1; count++; next.push({c:nc,r:nr}); }
      }
    }
    frontier = next;
  }
  return water;
}

function generateRandomMap(cols, rows, numTerr, numCont, name, waterRatio){
  const map = newMap(cols, rows, name);
  const water = generateWaterMask(cols, rows, waterRatio===undefined?0.28:waterRatio);
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

  // Group territories into continents, preferring continent borders that follow coastlines
  // (water) rather than cutting through contiguous land. Each connected landmass (component
  // of the territory graph — water always breaks graph edges) is treated as a unit: small
  // landmasses are kept whole and merged wholesale into a continent, while only the largest
  // landmasses get split internally when more continents are requested than there are landmasses.
  const components = findConnectedComponents(map).map(ids=>({
    ids, size: ids.reduce((s,id)=> s+map.territories[id].cells.length, 0)
  }));
  components.sort((a,b)=> b.size-a.size);

  let contsPerComponent = components.map(()=> components.length<=numCont ? 1 : 0);
  if(components.length <= numCont){
    // enough (or more) continents requested than landmasses: everyone gets at least one,
    // extra continents go to whichever landmass is currently most "crowded" (biggest split need)
    let remaining = numCont - components.length;
    while(remaining>0){
      let bestIdx=0, bestRatio=-1;
      components.forEach((comp,i)=>{
        const ratio = comp.size / contsPerComponent[i];
        if(ratio>bestRatio){ bestRatio=ratio; bestIdx=i; }
      });
      contsPerComponent[bestIdx]++;
      remaining--;
    }
  } else {
    // fewer continents than landmasses: keep the `numCont` largest landmasses as their own
    // continent, and merge every smaller landmass wholesale into one of those later.
    for(let i=0;i<Math.min(numCont,components.length);i++) contsPerComponent[i]=1;
  }

  const contOwnedByComponent = components.map(()=>false);
  components.forEach((comp, ci)=>{
    const wantConts = contsPerComponent[ci];
    if(wantConts<=0) return;
    contOwnedByComponent[ci] = true;
    const seedIds = shuffle(comp.ids).slice(0, wantConts);
    const localConts = seedIds.map(()=> createContinent(map));
    const assigned = {};
    let cq = seedIds.map((tid,i)=>({tid, cont: localConts[i].id}));
    cq.forEach(x=> assigned[x.tid]=x.cont);
    while(cq.length){
      cq = shuffle(cq);
      const next=[];
      for(const {tid,cont} of cq){
        for(const nb of shuffle([...map.territories[tid].neighbors])){
          if(assigned[nb]===undefined){ assigned[nb]=cont; next.push({tid:nb,cont}); }
        }
      }
      cq = next;
    }
    comp.ids.forEach(tid=>{ map.territories[tid].continentId = assigned[tid] ?? localConts[0].id; });
  });

  // merge leftover landmasses (too small to warrant their own continent) wholesale into an
  // existing continent — never split one, so this never introduces a land border mid-component.
  const allContIds = Object.values(map.continents).map(c=>c.id);
  let rr=0;
  components.forEach((comp, ci)=>{
    if(contOwnedByComponent[ci] || allContIds.length===0) return;
    const targetCont = allContIds[rr % allContIds.length]; rr++;
    comp.ids.forEach(tid=> map.territories[tid].continentId = targetCont);
  });

  // bonuses based on continent size
  Object.values(map.continents).forEach(cont=>{
    const size = Object.values(map.territories).filter(t=>t.continentId===cont.id).length;
    cont.bonus = Math.max(2, Math.round(size/2)+1);
  });
  return map;
}

