/* =========================================================================
   NAVIGATION / WIRING
   ========================================================================= */
$('btnQuickPlay').addEventListener('click', ()=>{
  mapData = generateRandomMap(40,26,22,6,'Bản đồ ngẫu nhiên', 0.28);
  goToSetup();
});
$('btnOpenEditor').addEventListener('click', ()=>{
  initEditorMap();
  showScreen('screen-editor');
});
$('btnLoadMap').addEventListener('click', ()=> $('loadMapInput').click());
$('loadMapInput').addEventListener('change', (e)=>{
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{ const obj = JSON.parse(reader.result); importMapJSON(obj); showScreen('screen-editor'); }
    catch(err){ alert('Không đọc được file bản đồ: '+err.message); }
  };
  reader.readAsText(file);
  e.target.value='';
});
$('btnOpenSettings').addEventListener('click', ()=>{ renderSettingsScreen(); showScreen('screen-settings'); });
$('btnBackFromSettings').addEventListener('click', ()=> showScreen('screen-menu'));
function renderSettingsScreen(){
  $('settingSpectatorDelay').value = RUNTIME_CONFIG.spectatorModeDelayMs;
  $('settingManualPlacement').checked = !!RUNTIME_CONFIG.manualInitialPlacement;
  $('settingCardAwardEvent').value = RUNTIME_CONFIG.cardAwardEvent;
}
$('settingSpectatorDelay').addEventListener('change', (e)=>{
  const v = clamp(Number(e.target.value)||0, 0, 10000);
  e.target.value = v;
  setConfigValue('spectatorModeDelayMs', v);
});
$('settingManualPlacement').addEventListener('change', (e)=>{
  setConfigValue('manualInitialPlacement', e.target.checked);
});
$('settingCardAwardEvent').addEventListener('change', (e)=>{
  setConfigValue('cardAwardEvent', e.target.value);
});
$('btnSettingsReset').addEventListener('click', ()=>{
  resetRuntimeConfig();
  renderSettingsScreen();
});
$('btnSettingsExport').addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify(pickConfig(RUNTIME_CONFIG), null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = el('a'); a.href = url; a.download = 'config.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
});
$('btnSettingsImport').addEventListener('click', ()=> $('settingsImportInput').click());
$('settingsImportInput').addEventListener('change', (e)=>{
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const obj = JSON.parse(reader.result);
      CONFIG_KEYS.forEach(k=>{ if(obj[k]!==undefined) RUNTIME_CONFIG[k]=obj[k]; });
      saveRuntimeConfig();
      renderSettingsScreen();
    }catch(err){ alert('Không đọc được file config: '+err.message); }
  };
  reader.readAsText(file);
  e.target.value='';
});

$('btnHowTo').addEventListener('click', ()=>{
  alert(
`LUẬT CHƠI (Risk cổ điển):
1. TĂNG VIỆN: Mỗi lượt bạn nhận quân = max(3, số vùng bạn có/3) + điểm thưởng nếu chiếm trọn 1 châu lục.
2. TẤN CÔNG: Chọn vùng của bạn (≥2 quân) tấn công vùng địch liền kề. Đổ xúc xắc: bên tấn công tối đa 3, bên phòng thủ tối đa 2. So sánh xúc xắc cao nhất, hòa thì phòng thủ thắng.
3. CHIẾM VÙNG: Nếu quân địch về 0, bạn chiếm vùng và phải chuyển quân sang đó.
4. TĂNG CƯỜNG: Cuối lượt, di chuyển quân giữa 2 vùng của bạn có đường nối.
5. THẺ BÀI: Mặc định, chiếm được ≥1 vùng trong lượt sẽ nhận 1 thẻ bài (đổi được ở Cài đặt: theo lượt hạ quân địch, hoặc phát tự động mỗi lượt). Đổi 3 thẻ (giống nhau hoặc khác nhau) lấy quân thưởng tăng dần.
6. THẮNG: Người cuối cùng còn lãnh thổ trên bản đồ.`);
});

