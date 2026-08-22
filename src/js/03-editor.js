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
  const cols=100, rows=100;
  mapData = generateRandomMap(cols, rows, Math.max(8,Math.round(cols*rows/50)), 6, "Bản đồ của tôi", getWaterRatio(), getWaterSpread());
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
    contSel.addEventListener('change', ()=>{ t.continentId = contSel.value? Number(contSel.value): null; drawEditorCanvas(); });
    const actions = el('div','row-actions');
    const delBtn = el('button','mini-btn','✕'); delBtn.title='Xoá lãnh thổ';
    delBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      t.cells.forEach(([c,r])=>{ mapData.cellTerritory[cellIndex(mapData,c,r)] = -1; });
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
  ctx.fillStyle = '#123a56';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  for(let r=0;r<mapData.rows;r++){
    for(let c=0;c<mapData.cols;c++){
      const id = mapData.cellTerritory[cellIndex(mapData,c,r)];
      if(id===-1) continue;
      const t = mapData.territories[id];
      if(!t) continue;
      if(editorShowContinents){
        const cont = t.continentId!=null ? mapData.continents[t.continentId] : null;
        ctx.fillStyle = cont ? cont.color : '#3a3f52';
      } else {
        ctx.fillStyle = t.color;
      }
      ctx.fillRect(c*cs, r*cs, cs, cs);
    }
  }
  // borders: thin between territories, thicker between continents when in continent view
  for(let r=0;r<mapData.rows;r++){
    for(let c=0;c<mapData.cols;c++){
      const id = mapData.cellTerritory[cellIndex(mapData,c,r)];
      const idR = c+1<mapData.cols? mapData.cellTerritory[cellIndex(mapData,c+1,r)] : id;
      const idD = r+1<mapData.rows? mapData.cellTerritory[cellIndex(mapData,c,r+1)] : id;
      if(editorShowContinents){
        const t = mapData.territories[id];
        const contId = t? t.continentId : null;
        const tR = mapData.territories[idR]; const contR = tR? tR.continentId : null;
        const tD = mapData.territories[idD]; const contD = tD? tD.continentId : null;
        ctx.lineWidth = (idR!==id && contR!==contId) ? 3 : 1;
        ctx.strokeStyle = (idR!==id && contR!==contId) ? 'rgba(255,255,255,0.85)' : 'rgba(10,14,24,0.5)';
        if(idR!==id){ ctx.beginPath(); ctx.moveTo((c+1)*cs,r*cs); ctx.lineTo((c+1)*cs,(r+1)*cs); ctx.stroke(); }
        ctx.lineWidth = (idD!==id && contD!==contId) ? 3 : 1;
        ctx.strokeStyle = (idD!==id && contD!==contId) ? 'rgba(255,255,255,0.85)' : 'rgba(10,14,24,0.5)';
        if(idD!==id){ ctx.beginPath(); ctx.moveTo(c*cs,(r+1)*cs); ctx.lineTo((c+1)*cs,(r+1)*cs); ctx.stroke(); }
      } else {
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(10,14,24,0.9)';
        if(idR!==id){ ctx.beginPath(); ctx.moveTo((c+1)*cs,r*cs); ctx.lineTo((c+1)*cs,(r+1)*cs); ctx.stroke(); }
        if(idD!==id){ ctx.beginPath(); ctx.moveTo(c*cs,(r+1)*cs); ctx.lineTo((c+1)*cs,(r+1)*cs); ctx.stroke(); }
      }
    }
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
      ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.fillText(label, pos.x+1, pos.y+1);
      ctx.fillStyle='#fff'; ctx.fillText(label, pos.x, pos.y);
    });
  }
  // highlight current territory selection border
  if(editorCurrentTerrId && mapData.territories[editorCurrentTerrId]){
    ctx.strokeStyle = '#fff';
    ctx.lineWidth=1;
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
  const out = {
    name: mapData.name, cols: mapData.cols, rows: mapData.rows, cellSize: mapData.cellSize,
    cellTerritory: Array.from(mapData.cellTerritory),
    territories: Object.values(mapData.territories).map(t=>({id:t.id,name:t.name,continentId:t.continentId,color:t.color})),
    continents: Object.values(mapData.continents).map(c=>({id:c.id,name:c.name,color:c.color,bonus:c.bonus})),
    nextTerrId: mapData.nextTerrId, nextContId: mapData.nextContId
  };
  const blob = new Blob([JSON.stringify(out,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = (mapData.name||'map').replace(/[^a-z0-9_\- ]/gi,'')+'.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importMapJSON(obj){
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
  mapData = map;
  $('mapNameInput').value = mapData.name;
  $('gridCols').value = mapData.cols; $('gridRows').value = mapData.rows;
  editorCurrentTerrId = null;
  renderEditorLists(); drawEditorCanvas();
}

