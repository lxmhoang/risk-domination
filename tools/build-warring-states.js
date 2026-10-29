#!/usr/bin/env node
"use strict";
/* =========================================================================
   Builds src/maps/warring-states.json — China in the Warring States period (~260 BC).
   ---------------------------------------------------------------------
   Coastline, lakes and rivers come from Natural Earth (public domain, 1:50m). Download these
   three files into one folder first:
     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson
     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_lakes.geojson
     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_rivers_lake_centerlines.geojson
   then: node build.js && node tools/build-warring-states.js <that folder>

   Territories are the cells nearest each city's seed point (noise-weighted, through land only, so
   mountain ranges and the highlands steer the borders); a territory's continent is its state.
   Mountains (map.mountain) are impassable: the highlands/deserts around the playable world, plus
   ranges drawn as polylines below — a pass is just a gap between two polylines of a range.
   ========================================================================= */
const fs = require('fs'), path = require('path');
const repo = path.join(__dirname, '..');
const neDir = process.argv[2];
if(!neDir){ console.error('usage: node tools/build-warring-states.js <natural-earth-geojson-folder>'); process.exit(1); }
const core = require(path.join(repo, 'dist', 'core.js'))(JSON.parse(fs.readFileSync(path.join(repo, 'src', 'config.json'), 'utf8')), {});

// ---------------- grid / projection ----------------
const LON0 = 99.0, LON1 = 124.5, LAT0 = 20.0, LAT1 = 44.0;
const K = Math.cos(33*Math.PI/180);
const ROWS = 470, CELL_DEG = (LAT1-LAT0)/ROWS;
const COLS = Math.round((LON1-LON0)*K/CELL_DEG);
const CELL_SIZE = 2;
const proj = ([lon,lat])=> [(lon-LON0)*K/CELL_DEG, (LAT1-lat)/CELL_DEG];
const N = COLS*ROWS;

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
function geoPolys(file){
  const g = JSON.parse(fs.readFileSync(path.join(neDir, file), 'utf8'));
  const polys = [];
  g.features.forEach(f=>{
    const geom = f.geometry; if(!geom) return;
    const list = geom.type==='Polygon' ? [geom.coordinates] : geom.type==='MultiPolygon' ? geom.coordinates : [];
    list.forEach(p=>{
      const inBox = p[0].some(([x,y])=> x>LON0-3 && x<LON1+3 && y>LAT0-3 && y<LAT1+3);
      if(inBox) polys.push(p.map(ring=> ring.map(proj)));
    });
  });
  return polys;
}

// ---------------- land ----------------
const land = new Uint8Array(N);
geoPolys('ne_50m_land.geojson').forEach(p=> fillRings(land, p, 1));
geoPolys('ne_50m_lakes.geojson').forEach(p=> fillRings(land, p, 0));

