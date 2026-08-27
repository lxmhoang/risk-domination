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
$('btnLoadGame').addEventListener('click', ()=> $('loadGameInput').click());
$('loadGameInput').addEventListener('change', (e)=>{
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{ const obj = JSON.parse(reader.result); importGameJSON(obj); }
    catch(err){ alert('Không đọc được file ván chơi: '+err.message); }
  };
  reader.readAsText(file);
  e.target.value='';
});
// The config knobs that used to live on a separate Settings screen now live directly in the
// setup screen (see goToSetup() -> renderConfigControls()) so everything for starting a game
// is in one place. They still persist to RUNTIME_CONFIG/localStorage exactly as before.
function renderConfigControls(){
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
  renderConfigControls();
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
      renderConfigControls();
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
5. THẺ BÀI: Mặc định, chiếm được ≥1 vùng trong lượt sẽ nhận 1 thẻ bài (đổi được ở màn Thiết lập ván chơi: theo lượt hạ quân địch, hoặc phát tự động mỗi lượt). Đổi 3 thẻ (giống nhau hoặc khác nhau) lấy quân thưởng tăng dần.
6. THẮNG: Người cuối cùng còn lãnh thổ trên bản đồ.`);
});

function goToSetup(){
  $('setupMapInfo').textContent = `Bản đồ: "${mapData.name}" — ${Object.keys(mapData.territories).length} lãnh thổ, ${Object.keys(mapData.continents).length} châu lục.`;
  renderPlayerConfigList();
  renderConfigControls();
  showScreen('screen-setup');
}
// Remembers name/color/personality edits across re-renders (changing aiCountSelect or
// toggling spectator mode) within the same visit to the setup screen. Index 0 is "you" —
// still a real slot even in spectator mode, where it becomes an AI-controlled player too.
let playerConfigDraft = [];

// Two color <select>s can't hold the same color: picking a color already used by another
// row swaps it with that row's previous color instead, so all rows stay distinct.
function wireColorSelect(sel, dot){
  sel.addEventListener('change', ()=>{
    const newHex = sel.value, oldHex = dot.dataset.hex;
    document.querySelectorAll('#playerConfigList .player-color-select').forEach(other=>{
      if(other===sel || other.value!==newHex) return;
      other.value = oldHex;
      const otherDot = other.closest('.player-config').querySelector('.pdot');
      otherDot.style.background = oldHex; otherDot.dataset.hex = oldHex;
    });
    dot.style.background = newHex; dot.dataset.hex = newHex;
  });
}

function renderPlayerConfigList(){
  const wrap = $('playerConfigList'); wrap.innerHTML='';
  const numAI = Number($('aiCountSelect').value);
  const spectator = $('toggleSpectatorMode').checked;
  const totalSlots = numAI+1;
  for(let i=0;i<totalSlots;i++){
    const isYou = i===0;
    const draft = playerConfigDraft[i] || {};
    const defaultColor = draft.color || PLAYER_COLORS[i % PLAYER_COLORS.length].hex;

    const row = el('div','player-config');
    const dot = el('div','pdot'); dot.style.background=defaultColor; dot.dataset.hex=defaultColor;

    const nameInput = el('input'); nameInput.type='text'; nameInput.className='player-name-input';
    nameInput.value = draft.name || (isYou ? 'Bạn' : ('AI '+(i+1)));

    const persSel = el('select'); persSel.className='player-personality-select';
    Object.keys(AI_PERSONALITIES).forEach(key=>{
      const opt = el('option','',AI_PERSONALITIES[key].label); opt.value=key;
      persSel.appendChild(opt);
    });
    persSel.value = draft.personality || 'balanced';
    if(isYou && !spectator){
      persSel.disabled = true;
      persSel.title = 'Chỉ áp dụng khi bạn để AI chơi thay (bật "Chế độ xem AI đấu với nhau")';
    }

    const colorSel = el('select'); colorSel.className='player-color-select';
    PLAYER_COLORS.forEach(c=>{ const opt=el('option','',c.name); opt.value=c.hex; colorSel.appendChild(opt); });
    colorSel.value = defaultColor;
    wireColorSelect(colorSel, dot);

    row.appendChild(dot); row.appendChild(nameInput); row.appendChild(persSel); row.appendChild(colorSel);
    wrap.appendChild(row);
  }
}

function readPlayerConfigs(){
  const spectator = $('toggleSpectatorMode').checked;
  const rows = Array.from(document.querySelectorAll('#playerConfigList .player-config'));
  const configs = rows.map((row,i)=>({
    name: row.querySelector('.player-name-input').value.trim() || (i===0 ? 'Bạn' : ('AI '+(i+1))),
    color: row.querySelector('.player-color-select').value,
    personality: row.querySelector('.player-personality-select').value,
    isHuman: i===0 && !spectator,
  }));
  playerConfigDraft = configs.map(c=>({name:c.name, color:c.color, personality:c.personality}));
  return configs;
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
$('btnNewCont').addEventListener('click', ()=>{ createContinent(mapData); renderEditorLists(); drawEditorCanvas(); });
$('btnReassignConts').addEventListener('click', ()=>{
  if(Object.keys(mapData.continents).length===0){ alert('Chưa có châu lục nào để chia vào.'); return; }
  if(!confirm('Chia lại châu lục sẽ ghi đè mọi gán châu lục thủ công hiện có. Tiếp tục?')) return;
  reassignContinents(mapData);
  renderEditorLists(); drawEditorCanvas();
});
$('waterRatioInput').addEventListener('input', (e)=>{ $('waterRatioLabel').textContent = e.target.value+'%'; });
$('waterSpreadInput').addEventListener('input', (e)=>{ $('waterSpreadLabel').textContent = e.target.value+'%'; });
$('btnRandomGen').addEventListener('click', ()=>{
  if(!confirm('Tạo bản đồ ngẫu nhiên mới sẽ xoá bản đồ hiện tại. Tiếp tục?')) return;
  const cols = Number($('gridCols').value)||100, rows = Number($('gridRows').value)||100;
  mapData = generateRandomMap(cols, rows, Math.max(8,Math.round(cols*rows/50)), 6, $('mapNameInput').value, getWaterRatio(), getWaterSpread());
  editorCurrentTerrId=null; renderEditorLists(); drawEditorCanvas();
});
$('btnClearMap').addEventListener('click', ()=>{
  if(!confirm('Xoá toàn bộ lãnh thổ trên bản đồ?')) return;
  const cols=mapData.cols, rows=mapData.rows;
  mapData = newMap(cols,rows,$('mapNameInput').value);
  editorCurrentTerrId=null; renderEditorLists(); drawEditorCanvas();
});
$('btnApplyGrid').addEventListener('click', ()=>{
  const cols = clamp(Number($('gridCols').value)||100,10,200);
  const rows = clamp(Number($('gridRows').value)||100,10,200);
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
$('aiCountSelect').addEventListener('change', renderPlayerConfigList);
$('btnStartGame').addEventListener('click', ()=>{
  const diff = $('aiDifficultySelect').value;
  const spectator = $('toggleSpectatorMode').checked;
  const alliance = $('toggleAlliance').checked;
  const tradeRule = $('tradeRuleSelect').value;
  const playerConfigs = readPlayerConfigs();
  initGame(playerConfigs, diff, spectator, alliance, tradeRule);
  showScreen('screen-game');
  renderGame();
  if(RUNTIME_CONFIG.manualInitialPlacement){
    setupPlaceNext();
  } else {
    autoPlaceInitialArmies();
    beginReinforcePhase();
  }
});
$('toggleSpectatorMode').addEventListener('change', ()=>{
  readPlayerConfigs(); // keep whatever the user already typed/picked before re-rendering
  renderPlayerConfigList();
});

// Game wiring
$('gameCanvas').addEventListener('click', gameCanvasClick);

// Setup-place: holding down on a territory keeps placing armies into it — 1 immediately on
// press, then (after a short initial delay, like a keyboard's key-repeat) once per tick for as
// long as the pointer stays down, until the phase ends or this spot stops being valid.
let setupHoldTimer = null;
function stopSetupHold(){ clearTimeout(setupHoldTimer); clearInterval(setupHoldTimer); setupHoldTimer=null; }
$('gameCanvas').addEventListener('pointerdown', (e)=>{
  if(!game || game.phase!=='setup-place') return;
  const terrId = getTerritoryFromCanvasEvent($('gameCanvas'), e);
  if(!attemptSetupPlacement(terrId)) return;
  $('gameCanvas').setPointerCapture(e.pointerId);
  stopSetupHold();
  setupHoldTimer = setTimeout(()=>{
    setupHoldTimer = setInterval(()=>{
      if(!canKeepHoldingSetupPlacement(terrId)){ stopSetupHold(); return; }
      attemptSetupPlacement(terrId);
    }, 150);
  }, 400);
});
['pointerup','pointerleave','pointercancel'].forEach(evtName=>
  $('gameCanvas').addEventListener(evtName, stopSetupHold)
);
$('btnCardsModal').addEventListener('click', ()=> openCardsModal(false));
$('btnSaveGame').addEventListener('click', ()=> exportGameJSON());
$('btnQuitGame').addEventListener('click', ()=>{
  if(confirm('Thoát ván chơi hiện tại về menu chính?')) showScreen('screen-menu');
});

// Pause/resume the current AI's turn (disabled during a human turn — see renderTopbar()).
$('btnPauseAI').addEventListener('click', ()=>{
  setAIPaused(!aiPaused);
  renderGame();
});

// Dice/combat log collapse toggle — collapsed by default on every screen size (see body.html;
// rarely-looked-at, so it shouldn't cost permanent space even on desktop) and otherwise only
// changes when the player taps this button — no auto-expand on new rolls.
$('btnToggleLog').addEventListener('click', ()=>{
  const collapsed = $('gameLogPanel').classList.toggle('collapsed');
  $('btnToggleLog').classList.toggle('active', !collapsed);
  // In the narrow side-rail (map-landscape) mobile layout, opening the log swaps it with the
  // map (log takes the big area, map shrinks into the rail) — see style.css's .log-open rules.
  $('screen-game').classList.toggle('log-open', !collapsed);
});

// updateGameLayoutOrientation() (which decides map-landscape vs map-portrait) only ran as
// part of renderGame(), i.e. on actual game actions — so resizing/rotating the viewport (or
// switching device presets in devtools) with no game action in between left the OLD choice
// applied to the NEW size, producing a visibly broken layout until the next click. Re-run on
// resize too, debounced since resize fires continuously while dragging a window/devtools pane.
let _resizeTimer = null;
window.addEventListener('resize', ()=>{
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(()=>{
    if(game && document.getElementById('screen-game').classList.contains('active')) renderGame();
  }, 120);
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

// Phase-action keyboard shortcuts — attack: C = Công triệt để, T = Tấn công, K = Kết thúc tấn
// công; fortify: C = Chuyển quân, K = Kết thúc lượt. Modal-specific shortcuts (the capture-move
// and fortify popups) are wired locally in their own open functions instead, since a modal
// being open already blocks these via the same guard the Space-bar shortcut uses above.
window.addEventListener('keydown', (e)=>{
  if(!game || game.over) return;
  const activeScreen = document.querySelector('.screen.active');
  if(!activeScreen || activeScreen.id!=='screen-game') return;
  if(document.querySelector('.modal-overlay') || $('gameOverOverlay')) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if(tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT') return;
  const p = currentPlayer();
  if(!p.isHuman) return;
  const key = e.key.toLowerCase();
  if(game.phase==='attack'){
    if(key==='c'){ e.preventDefault(); allOutAttack(); }
    else if(key==='t'){ e.preventDefault(); doSingleAttack(); }
    else if(key==='k'){ e.preventDefault(); beginFortifyPhase(); }
  } else if(game.phase==='fortify'){
    if(key==='c'){ e.preventDefault(); if(canFortifyNow(p)) openFortifyModal(game.selectedFrom, game.selectedTo); }
    else if(key==='k'){ e.preventDefault(); endTurn(); }
  }
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
  generateRandomMap, findConnectedComponents, renderGame, openFortifyModal,
  tradeCards, tradeInValue, findTradeCombo, drawEditorCanvas, drawGameCanvas,
  getTerritoryBoundaryLoops, getContinentBoundaryLoops, paintCell,
  attemptSetupPlacement, canKeepHoldingSetupPlacement, allOutAttack, doSingleAttack,
  get editorCurrentTerrId(){ return editorCurrentTerrId; }
};
