#!/usr/bin/env node
"use strict";
/* =========================================================================
   Builds src/maps/tay-son.json — Indochina in the Lê–Trịnh / Tây Sơn period (~1786).
   ---------------------------------------------------------------------
   Coastline, lakes, rivers and country borders come from Natural Earth (public domain, 1:50m).
   Download these four files into one folder first:
     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson
     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_lakes.geojson
     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_rivers_lake_centerlines.geojson
     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
   then: node build.js && node tools/build-tay-son.js <that folder>

   Same method as tools/build-warring-states.js: territories are the cells nearest each seed
   (noise-weighted, through passable land only) and a territory's continent is its polity.
   Mountains (map.mountain) are impassable:
   - Laos is highland except a strip along the Mekong, so the Trường Sơn (the Vietnam–Laos border)
     is a closed wall: from Thăng Long the way west runs south to the Tây Nguyên, then across
     Cambodia;
   - the Tây Bắc highlands (Hoàng Liên Sơn, Sơn La, Điện Biên);
   - a band along China's borders with Laos and Burma (the Qing only reach Đại Việt);
   - a band along the Siam–Burma border (Tenasserim / Dawna hills), with its historic passes open;
   - the Cardamom mountains.
   ========================================================================= */
const fs = require('fs'), path = require('path');
const repo = path.join(__dirname, '..');
const neDir = process.argv[2];
if(!neDir){ console.error('usage: node tools/build-tay-son.js <natural-earth-geojson-folder>'); process.exit(1); }
const core = require(path.join(repo, 'dist', 'core.js'))(JSON.parse(fs.readFileSync(path.join(repo, 'src', 'config.json'), 'utf8')), {});

// ---------------- grid / projection ----------------
const LON0 = 95.5, LON1 = 110.8, LAT0 = 8.0, LAT1 = 25.6;
const K = Math.cos(16.8*Math.PI/180);
const ROWS = 500, CELL_DEG = (LAT1-LAT0)/ROWS;
const COLS = Math.round((LON1-LON0)*K/CELL_DEG);
const CELL_SIZE = 2;
const proj = ([lon,lat])=> [(lon-LON0)*K/CELL_DEG, (LAT1-lat)/CELL_DEG];
const N = COLS*ROWS;
const DIRS4 = [[1,0],[-1,0],[0,1],[0,-1]];

// even-odd scanline fill of a set of rings (cell coords) into mask (value v)
function fillRings(mask, rings, v){
  for(let r=0;r<ROWS;r++){
    const yc = r+0.5, xs = [];
    for(const ring of rings){
      for(let i=0;i<ring.length;i++){
        const [x0,y0] = ring[i], [x1,y1] = ring[(i+1)%ring.length];
        if((y0<=yc && y1>yc) || (y1<=yc && y0>yc)) xs.push(x0 + (yc-y0)*(x1-x0)/(y1-y0));
      }
    }
    if(!xs.length) continue;
    xs.sort((a,b)=>a-b);
    for(let k=0;k+1<xs.length;k+=2){
      const a = Math.max(0, Math.ceil(xs[k]-0.5)), b = Math.min(COLS-1, Math.floor(xs[k+1]-0.5));
      for(let c=a;c<=b;c++) mask[r*COLS+c] = v;
    }
  }
}
function readGeo(file){ return JSON.parse(fs.readFileSync(path.join(neDir, file), 'utf8')); }
function featurePolys(f){
  const geom = f.geometry; if(!geom) return [];
  const list = geom.type==='Polygon' ? [geom.coordinates] : geom.type==='MultiPolygon' ? geom.coordinates : [];
  return list.filter(p=> p[0].some(([x,y])=> x>LON0-3 && x<LON1+3 && y>LAT0-3 && y<LAT1+3))
             .map(p=> p.map(ring=> ring.map(proj)));
}
function geoPolys(file){ return readGeo(file).features.flatMap(featurePolys); }
// cells within distance d (cells) of a polyline [[lon,lat],...] — calls fn(idx) for each
function forLineCells(line, d, fn){
  const pts = line.map(proj);
  for(let i=0;i+1<pts.length;i++){
    const [x0,y0] = pts[i], [x1,y1] = pts[i+1];
    const minC = Math.floor(Math.min(x0,x1)-d-1), maxC = Math.ceil(Math.max(x0,x1)+d+1);
    const minR = Math.floor(Math.min(y0,y1)-d-1), maxR = Math.ceil(Math.max(y0,y1)+d+1);
    const dx = x1-x0, dy = y1-y0, L2 = dx*dx+dy*dy || 1e-9;
    for(let r=Math.max(0,minR); r<=Math.min(ROWS-1,maxR); r++) for(let c=Math.max(0,minC); c<=Math.min(COLS-1,maxC); c++){
      const px = c+0.5, py = r+0.5;
      const t = Math.max(0, Math.min(1, ((px-x0)*dx+(py-y0)*dy)/L2));
      if(Math.hypot(px-(x0+t*dx), py-(y0+t*dy))<=d) fn(r*COLS+c);
    }
  }
}
const forDiskCells = ([lon,lat], d, fn)=> forLineCells([[lon,lat],[lon,lat]], d, fn);

