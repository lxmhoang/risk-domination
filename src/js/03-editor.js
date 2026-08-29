/* =========================================================================
   EDITOR
   ========================================================================= */
let editorTool = 'paint';
let editorCurrentTerrId = null;
let editorBrush = 2;
let editorPainting = false;
let editorShowContinents = false;

/* Compute a label position (cell-weighted centroid) for each continent that has territories. */
function computeContinentLabelPositions(map){
  const acc = {};
  Object.values(map.territories).forEach(t=>{
    if(t.continentId==null || t.cells.length===0) return;
    if(!acc[t.continentId]) acc[t.continentId] = {sx:0,sy:0,n:0};
    const a = acc[t.continentId];
    a.sx += t.centroid.x*t.cells.length; a.sy += t.centroid.y*t.cells.length; a.n += t.cells.length;
  });
  const out = {};
  Object.entries(acc).forEach(([cid,a])=>{ out[cid] = {x:a.sx/a.n, y:a.sy/a.n}; });
  return out;
}

function getWaterRatio(){
  const el = document.getElementById('waterRatioInput');
  return el ? Number(el.value)/100 : 0.28;
}
function getWaterSpread(){
  const el = document.getElementById('waterSpreadInput');
  return el ? Number(el.value)/100 : 0.4;
}

function initEditorMap(){
  const {cols, rows, numTerr, numCont} = computeMapGenPlan();
  mapData = generateRandomMap(cols, rows, numTerr, numCont, "Bản đồ của tôi", getWaterRatio(), getWaterSpread());
  $('mapNameInput').value = mapData.name;
  $('gridCols').value = mapData.cols;
  $('gridRows').value = mapData.rows;
  editorCurrentTerrId = null;
  renderEditorLists();
  drawEditorCanvas();
}

function renderEditorLists(){
  $('terrCount').textContent = Object.keys(mapData.territories).length;
  $('contCount').textContent = Object.keys(mapData.continents).length;

  const terrList = $('terrList'); terrList.innerHTML='';
  Object.values(mapData.territories).sort((a,b)=>a.id-b.id).forEach(t=>{
    const row = el('div','terr-row'+(t.id===editorCurrentTerrId?' selected':''));
    const sw = el('div','swatch'); sw.style.background = t.color;
    const nameInput = el('input','name-input terr-name'); nameInput.type='text'; nameInput.value = t.name;
    nameInput.title='Tên lãnh thổ (chỉ chữ, tự động viết thường)';
    nameInput.addEventListener('input', ()=>{
      const pos = nameInput.selectionStart;
      const cleaned = stripInvalidNameChars(nameInput.value);
      if(cleaned!==nameInput.value){ nameInput.value = cleaned; try{ nameInput.setSelectionRange(pos-1,pos-1); }catch(e){} }
    });
    nameInput.addEventListener('change', ()=>{ t.name = finalizeTerrName(nameInput.value) || t.name; nameInput.value = t.name; updateToolbarInfo(); });
    nameInput.addEventListener('click', e=>e.stopPropagation());
    const contSel = el('select'); contSel.style.width='72px'; contSel.style.fontSize='11px';
    contSel.appendChild(el('option','', '—'));
    Object.values(mapData.continents).forEach(c=>{
      const opt = el('option','',c.name); opt.value=c.id;
      if(t.continentId===c.id) opt.selected=true;
      contSel.appendChild(opt);
    });
    contSel.addEventListener('click', e=>e.stopPropagation());
    contSel.addEventListener('change', ()=>{ t.continentId = contSel.value? Number(contSel.value): null; mapData._contBoundaryCache = {}; drawEditorCanvas(); });
    const actions = el('div','row-actions');
    const delBtn = el('button','mini-btn','✕'); delBtn.title='Xoá lãnh thổ';
    delBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      t.cells.forEach(([c,r])=>{ mapData.cellTerritory[cellIndex(mapData,c,r)] = -1; });
      invalidateBoundaryCache(mapData, t.id);
      delete mapData.territories[t.id];
      if(editorCurrentTerrId===t.id) editorCurrentTerrId=null;
      recomputeGraph(mapData); renderEditorLists(); drawEditorCanvas();
    });
    actions.appendChild(delBtn);
    row.appendChild(sw); row.appendChild(nameInput); row.appendChild(contSel); row.appendChild(actions);
    row.addEventListener('click', ()=>{ editorCurrentTerrId = t.id; renderEditorLists(); updateToolbarInfo(); });
    terrList.appendChild(row);
  });

  const contList = $('contList'); contList.innerHTML='';
  Object.values(mapData.continents).sort((a,b)=>a.id-b.id).forEach(c=>{
    const row = el('div','cont-row');
    const top = el('div','cont-row-top');
    const colorInput = el('input'); colorInput.type='color'; colorInput.value=c.color;
    colorInput.style.width='26px'; colorInput.style.height='26px'; colorInput.style.padding='0';
    colorInput.addEventListener('input', ()=>{ c.color = colorInput.value; drawEditorCanvas(); });
    const nameInput = el('input','name-input cont-name'); nameInput.type='text'; nameInput.value=c.name;
    nameInput.title='Tên châu lục (chỉ chữ, tự động viết hoa)';
    nameInput.addEventListener('input', ()=>{
      const pos = nameInput.selectionStart;
      const cleaned = stripInvalidNameChars(nameInput.value);
      if(cleaned!==nameInput.value){ nameInput.value = cleaned; try{ nameInput.setSelectionRange(pos-1,pos-1); }catch(e){} }
    });
    nameInput.addEventListener('change', ()=>{ c.name = finalizeContName(nameInput.value) || c.name; nameInput.value = c.name; drawEditorCanvas(); });
    const delBtn = el('button','mini-btn','✕'); delBtn.title='Xoá châu lục';
    delBtn.addEventListener('click', ()=>{
      Object.values(mapData.territories).forEach(t=>{ if(t.continentId===c.id) t.continentId=null; });
      delete mapData.continents[c.id];
      mapData._contBoundaryCache = {};
      renderEditorLists(); drawEditorCanvas();
    });
    top.appendChild(colorInput); top.appendChild(nameInput); top.appendChild(delBtn);

    const bonusRow = el('div','cont-row-bonus');
    const bonusLabel = el('span','bonus-label','Quân thưởng mỗi lượt');
    const bonusInput = el('input'); bonusInput.type='number'; bonusInput.min='0'; bonusInput.value=c.bonus;
    bonusInput.title='Số quân thưởng khi chiếm trọn châu lục này';
    bonusInput.addEventListener('change', ()=>{ c.bonus = Math.max(0, Number(bonusInput.value)||0); });
    bonusRow.appendChild(bonusLabel); bonusRow.appendChild(bonusInput);

    row.appendChild(top); row.appendChild(bonusRow);
    contList.appendChild(row);
  });
}