// ---------------- impassable terrain ----------------
const mountain = new Uint8Array(N);
// Highlands / deserts outside the playable world: Tibet-Qinghai, Yunnan & NW Vietnam highlands, the
// Badain Jaran/Tengger deserts and the Gobi.
const WILD = [
  [[98.5,44.5],[98.5,39.3],[99.5,38.9],[101.0,38.0],[102.5,37.0],[102.6,35.6],[103.0,34.2],[103.0,32.6],[103.3,31.2],
   [103.1,30.0],[102.9,29.0],[103.6,27.8],[104.6,26.6],[104.4,24.5],[104.2,23.0],[104.6,21.8],[105.1,20.8],[105.4,19.5],[98.5,19.5]],
  [[98.5,44.5],[98.5,40.6],[101.5,39.6],[103.2,39.0],[104.6,38.7],[105.6,39.4],[106.1,40.2],[106.0,41.6],[108.0,42.9],[110.2,43.4],[112.2,44.5]],
];
WILD.forEach(poly=> fillRings(mountain, [poly.map(proj)], 1));
// Mountain ranges inside the world, as polylines; a pass is simply a gap between two of them.
const RANGES = {
  // Tần Lĩnh — gaps: Tà Cốc (Baoxie road, ~107.5) and Võ Quan (~110.6)
  qinling: [
    [[103.0,34.25],[104.5,34.15],[105.8,34.2],[107.25,34.15]],
    [[107.75,34.05],[108.8,33.95],[109.8,33.95],[110.4,33.95]],
    [[110.8,33.95],[111.6,33.8],[112.4,33.6],[112.85,33.4]],
  ],
  // Hào sơn north to the Yellow River — gap at Hàm Cốc quan by the river
  hangu: [[[110.45,34.0],[110.75,34.35],[110.85,34.48]]],
  // Lục Bàn sơn — the Lũng road passes south of its end
  liupan: [[[106.2,36.8],[106.3,35.8],[106.55,35.15]]],
  // Mễ Thương / Đại Ba sơn — gap at Kiếm Môn (Jinniu road)
  daba: [
    [[103.0,32.6],[104.3,32.6],[105.2,32.4]],
    [[105.85,32.3],[107.0,32.2],[108.5,31.9],[109.6,31.65],[110.4,31.65]],
  ],
  // Vu sơn — gap at the Three Gorges
  wu: [
    [[110.45,32.3],[110.3,31.65],[110.2,31.25]],
    [[110.1,30.8],[109.9,30.0],[109.6,29.3],[109.2,28.6]],
  ],
  // Lã Lương sơn (west Shanxi) — closed
  luliang: [[[111.4,38.9],[111.3,37.7],[111.05,36.6],[110.9,36.0]]],
  // Thái Hành sơn — gaps: Tỉnh Hình, Phủ Khẩu, Thái Hành hình
  taihang: [
    [[115.5,39.95],[114.95,39.4],[114.4,38.6],[114.25,38.25]],
    [[114.05,37.85],[113.9,37.2],[113.85,36.8]],
    [[113.85,36.42],[113.75,35.9],[113.6,35.58]],
    [[113.25,35.38],[112.6,35.2]],
  ],
  // Âm Sơn — gap north of the Hetao bend
  yinshan: [
    [[106.6,40.8],[107.6,41.15],[109.0,41.35]],
    [[109.6,41.35],[110.8,41.25],[112.0,41.1]],
  ],
  // Yên Sơn — gaps: Cư Dung quan, Cổ Bắc khẩu, and the coastal road (Sơn Hải quan)
  yanshan: [
    [[115.4,40.1],[115.85,40.22]],
    [[116.3,40.42],[116.9,40.55]],
    [[117.42,40.6],[118.2,40.4],[119.2,40.15]],
  ],
  // Đồng Bách / Đại Biệt sơn — gap at the Nghĩa Dương passes
  dabie: [
    [[112.95,32.6],[113.6,32.25],[113.85,32.05]],
    [[114.3,31.75],[115.2,31.3],[116.3,30.95],[116.7,30.7]],
  ],
  // Ngũ Lĩnh — gaps: Linh Cừ (Xiang–Li) and Mai Lĩnh; then Vũ Di sơn — gap at Phân Thủy quan
  nanling: [
    [[108.8,26.2],[109.8,25.95],[110.45,25.75]],
    [[110.9,25.45],[112.0,25.3],[113.0,25.2],[113.85,25.2]],
    [[114.75,25.2],[115.6,24.9],[116.4,24.7],[116.6,25.6],[117.2,26.6],[117.45,27.15]],
    [[117.95,27.75],[118.7,28.4],[119.0,28.9]],
  ],
};
const HALF_W = 2.7; // cells
function stampLine(line){
  const pts = line.map(proj);
  for(let i=0;i+1<pts.length;i++){
    const [x0,y0] = pts[i], [x1,y1] = pts[i+1];
    const minC = Math.floor(Math.min(x0,x1)-HALF_W-1), maxC = Math.ceil(Math.max(x0,x1)+HALF_W+1);
    const minR = Math.floor(Math.min(y0,y1)-HALF_W-1), maxR = Math.ceil(Math.max(y0,y1)+HALF_W+1);
    const dx = x1-x0, dy = y1-y0, L2 = dx*dx+dy*dy;
    for(let r=Math.max(0,minR); r<=Math.min(ROWS-1,maxR); r++) for(let c=Math.max(0,minC); c<=Math.min(COLS-1,maxC); c++){
      const px = c+0.5, py = r+0.5;
      const t = Math.max(0, Math.min(1, ((px-x0)*dx+(py-y0)*dy)/L2));
      const d = Math.hypot(px-(x0+t*dx), py-(y0+t*dy));
      if(d<=HALF_W) mountain[r*COLS+c] = 1;
    }
  }
}
Object.values(RANGES).forEach(lines=> lines.forEach(stampLine));
for(let i=0;i<N;i++) if(!land[i]) mountain[i] = 0;