// ---------------- land & countries ----------------
const land = new Uint8Array(N);
geoPolys('ne_50m_land.geojson').forEach(p=> fillRings(land, p, 1));
geoPolys('ne_50m_lakes.geojson').forEach(p=> fillRings(land, p, 0));
const COUNTRY = { VNM:1, LAO:2, KHM:3, THA:4, MMR:5, CHN:6, MYS:7 };
const country = new Uint8Array(N);
readGeo('ne_50m_admin_0_countries.geojson').features.forEach(f=>{
  const code = COUNTRY[f.properties.ADM0_A3];
  if(code) featurePolys(f).forEach(p=> fillRings(country, p, code));
});
// coastal land the country polygons miss (1:50m outlines differ a little): nearest country
{
  const q = []; for(let i=0;i<N;i++) if(country[i]) q.push(i);
  for(let h=0;h<q.length;h++){
    const i = q[h], c = i%COLS, r = (i/COLS)|0;
    for(const [dc,dr] of DIRS4){
      const nc=c+dc, nr=r+dr; if(nc<0||nr<0||nc>=COLS||nr>=ROWS) continue;
      const j = nr*COLS+nc; if(land[j] && !country[j]){ country[j] = country[i]; q.push(j); }
    }
  }
}

// rivers from Natural Earth (also used to keep the Mekong valley open through Laos)
const riverLines = {};
readGeo('ne_50m_rivers_lake_centerlines.geojson').features.forEach(f=>{
  if(f.properties.featurecla!=='River' || !f.properties.name) return;
  const lines = f.geometry.type==='LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  (riverLines[f.properties.name] = riverLines[f.properties.name] || []).push(...lines);
});