function updateToolbarInfo(){
  const bar = $('terrInfoBar');
  if(editorCurrentTerrId && mapData.territories[editorCurrentTerrId]){
    const t = mapData.territories[editorCurrentTerrId];
    bar.innerHTML = `Đang tô: <b style="color:${t.color}">${t.name}</b> — ${t.cells.length} ô — công cụ: <b>${editorTool}</b>`;
  } else {
    bar.textContent = 'Chọn hoặc tạo một lãnh thổ để bắt đầu tô. Công cụ: ' + editorTool;
  }
}

function drawEditorCanvas(){
  const canvas = $('editorCanvas');
  const cs = mapData.cellSize;
  canvas.width = mapData.cols*cs;
  canvas.height = mapData.rows*cs;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = OCEAN_COLOR;
  ctx.fillRect(0,0,canvas.width,canvas.height);

  const terrs = Object.values(mapData.territories).filter(t=>t.cells.length>0);
  terrs.forEach(t=>{
    if(editorShowContinents){
      const cont = t.continentId!=null ? mapData.continents[t.continentId] : null;
      ctx.fillStyle = cont ? cont.color : '#3a3f52';
    } else {
      ctx.fillStyle = t.color;
    }
    pathFromLoops(ctx, getTerritoryBoundaryLoops(mapData, t.id));
    ctx.fill();
  });

  // borders: every territory's own outline, thin; continent outlines drawn thicker on top
  // when in continent view (rather than comparing neighbor-by-neighbor, each continent's own
  // traced outer edge already IS exactly where a thick border belongs).
  terrs.forEach(t=>{
    pathFromLoops(ctx, getTerritoryBoundaryLoops(mapData, t.id));
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(10,14,24,0.9)';
    ctx.stroke();
  });
  if(editorShowContinents){
    Object.values(mapData.continents).forEach(cont=>{
      const loops = getContinentBoundaryLoops(mapData, cont.id);
      if(loops.length===0) return;
      pathFromLoops(ctx, loops);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke();
    });
  }
  // highlight current territory selection border
  if(editorCurrentTerrId && mapData.territories[editorCurrentTerrId] && mapData.territories[editorCurrentTerrId].cells.length){
    pathFromLoops(ctx, getTerritoryBoundaryLoops(mapData, editorCurrentTerrId));
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.stroke();
  }
  // labels
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  Object.values(mapData.territories).forEach(t=>{
    if(t.cells.length===0) return;
    ctx.fillStyle='rgba(0,0,0,0.55)';
    ctx.fillText(t.name, t.centroid.x+1, t.centroid.y+1);
    ctx.fillStyle= editorShowContinents ? 'rgba(255,255,255,0.85)' : '#fff';
    ctx.fillText(t.name, t.centroid.x, t.centroid.y);
  });
  if(editorShowContinents){
    ctx.font = 'bold 17px sans-serif';
    const positions = computeContinentLabelPositions(mapData);
    Object.entries(positions).forEach(([cid,pos])=>{
      const cont = mapData.continents[cid]; if(!cont) return;
      const label = cont.name+' (+'+cont.bonus+')';
      fillTextWithBackground(ctx, label, pos.x, pos.y);
    });
  }
}