// ---------------- territories ----------------
// [name, lon, lat, continent]
const CONTS = [
  ['Tần',  '#5d6b85'], ['Sở', '#2e9e5b'], ['Tề', '#e8b931'], ['Yên', '#4a90d9'], ['Triệu', '#d35454'],
  ['Ngụy', '#9b5de5'], ['Hàn', '#e07ac0'], ['Thảo Nguyên', '#8fae3e'], ['Bách Việt', '#ff8c42'],
];
const T = [
  // Tần
  ['Hàm Dương',108.9,34.4,'Tần'], ['Lũng Tây',104.6,35.3,'Tần'], ['Thượng Quận',109.5,37.6,'Tần'],
  ['Hà Đông',111.45,35.8,'Tần'], ['Hán Trung',107.2,33.1,'Tần'], ['Thục',104.0,30.6,'Tần'],
  ['Ba',106.8,29.9,'Tần'], ['Nam Dương',112.4,33.0,'Tần'], ['Nam Quận',111.8,30.9,'Tần'],
  // Triệu
  ['Hàm Đan',114.55,37.05,'Triệu'], ['Cự Lộc',115.6,37.6,'Triệu'], ['Trung Sơn',115.05,38.45,'Triệu'],
  ['Tấn Dương',112.4,37.8,'Triệu'], ['Thượng Đảng',113.0,36.1,'Triệu'], ['Đại',113.6,39.7,'Triệu'],
  ['Vân Trung',111.4,40.5,'Triệu'],
  // Hàn
  ['Tân Trịnh',113.55,34.2,'Hàn'], ['Lạc Dương',111.85,34.5,'Hàn'], ['Dã Vương',113.65,35.15,'Hàn'],
  // Ngụy
  ['Đại Lương',114.45,34.7,'Ngụy'], ['Nghiệp',114.35,35.85,'Ngụy'], ['Bộc Dương',115.55,35.6,'Ngụy'],
  ['Tuy Dương',115.6,34.35,'Ngụy'],
  // Tề
  ['Lâm Truy',118.3,36.8,'Tề'], ['Tức Mặc',120.4,36.6,'Tề'], ['Cử',118.9,35.6,'Tề'],
  ['Lịch Hạ',116.9,36.6,'Tề'], ['Lỗ',117.0,35.5,'Tề'], ['Bình Nguyên',116.6,37.7,'Tề'],
  // Yên
  ['Kế',116.3,39.9,'Yên'], ['Hạ Đô',115.9,39.3,'Yên'], ['Thượng Cốc',115.4,40.6,'Yên'],
  ['Ngư Dương',117.2,41.0,'Yên'], ['Hữu Bắc Bình',118.8,41.0,'Yên'], ['Liêu Tây',120.8,41.4,'Yên'],
  ['Liêu Đông',122.9,41.0,'Yên'],
  // Sở
  ['Trần',114.9,33.7,'Sở'], ['Thọ Xuân',116.8,32.5,'Sở'], ['Bành Thành',117.3,34.3,'Sở'],
  ['Quảng Lăng',119.4,32.6,'Sở'], ['Ngô',120.6,31.3,'Sở'], ['Cối Kê',120.6,29.9,'Sở'],
  ['Giang Hạ',114.4,30.6,'Sở'], ['Trường Sa',112.9,28.0,'Sở'], ['Kiềm Trung',110.0,28.4,'Sở'],
  ['Dự Chương',115.9,28.4,'Sở'],
  // Thảo Nguyên (Hung Nô, Đông Hồ & the steppe)
  ['Nguyệt Thị',101.3,38.7,'Thảo Nguyên'], ['Hà Sáo',108.8,39.0,'Thảo Nguyên'], ['Âm Sơn',107.8,40.9,'Thảo Nguyên'],
  ['Mạc Nam',110.8,42.4,'Thảo Nguyên'], ['Sơn Nhung',115.5,42.3,'Thảo Nguyên'], ['Đông Hồ',118.6,42.8,'Thảo Nguyên'],
  ['Ô Hoàn',121.8,43.2,'Thảo Nguyên'],
  // Bách Việt
  ['Mân Việt',119.0,26.2,'Bách Việt'], ['Đông Âu',120.4,28.2,'Bách Việt'], ['Nam Việt',113.5,23.4,'Bách Việt'],
  ['Tây Âu',109.8,24.0,'Bách Việt'], ['Dạ Lang',106.7,26.6,'Bách Việt'], ['Âu Lạc',105.85,21.1,'Bách Việt'],
];
const playable = new Uint8Array(N);
for(let i=0;i<N;i++) playable[i] = land[i] && !mountain[i] ? 1 : 0;
// seeds: the city's cell, or the nearest playable cell to it
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
core.mapRng = core.seedRng(260);
const weight = core.makeNoiseWeight(COLS, ROWS, 12, 0.35, false);
const label = core.weightedVoronoi(COLS, ROWS, playable, seeds, weight, null, false);
const landIdxs = []; for(let i=0;i<N;i++) if(playable[i]) landIdxs.push(i);
core.enforceConnectedRegions(COLS, ROWS, landIdxs, label, false);
// land no territory reached (islands like Taiwan, pockets walled in by mountains): big pieces turn
// to highland, small ones are dropped into the sea
{
  const seen = new Uint8Array(N);
  for(const s of landIdxs){
    if(label[s]>=0 || seen[s]) continue;
    const comp = [s]; seen[s] = 1;
    for(let q=0;q<comp.length;q++){
      const i = comp[q], c = i%COLS, r = (i/COLS)|0;
      for(const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]){
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
const RIVERS = new Set(['Huang','Chang Jiang','Yangtze','Han','Gan','Yuan','Xi','Xun','Quan','Hong','Liao','Min']);
const rivers = [];
{
  const g = JSON.parse(fs.readFileSync(path.join(neDir, 'ne_50m_rivers_lake_centerlines.geojson'), 'utf8'));
  g.features.forEach(f=>{
    if(!RIVERS.has(f.properties.name) || f.properties.featurecla!=='River') return;
    const lines = f.geometry.type==='LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    lines.forEach(l=>{
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
    });
  });
}

// ---------------- assemble ----------------
const contId = {}; CONTS.forEach(([n],i)=> contId[n] = i+1);
const terrCount = {}; T.forEach(t=> terrCount[t[3]] = (terrCount[t[3]]||0)+1);
const obj = {
  name: 'Chiến Quốc',
  cols: COLS, rows: ROWS, cellSize: CELL_SIZE,
  cellTerritoryRLE: core.rleEncode(cellTerritory),
  territories: T.map(([name,,,cont],i)=>({ id:i+1, name, continentId: contId[cont], color: core.PALETTE_TERR[i % core.PALETTE_TERR.length] })),
  continents: CONTS.map(([name,color],i)=>({ id:i+1, name, color, bonus: Math.max(2, Math.round(terrCount[name]/2)+1) })),
  nextTerrId: T.length+1, nextContId: CONTS.length+1,
  wrapX: false, wrapY: false,
  // sea lane across the Bohai strait (Đăng Châu – Liêu Đông)
  links: [[T.findIndex(t=>t[0]==='Tức Mặc')+1, T.findIndex(t=>t[0]==='Liêu Đông')+1]],
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
const sizes = terrs.map(t=>t.cells.length).sort((a,b)=>a-b);
console.log(`grid ${COLS}x${ROWS}; territories ${terrs.length}; cells min ${sizes[0]} median ${sizes[sizes.length>>1]} max ${sizes[sizes.length-1]}`);
console.log('smallest:', terrs.slice().sort((a,b)=>a.cells.length-b.cells.length).slice(0,6).map(t=>t.name+' '+t.cells.length).join(', '));
console.log('unfit for 3 badges:', terrs.filter(t=>!core.territoryFitsBadges(map, t.cells)).map(t=>t.name).join(', ') || 'none');
if(process.env.NB) terrs.forEach(t=> console.log('  '+t.name+': '+[...t.neighbors].map(n=>map.territories[n].name).join(', ')));
console.log('continents:', Object.values(map.continents).map(c=>c.name+' '+terrs.filter(t=>t.continentId===c.id).length+' (+'+c.bonus+')').join(', '));
if(bad.length){ console.log('PROBLEMS:\n  '+bad.join('\n  ')); }
const out = JSON.stringify(obj);
fs.writeFileSync(path.join(repo, 'src', 'maps', 'warring-states.json'), out);
console.log(`wrote ${out.length} bytes`);