// ---------------- impassable terrain ----------------
const mountain = new Uint8Array(N);
// Laos: all highland but the Mekong valley (from the Golden Triangle down to Cambodia)
for(let i=0;i<N;i++) if(country[i]===COUNTRY.LAO) mountain[i] = 1;
[...(riverLines.Mekong||[]), ...(riverLines.Lancang||[])].forEach(l=>{ // NE names the upper Mekong "Lancang"
  const part = l.filter(([lon,lat])=> lat<20.4 && lat>13.8);
  if(part.length>1) forLineCells(part, 9, i=>{ if(country[i]===COUNTRY.LAO) mountain[i] = 0; });
});
// Tây Bắc highlands (Hoàng Liên Sơn, Sơn La, Điện Biên, west Thanh Hoa / Nghệ An hills) — Vietnam only
{
  const tb = new Uint8Array(N);
  fillRings(tb, [[[101.8,22.6],[103.0,22.9],[103.9,22.85],[104.45,22.3],[104.8,21.75],[105.15,21.05],
  [105.35,20.55],[105.2,20.05],[105.0,19.6],[104.6,19.2],[104.2,19.0],[103.4,19.4],[101.8,20.0]].map(proj)], 1);
  for(let i=0;i<N;i++) if(tb[i] && country[i]===COUNTRY.VNM) mountain[i] = 1;
}
// bands along borders: cells within d of a cell of the other country
function borderBand(a, b, d, passes, minLat){
  const dist = new Int16Array(N).fill(-1), q = [];
  for(let i=0;i<N;i++){
    if(country[i]!==a && country[i]!==b) continue;
    const other = country[i]===a ? b : a, c = i%COLS, r = (i/COLS)|0;
    for(const [dc,dr] of DIRS4){
      const nc=c+dc, nr=r+dr; if(nc<0||nr<0||nc>=COLS||nr>=ROWS) continue;
      if(country[nr*COLS+nc]===other){ dist[i] = 0; q.push(i); break; }
    }
  }
  for(let h=0;h<q.length;h++){
    const i = q[h], c = i%COLS, r = (i/COLS)|0;
    if(dist[i]>=d) continue;
    for(const [dc,dr] of DIRS4){
      const nc=c+dc, nr=r+dr; if(nc<0||nr<0||nc>=COLS||nr>=ROWS) continue;
      const j = nr*COLS+nc;
      if(dist[j]<0 && land[j] && (country[j]===a || country[j]===b)){ dist[j] = dist[i]+1; q.push(j); }
    }
  }
  const band = new Uint8Array(N), maxRow = minLat===undefined ? ROWS : proj([LON0, minLat])[1];
  for(let i=0;i<N;i++) if(dist[i]>=0 && (i/COLS|0)<maxRow) band[i] = 1;
  (passes||[]).forEach(p=> forDiskCells(p, 7, i=>{ band[i] = 0; }));
  for(let i=0;i<N;i++) if(band[i]) mountain[i] = 1;
}
borderBand(COUNTRY.CHN, COUNTRY.LAO, 5);
borderBand(COUNTRY.CHN, COUNTRY.MMR, 5);
// Siam–Burma: Mae Sai (Chiang Saen–Kengtung), Mae Sot, Three Pagodas, Singkhon; open south of the
// Singkhon pass, where the Kra isthmus is too narrow for a band
borderBand(COUNTRY.THA, COUNTRY.MMR, 3, [[99.88,20.43],[98.57,16.7],[98.4,15.3],[99.6,11.75]], 12.0);
// Cardamom mountains
fillRings(mountain, [[[102.85,12.35],[103.55,12.4],[104.0,12.0],[104.05,11.45],[103.65,11.05],[103.2,11.35],[102.95,11.8]].map(proj)], 1);
for(let i=0;i<N;i++) if(!land[i]) mountain[i] = 0;