function canvasToCell(canvas, evt){
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width/rect.width, scaleY = canvas.height/rect.height;
  const x = (evt.clientX-rect.left)*scaleX;
  const y = (evt.clientY-rect.top)*scaleY;
  const c = Math.floor(x/mapData.cellSize), r = Math.floor(y/mapData.cellSize);
  return [c,r];
}

function applyBrush(c,r,terrId){
  const half = Math.floor(editorBrush/2);
  for(let dr=-half; dr<editorBrush-half; dr++){
    for(let dc=-half; dc<editorBrush-half; dc++){
      paintCell(mapData, c+dc, r+dr, terrId);
    }
  }
}

function editorPointerDown(evt){
  const canvas = $('editorCanvas');
  const [c,r] = canvasToCell(canvas, evt);
  if(!inBounds(mapData,c,r)) return;
  if(editorTool==='pick'){
    const id = mapData.cellTerritory[cellIndex(mapData,c,r)];
    if(id!==-1){ editorCurrentTerrId = id; renderEditorLists(); updateToolbarInfo(); }
    return;
  }
  if(editorTool==='bucket'){
    if(editorCurrentTerrId===null) return;
    bucketFill(mapData, c, r, editorCurrentTerrId);
    recomputeGraph(mapData); drawEditorCanvas(); renderEditorLists();
    return;
  }
  editorPainting = true;
  paintAt(c,r);
}
function paintAt(c,r){
  if(editorTool==='paint'){
    if(editorCurrentTerrId===null) return;
    applyBrush(c,r,editorCurrentTerrId);
  } else if(editorTool==='erase'){
    applyBrush(c,r,-1);
  }
  drawEditorCanvas();
}
function editorPointerMove(evt){
  if(!editorPainting) return;
  const canvas = $('editorCanvas');
  const [c,r] = canvasToCell(canvas, evt);
  if(!inBounds(mapData,c,r)) return;
  paintAt(c,r);
}
function editorPointerUp(){
  if(editorPainting){ editorPainting=false; recomputeGraph(mapData); renderEditorLists(); drawEditorCanvas(); }
}

function validateMap(){
  const msg = $('validateMsg'); msg.classList.remove('hidden');
  const terrs = Object.values(mapData.territories);
  const empty = terrs.filter(t=>t.cells.length===0);
  const noCont = terrs.filter(t=>t.continentId===null);
  const contsEmpty = Object.values(mapData.continents).filter(c=> !terrs.some(t=>t.continentId===c.id));
  // islands separated by water are expected/normal now — just count them for information,
  // don't treat as an error.
  const numIslands = terrs.length ? findConnectedComponents(mapData).length : 0;

  const problems = [];
  if(terrs.length < 4) problems.push('Cần ít nhất 4 lãnh thổ.');
  if(empty.length) problems.push(empty.length+' lãnh thổ chưa được tô (không có ô nào).');
  if(noCont.length) problems.push(noCont.length+' lãnh thổ chưa gán châu lục.');
  if(contsEmpty.length) problems.push(contsEmpty.length+' châu lục không có lãnh thổ nào.');
  if(problems.length===0){
    msg.className='ok';
    msg.textContent = '✓ Bản đồ hợp lệ, sẵn sàng để chơi! ('+terrs.length+' lãnh thổ, '+Object.keys(mapData.continents).length+' châu lục'
      + (numIslands>1 ? ', '+numIslands+' vùng đất tách biệt bởi nước' : '') + ')';
    return true;
  } else {
    msg.className='err'; msg.textContent = '✗ '+problems.join(' ');
    return false;
  }
}

function exportMapJSON(){
  const out = mapToPlainObject(mapData);
  const blob = new Blob([JSON.stringify(out,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = (mapData.name||'map').replace(/[^a-z0-9_\- ]/gi,'')+'.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importMapJSON(obj){
  mapData = mapFromPlainObject(obj);
  $('mapNameInput').value = mapData.name;
  $('gridCols').value = mapData.cols; $('gridRows').value = mapData.rows;
  editorCurrentTerrId = null;
  renderEditorLists(); drawEditorCanvas();
}

