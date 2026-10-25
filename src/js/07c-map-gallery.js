/* =========================================================================
   MAP GALLERY — the setup screen's map picker
   ---------------------------------------------------------------------
   "Ngẫu nhiên" plus every map in MAP_GALLERY (src/maps/*.json, inlined by build.js). Picking one
   replaces mapData, which is what the game is then started on. Offline games only: an online
   game's map is made by the server.
   ========================================================================= */

// The map as a small picture: every cell in the color of its territory's continent, water dark.
function drawMapThumb(canvas, entry){
  const W = 132, H = Math.round(W*entry.rows/entry.cols);
  canvas.width = W; canvas.height = H;
  const contColor = {};
  entry.continents.forEach(c=>{ contColor[c.id] = c.color; });
  const terrColor = {};
  entry.territories.forEach(t=>{ terrColor[t.id] = contColor[t.continentId] || t.color; });
  const small = document.createElement('canvas');
  small.width = entry.cols; small.height = entry.rows;
  const sctx = small.getContext('2d'), img = sctx.createImageData(entry.cols, entry.rows);
  const cells = plainCellTerritory(entry);
  for(let i=0;i<cells.length;i++){
    const col = terrColor[cells[i]];
    const hex = col ? parseInt(col.slice(1),16) : 0x0d3550;
    img.data[i*4] = hex>>16; img.data[i*4+1] = (hex>>8)&255; img.data[i*4+2] = hex&255; img.data[i*4+3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, W, H);
}

// A map that came from the editor (or a file) and is waiting in the setup screen: kept here so
// picking a gallery map and changing one's mind doesn't throw away what was just drawn. Set by
// goToSetup() on the way in.
let setupCustomMap = null;

function selectRandomMap(){
  const {cols, rows, numTerr, numCont} = computeMapGenPlan(RUNTIME_CONFIG.mapWrapX!==false);
  mapData = generateRandomMap(cols, rows, numTerr, numCont, 'Bản đồ ngẫu nhiên', 0.28);
  mapData._quickPlay = true;
}
function selectGalleryMap(entry){
  mapData = mapFromPlainObject(entry);
  mapData._galleryId = entry.id;
}

function renderMapGallery(){
  const row = $('mapGalleryRow');
  row.hidden = setupForOnline;
  if(setupForOnline) return;
  const wrap = $('mapGallery');
  wrap.innerHTML = '';
  const addCard = (selected, thumb, title, sub, onPick)=>{
    const card = el('button','map-card'+(selected?' selected':''));
    card.type = 'button';
    card.appendChild(thumb);
    card.appendChild(el('b','',title));
    card.appendChild(el('small','',sub));
    card.addEventListener('click', ()=>{ onPick(); renderSetupMapInfo(); renderMapGallery(); });
    wrap.appendChild(card);
  };
  if(setupCustomMap){
    const mine = setupCustomMap;
    addCard(mapData===mine, el('div','map-thumb-random','✏️'), 'Bản đồ của bạn', `"${mine.name}" · ${Object.keys(mine.territories).length} lãnh thổ`, ()=>{ mapData = mine; });
  }
  addCard(!!mapData._quickPlay, el('div','map-thumb-random','🎲'), 'Ngẫu nhiên', 'Mỗi ván một bản đồ mới', selectRandomMap);
  MAP_GALLERY.forEach(entry=>{
    const canvas = document.createElement('canvas');
    drawMapThumb(canvas, entry);
    addCard(mapData._galleryId===entry.id, canvas, entry.name,
      `${entry.territories.length} lãnh thổ · ${entry.continents.length} châu lục`, ()=> selectGalleryMap(entry));
  });
}