// ---------------- territories ----------------
const CONTS = [
  ['Đàng Ngoài', '#d35454'], ['Tây Sơn', '#2e9e5b'], ['Tây Nguyên', '#8fae3e'], ['Gia Định', '#4a90d9'],
  ['Chân Lạp', '#9b5de5'], ['Xiêm', '#e8b931'], ['Lan Na', '#e07ac0'], ['Lan Xang', '#ff8c42'],
  ['Miến', '#5d6b85'], ['Nhà Thanh', '#a0522d'],
];
// [name, lon, lat, continent]
const T = [
  // Đàng Ngoài (Lê–Trịnh)
  ['Thăng Long',105.7,21.05,'Đàng Ngoài'], ['Kinh Bắc',106.25,21.45,'Đàng Ngoài'], ['Hải Dương',106.45,20.85,'Đàng Ngoài'],
  ['Sơn Nam',106.05,20.35,'Đàng Ngoài'], ['An Quảng',107.3,21.15,'Đàng Ngoài'], ['Lạng Sơn',106.75,21.9,'Đàng Ngoài'],
  ['Cao Bằng',106.15,22.65,'Đàng Ngoài'], ['Tuyên Quang',105.15,22.1,'Đàng Ngoài'], ['Thanh Hoa',105.65,19.85,'Đàng Ngoài'],
  ['Nghệ An',105.45,18.75,'Đàng Ngoài'],
  // Tây Sơn
  ['Bố Chính',106.35,17.75,'Tây Sơn'], ['Phú Xuân',107.35,16.5,'Tây Sơn'], ['Quảng Nam',108.1,15.7,'Tây Sơn'],
  ['Quảng Ngãi',108.75,14.95,'Tây Sơn'], ['Quy Nhơn',109.0,13.9,'Tây Sơn'], ['Diên Khánh',109.05,12.4,'Tây Sơn'],
  ['Bình Thuận',108.2,11.2,'Tây Sơn'],
  // Tây Nguyên (Jarai "Thủy Xá – Hỏa Xá", Ê Đê)
  ['Thủy Xá',107.85,14.5,'Tây Nguyên'], ['Hỏa Xá',108.05,13.5,'Tây Nguyên'], ['Ê Đê',108.1,12.45,'Tây Nguyên'],
  // Gia Định
  ['Gia Định',106.6,10.8,'Gia Định'], ['Biên Hòa',107.15,11.3,'Gia Định'], ['Mỹ Tho',106.3,10.3,'Gia Định'],
  ['Vĩnh Long',105.8,9.9,'Gia Định'], ['Hà Tiên',104.75,10.25,'Gia Định'], ['Cà Mau',105.1,9.1,'Gia Định'],
  // Chân Lạp
  ['U Đông',104.7,11.6,'Chân Lạp'], ['Cần Bột',104.2,10.8,'Chân Lạp'], ['Kampong Thom',105.0,12.6,'Chân Lạp'],
  ['Xiêm Riệp',103.9,13.5,'Chân Lạp'], ['Bát Tam Bang',103.0,13.0,'Chân Lạp'], ['Stung Treng',106.2,13.4,'Chân Lạp'],
  // Xiêm
  ['Băng Cốc',100.5,13.7,'Xiêm'], ['Ayutthaya',100.6,14.6,'Xiêm'], ['Chanthaburi',102.1,12.7,'Xiêm'],
  ['Khorat',102.1,15.0,'Xiêm'], ['Nakhon Sawan',100.1,15.7,'Xiêm'], ['Phitsanulok',100.3,16.9,'Xiêm'],
  ['Kanchanaburi',99.3,14.4,'Xiêm'], ['Phetchaburi',99.8,12.6,'Xiêm'], ['Chumphon',99.15,10.7,'Xiêm'], ['Ligor',99.9,8.6,'Xiêm'],
  // Lan Na
  ['Chiang Mai',98.95,18.8,'Lan Na'], ['Chiang Saen',100.0,20.0,'Lan Na'], ['Nan',100.8,18.8,'Lan Na'],
  ['Lampang',99.55,18.1,'Lan Na'],
  // Lan Xang (Luang Prabang = Nam Chưởng, Vientiane = Vạn Tượng, Champasak)
  ['Nam Chưởng',102.15,19.9,'Lan Xang'], ['Vạn Tượng',102.6,17.95,'Lan Xang'], ['Sakon',104.1,17.2,'Lan Xang'],
  ['Roi Et',103.6,16.0,'Lan Xang'], ['Ubon',104.9,15.3,'Lan Xang'], ['Champasak',105.85,14.6,'Lan Xang'],
  // Miến (Konbaung)
  ['A Va',96.1,21.8,'Miến'], ['Shan',97.3,20.9,'Miến'], ['Kengtung',99.6,21.2,'Miến'], ['Toungoo',96.45,19.1,'Miến'], ['Pegu',96.4,17.4,'Miến'],
  ['Mottama',97.6,16.6,'Miến'], ['Tavoy',98.3,14.0,'Miến'], ['Mergui',98.7,12.0,'Miến'],
  // Nhà Thanh (Yunnan, Guangxi, Hainan)
  ['Côn Minh',102.7,24.9,'Nhà Thanh'], ['Mông Tự',103.4,23.4,'Nhà Thanh'], ['Phổ Nhĩ',101.0,22.8,'Nhà Thanh'],
  ['Bách Sắc',106.6,23.9,'Nhà Thanh'], ['Nam Ninh',108.1,22.9,'Nhà Thanh'], ['Liêm Châu',109.4,21.75,'Nhà Thanh'], ['Quỳnh Châu',109.8,19.3,'Nhà Thanh'],
];
// sea lanes: Tây Sơn fleet to Vị Hoàng (1786), Quy Nhơn–Gia Định campaigns, Nguyễn Ánh to Bangkok, Qiongzhou strait
const LINKS = [['Phú Xuân','Sơn Nam'], ['Quy Nhơn','Gia Định'], ['Hà Tiên','Băng Cốc'], ['Quỳnh Châu','Liêm Châu']];