function goToSetup(){
  $('setupMapInfo').textContent = `Bản đồ: "${mapData.name}" — ${Object.keys(mapData.territories).length} lãnh thổ, ${Object.keys(mapData.continents).length} châu lục.`;
  renderPlayerConfigList();
  showScreen('screen-setup');
}
function renderPlayerConfigList(){
  const wrap = $('playerConfigList'); wrap.innerHTML='';
  const row = el('div','player-config');
  const dot = el('div','pdot'); dot.style.background=PLAYER_COLORS[0].hex;
  const span = el('span','','Bạn (người chơi)');
  const sel = el('select'); sel.id='humanColorSelect';
  PLAYER_COLORS.forEach(c=>{ const opt=el('option','',c.name); opt.value=c.hex; sel.appendChild(opt); });
  sel.addEventListener('change', ()=>{ dot.style.background = sel.value; });
  row.appendChild(dot); row.appendChild(span); row.appendChild(sel);
  wrap.appendChild(row);
}

// Accordion (collapsible sidebar sections)
document.querySelectorAll('.panel-header').forEach(h=>{
  h.addEventListener('click', ()=>{
    h.classList.toggle('collapsed');
    const content = h.nextElementSibling;
    if(content) content.classList.toggle('collapsed');
  });
});

// Continent view toggles
$('toggleContinentView').addEventListener('change', (e)=>{ editorShowContinents = e.target.checked; drawEditorCanvas(); });
$('toggleContinentViewGame').addEventListener('change', (e)=>{ showContinentsGame = e.target.checked; if(game) drawGameCanvas(); });

// Editor wiring
document.querySelectorAll('.tool-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    editorTool = btn.dataset.tool;
    updateToolbarInfo();
  });
});
$('brushSize').addEventListener('input', (e)=>{ editorBrush = Number(e.target.value); });
$('btnNewTerr').addEventListener('click', ()=>{
  const t = createTerritory(mapData);
  editorCurrentTerrId = t.id;
  renderEditorLists(); updateToolbarInfo();
});
$('btnNewCont').addEventListener('click', ()=>{ createContinent(mapData); renderEditorLists(); });
$('waterRatioInput').addEventListener('input', (e)=>{ $('waterRatioLabel').textContent = e.target.value+'%'; });
$('btnRandomGen').addEventListener('click', ()=>{
  if(!confirm('Tạo bản đồ ngẫu nhiên mới sẽ xoá bản đồ hiện tại. Tiếp tục?')) return;
  const cols = Number($('gridCols').value)||40, rows = Number($('gridRows').value)||26;
  mapData = generateRandomMap(cols, rows, Math.max(8,Math.round(cols*rows/50)), 6, $('mapNameInput').value, getWaterRatio());
  editorCurrentTerrId=null; renderEditorLists(); drawEditorCanvas();
});
$('btnClearMap').addEventListener('click', ()=>{
  if(!confirm('Xoá toàn bộ lãnh thổ trên bản đồ?')) return;
  const cols=mapData.cols, rows=mapData.rows;
  mapData = newMap(cols,rows,$('mapNameInput').value);
  editorCurrentTerrId=null; renderEditorLists(); drawEditorCanvas();
});
$('btnApplyGrid').addEventListener('click', ()=>{
  const cols = clamp(Number($('gridCols').value)||40,10,80);
  const rows = clamp(Number($('gridRows').value)||26,8,60);
  if(!confirm('Đổi kích thước lưới sẽ xoá bản đồ hiện tại. Tiếp tục?')) return;
  mapData = newMap(cols,rows,$('mapNameInput').value);
  editorCurrentTerrId=null; renderEditorLists(); drawEditorCanvas();
});
$('mapNameInput').addEventListener('change', (e)=>{ mapData.name = e.target.value || mapData.name; });
$('btnExportMap').addEventListener('click', exportMapJSON);
$('btnImportMap').addEventListener('click', ()=> $('importMapInput').click());
$('importMapInput').addEventListener('change', (e)=>{
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{ try{ importMapJSON(JSON.parse(reader.result)); }catch(err){ alert('Lỗi: '+err.message); } };
  reader.readAsText(file);
  e.target.value='';
});
$('btnValidate').addEventListener('click', validateMap);
$('btnPlayThisMap').addEventListener('click', ()=>{
  if(!validateMap()) { if(!confirm('Bản đồ có vấn đề. Vẫn muốn tiếp tục chơi?')) return; }
  goToSetup();
});