const playable = new Uint8Array(N);
for(let i=0;i<N;i++) playable[i] = land[i] && !mountain[i] ? 1 : 0;
const seeds = T.map(([name,lon,lat])=>{
  const [x,y] = proj([lon,lat]);
  let c0 = Math.floor(x), r0 = Math.floor(y), best = -1, bd = Infinity;
  for(let r=r0-25;r<=r0+25;r++) for(let c=c0-25;c<=c0+25;c++){
    if(r<0||c<0||r>=ROWS||c>=COLS || !playable[r*COLS+c]) continue;
    const d = (c-c0)**2+(r-r0)**2;
    if(d<bd){ bd = d; best = r*COLS+c; }
  }
  if(best<0) throw new Error('no land near '+name);
  if(bd>4) console.log(`  seed moved ${Math.sqrt(bd).toFixed(1)} cells: ${name}`);
  return best;
});
core.mapRng = core.seedRng(1786);
const weight = core.makeNoiseWeight(COLS, ROWS, 12, 0.35, false);
const label = core.weightedVoronoi(COLS, ROWS, playable, seeds, weight, null, false);
const landIdxs = []; for(let i=0;i<N;i++) if(playable[i]) landIdxs.push(i);
// on the Kra isthmus the Siamese strip is only a few cells wide, and the nearest seed is often a
// Burmese one: hand Siamese cells there back to the Siamese territory next to them
{
  const burmese = new Set(T.map((t,k)=> t[3]==='Miến' ? k : -1).filter(k=>k>=0));
  const row13 = proj([LON0, 13.5])[1], q = [];
  for(const i of landIdxs) if(burmese.has(label[i]) && country[i]===COUNTRY.THA && (i/COLS)>row13) label[i] = -2;
  for(const i of landIdxs) if(label[i]>=0 && !burmese.has(label[i])) q.push(i);
  for(let h=0;h<q.length;h++){
    const i = q[h], c = i%COLS, r = (i/COLS)|0;
    for(const [dc,dr] of DIRS4){
      const nc=c+dc, nr=r+dr; if(nc<0||nr<0||nc>=COLS||nr>=ROWS) continue;
      const j = nr*COLS+nc; if(label[j]===-2){ label[j] = label[i]; q.push(j); }
    }
  }
  for(const i of landIdxs) if(label[i]===-2) label[i] = -1;
}
core.enforceConnectedRegions(COLS, ROWS, landIdxs, label, false);
// land no territory reached (small islands, pockets walled in by mountains): big pieces turn to
// highland, small ones are dropped into the sea
{
  const seen = new Uint8Array(N);
  for(const s of landIdxs){
    if(label[s]>=0 || seen[s]) continue;
    const comp = [s]; seen[s] = 1;
    for(let q=0;q<comp.length;q++){
      const i = comp[q], c = i%COLS, r = (i/COLS)|0;
      for(const [dc,dr] of DIRS4){
        const nc=c+dc, nr=r+dr; if(nc<0||nr<0||nc>=COLS||nr>=ROWS) continue;
        const j = nr*COLS+nc; if(playable[j] && label[j]<0 && !seen[j]){ seen[j]=1; comp.push(j); }
      }
    }
    comp.forEach(i=>{ if(comp.length>=40) mountain[i] = 1; else land[i] = 0; });
  }
}
const cellTerritory = new Array(N).fill(-1);
for(const i of landIdxs) if(label[i]>=0) cellTerritory[i] = label[i]+1;

// ---------------- rivers ----------------
const RIVERS = ['Mekong','Lancang','Hong','Ayeyarwady','Salween','Xun','Hongshui'];
const rivers = [];
RIVERS.forEach(name=> (riverLines[name]||[]).forEach(l=>{
  let cur = [];
  const flush = ()=>{ if(cur.length>=4) rivers.push(cur); cur = []; };
  l.forEach(p=>{
    const [x,y] = proj(p);
    const c = Math.floor(x), r = Math.floor(y);
    const ok = c>=0 && r>=0 && c<COLS && r<ROWS && land[r*COLS+c] && !mountain[r*COLS+c];
    if(!ok){ flush(); return; }
    cur.push(Math.round(x*CELL_SIZE*10)/10, Math.round(y*CELL_SIZE*10)/10);
  });
  flush();
}));

// ---------------- assemble ----------------
const contId = {}; CONTS.forEach(([n],i)=> contId[n] = i+1);
const terrId = name=>{ const i = T.findIndex(t=>t[0]===name); if(i<0) throw new Error('no territory '+name); return i+1; };
const terrCount = {}; T.forEach(t=> terrCount[t[3]] = (terrCount[t[3]]||0)+1);
const obj = {
  name: 'Lê Trịnh – Tây Sơn',
  cols: COLS, rows: ROWS, cellSize: CELL_SIZE,
  cellTerritoryRLE: core.rleEncode(cellTerritory),
  // the game's naming convention: territories in lower case, continents in upper case
  territories: T.map(([name,,,cont],i)=>({ id:i+1, name: core.finalizeTerrName(name), continentId: contId[cont], color: core.PALETTE_TERR[i % core.PALETTE_TERR.length] })),
  continents: CONTS.map(([name,color],i)=>({ id:i+1, name: core.finalizeContName(name), color, bonus: Math.max(2, Math.round(terrCount[name]/2)+1) })),
  nextTerrId: T.length+1, nextContId: CONTS.length+1,
  wrapX: false, wrapY: false,
  links: LINKS.map(([a,b])=> [terrId(a), terrId(b)]),
  mountainRLE: core.rleEncode(Array.from(mountain)),
  rivers,
};

// ---------------- checks ----------------
const map = core.mapFromPlainObject(obj);
const terrs = Object.values(map.territories);
const bad = [];
terrs.forEach(t=>{ if(!t.cells.length) bad.push('empty: '+t.name); });
const comps = core.findConnectedComponents(map);
if(comps.length!==1) bad.push('components: '+comps.map(c=>c.map(id=>map.territories[id].name).join(',')).join(' | '));
Object.values(map.continents).forEach(c=>{
  const ids = terrs.filter(t=>t.continentId===c.id).map(t=>t.id);
  const seen = new Set([ids[0]]), st = [ids[0]];
  while(st.length){ const x = st.pop(); map.territories[x].neighbors.forEach(n=>{ if(ids.includes(n) && !seen.has(n)){ seen.add(n); st.push(n); } }); }
  if(seen.size!==ids.length) bad.push(c.name+' not connected inside: '+ids.filter(i=>!seen.has(i)).map(i=>map.territories[i].name));
});
// shortest path (land only, then with sea lanes) from Thăng Long to Siam
function hops(from, toCont, useLinks){
  const dist = {[from]:0}, prev = {}, q = [from];
  for(let h=0;h<q.length;h++){
    const x = q[h];
    if(map.territories[x].continentId===toCont){ const p = []; for(let y=x; y!==undefined; y=prev[y]) p.unshift(map.territories[y].name); return p; }
    const ns = new Set(map.territories[x].neighbors);
    if(!useLinks) obj.links.forEach(([a,b])=>{ if(a===x) ns.delete(b); if(b===x) ns.delete(a); });
    ns.forEach(n=>{ if(dist[n]===undefined){ dist[n] = dist[x]+1; prev[n] = x; q.push(n); } });
  }
  return null;
}
const p1 = hops(terrId('Thăng Long'), contId['Xiêm'], false), p2 = hops(terrId('Thăng Long'), contId['Xiêm'], true);
console.log('Thăng Long → Xiêm by land: '+(p1 ? p1.join(' → ') : 'none'));
console.log('Thăng Long → Xiêm with sea lanes: '+(p2 ? p2.join(' → ') : 'none'));
const sizes = terrs.map(t=>t.cells.length).sort((a,b)=>a-b);
console.log(`grid ${COLS}x${ROWS}; territories ${terrs.length}; cells min ${sizes[0]} median ${sizes[sizes.length>>1]} max ${sizes[sizes.length-1]}`);
console.log('smallest:', terrs.slice().sort((a,b)=>a.cells.length-b.cells.length).slice(0,6).map(t=>t.name+' '+t.cells.length).join(', '));
console.log('unfit for 3 badges:', terrs.filter(t=>!core.territoryFitsBadges(map, t.cells)).map(t=>t.name).join(', ') || 'none');
if(process.env.NB) terrs.forEach(t=> console.log('  '+t.name+': '+[...t.neighbors].map(n=>map.territories[n].name).join(', ')));
console.log('continents:', Object.values(map.continents).map(c=>c.name+' '+terrs.filter(t=>t.continentId===c.id).length+' (+'+c.bonus+')').join(', '));
if(bad.length){ console.log('PROBLEMS:\n  '+bad.join('\n  ')); }
const out = JSON.stringify(obj);
fs.writeFileSync(path.join(repo, 'src', 'maps', 'tay-son.json'), out);
console.log(`wrote ${out.length} bytes`);