const editorCanvas = $('editorCanvas');
// Pointer events (not mouse-only) so painting works with touch/pen on mobile too.
editorCanvas.addEventListener('pointerdown', (e)=>{ editorCanvas.setPointerCapture(e.pointerId); editorPointerDown(e); });
editorCanvas.addEventListener('pointermove', editorPointerMove);
window.addEventListener('pointerup', editorPointerUp);
window.addEventListener('pointercancel', editorPointerUp);

// Setup wiring
$('btnBackFromSetup').addEventListener('click', ()=> showScreen('screen-menu'));
$('btnStartGame').addEventListener('click', ()=>{
  const numAI = Number($('aiCountSelect').value);
  const diff = $('aiDifficultySelect').value;
  const humanColor = $('humanColorSelect').value;
  const spectator = $('toggleSpectatorMode').checked;
  initGame(numAI, diff, humanColor, spectator);
  showScreen('screen-game');
  renderGame();
  if(RUNTIME_CONFIG.manualInitialPlacement){
    setupPlaceNext();
  } else {
    autoPlaceInitialArmies();
    beginReinforcePhase();
  }
});
$('toggleSpectatorMode').addEventListener('change', (e)=>{
  const on = e.target.checked;
  $('playerConfigRow').style.display = on ? 'none' : '';
});

// Game wiring
$('gameCanvas').addEventListener('click', gameCanvasClick);
$('btnCardsModal').addEventListener('click', ()=> openCardsModal(false));
$('btnQuitGame').addEventListener('click', ()=>{
  if(confirm('Thoát ván chơi hiện tại về menu chính?')) showScreen('screen-menu');
});

// Space bar toggles continent view while in-game. Ignored when a modal is open or
// focus is on a form control, so it doesn't hijack normal typing/button activation.
window.addEventListener('keydown', (e)=>{
  if(e.code!=='Space' && e.key!==' ') return;
  const activeScreen = document.querySelector('.screen.active');
  if(!activeScreen || activeScreen.id!=='screen-game') return;
  if(document.querySelector('.modal-overlay') || $('gameOverOverlay')) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if(tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT' || tag==='BUTTON') return;
  e.preventDefault();
  const cb = $('toggleContinentViewGame');
  cb.checked = !cb.checked;
  cb.dispatchEvent(new Event('change'));
});

// Top bar contextual buttons
function updateTopbarActions(){
  const wrap = $('topbarActions'); wrap.innerHTML='';
  const activeScreen = document.querySelector('.screen.active').id;
  if(activeScreen==='screen-editor'){
    const b = el('button','ghost small','← Menu'); b.addEventListener('click',()=>showScreen('screen-menu')); wrap.appendChild(b);
  } else if(activeScreen==='screen-menu'){
    // nothing
  }
}
new MutationObserver(updateTopbarActions).observe(document.body,{attributes:true,subtree:true,attributeFilter:['class']});
updateTopbarActions();

// Debug hook (read-only introspection for QA; harmless to leave in production)
window.__debug = {
  get game(){ return game; }, get mapData(){ return mapData; },
  clickTerritory(terrId){ if(!game) return; const t=mapData.territories[terrId]; if(!t) return null; return {x:t.centroid.x,y:t.centroid.y}; },
  forceFinishSetup(){
    let guard=0;
    while(!allPoolsEmpty() && guard++<10000){
      game.players.forEach(p=>{
        if(game.pool[p.id]>0){
          const mine = ownedTerritories(p.id);
          game.armies[mine[0]]++; game.pool[p.id]--;
        }
      });
    }
    beginReinforcePhase();
    renderGame();
  },
  forceDumpReinforce(){
    if(game.phase!=='reinforce') return;
    const p = currentPlayer();
    const mine = ownedTerritories(p.id);
    while(game.reinforceRemaining>0){ game.armies[mine[0]]++; game.reinforceRemaining--; }
    renderGame();
  },
  doBattle, beginFortifyPhase, endTurn, checkElimination, checkWinCondition,
  generateRandomMap, findConnectedComponents, renderGame, openFortifyModal
};
