/* =========================================================================
   GAME UI FLOW — the browser-only parts of running a game
   ---------------------------------------------------------------------
   Dialogs and file save/load that sit around the rules in 04-game-state.js. Kept out of that
   file because it is part of the core (see 00-core-utils.js), which also runs on the server.
   ========================================================================= */

// "Chơi lại" (game-over screen): rebuilds the exact starting position captured by
// beginReinforcePhase() — same map (mapData is untouched since game-over), same players/
// difficulty/settings, same territory-owner/army layout — then plays out fresh from there.
// Dice rolls, AI randomness, and any human choices are NOT replayed, so the match itself
// will very likely unfold differently this time; only the starting position is identical.
function replaySameGame(){
  const snap = game.startSnapshot;
  if(!snap) return;
  const playerConfigs = snap.players.map(p=>({name:p.name, isHuman:p.isHuman, color:p.color, personality:p.personality}));
  initGame(playerConfigs, snap.difficulty, snap.spectatorMode, snap.allianceEnabled, snap.tradeRule);
  game.owner = {...snap.owner};
  game.armies = {...snap.armies};
  game.turnOrder = [...snap.turnOrder];
  game.players.forEach(p=>{ game.pool[p.id] = 0; });
  showScreen('screen-game');
  maybeRotateMapForPortrait();
  beginReinforcePhase();
}

// Shown by the human attack entry points (doSingleAttack()/allOutAttack() in
// 06-render-game.js) after a fight resolves — folds "kết quả trận đánh" (who lost how many,
// over how many rounds) into the same dialog as the "chiếm được" troop-move decision when the
// attack also captured the territory, instead of only ever showing that decision (and only
// when there was a non-trivial amount to redistribute) while every other outcome sat in the
// combat log alone.
// Shown by the human attack entry points (doSingleAttack()/allOutAttack() in
// 06-render-game.js) ONLY when a capture leaves extra armies worth deciding how to split — a
// plain "-N" battle result is now conveyed visually instead (the flying-badge/impact animation
// in drawGameCanvas(), see attackAnim), so there's nothing to show here when there's no real
// choice to make (not captured, or captured with nothing left over to redistribute).
function showCaptureMoveModal(fromId, toId, moving, maxMovable){
  const fromName = mapData.territories[fromId].name;
  const toName = mapData.territories[toId].name;
  // no-blur: unlike other modals, dragging this slider is meant to be checked against the map
  // live (see the slider's 'input' handler below) — blurring it out from under the modal would
  // defeat the point.
  const overlay = el('div','modal-overlay no-blur');
  const modal = el('div','modal translucent');
  let keyHandler = null;
  function close(){
    if(keyHandler) document.removeEventListener('keydown', keyHandler);
    document.body.removeChild(overlay);
  }

  const alreadyMoved = moving;
  const extraMax = maxMovable - alreadyMoved; // how many MORE can move beyond the guaranteed minimum
  modal.appendChild(el('h3','', `🎉 Chiếm được "${toName}"!`));
  modal.appendChild(el('p','', `Bạn có thể chuyển thêm quân từ "${fromName}" sang "${toName}" (đã chuyển tối thiểu ${alreadyMoved} quân theo luật).`));

  const bigRow = el('div','');
  bigRow.style.cssText = 'display:flex;justify-content:space-around;align-items:center;margin:18px 0;text-align:center;';
  const fromBox = el('div','');
  const fromCount = el('div','', String(game.armies[fromId])); fromCount.style.cssText='font-size:26px;font-weight:800;color:#fff;';
  fromBox.appendChild(fromCount); fromBox.appendChild(el('div','',fromName)).style.cssText='font-size:12px;color:var(--muted);margin-top:2px;';
  const arrow = el('div','','→'); arrow.style.cssText='font-size:22px;color:var(--muted);';
  const toBox = el('div','');
  const toCount = el('div','', String(game.armies[toId])); toCount.style.cssText='font-size:26px;font-weight:800;color:var(--good);';
  toBox.appendChild(toCount); toBox.appendChild(el('div','',toName)).style.cssText='font-size:12px;color:var(--muted);margin-top:2px;';
  bigRow.appendChild(fromBox); bigRow.appendChild(arrow); bigRow.appendChild(toBox);
  modal.appendChild(bigRow);

  // Caller (doSingleAttack()/allOutAttack()) only opens this modal when extraMax>0 — there's
  // always a real slider choice to make here, never just a bare "Đóng" button.
  const sliderRow = el('div',''); sliderRow.style.cssText='display:flex;align-items:center;gap:12px;margin:14px 0 6px;';
  const slider = document.createElement('input');
  slider.type='range'; slider.min='0'; slider.max=String(extraMax); slider.value=String(extraMax);
  slider.style.flex='1';
  const sliderLabel = el('span','', '+'+extraMax); sliderLabel.style.cssText='min-width:48px;text-align:center;font-weight:700;color:var(--good);';
  // Applied LIVE (not just previewed) on every drag — appliedExtra tracks how much of the
  // transfer is already reflected in game.armies, so each new slider position only moves the
  // DELTA from there instead of re-applying the whole amount. The map badges are seeded into
  // lastDrawnArmies before renderGame() so they jump straight to the new value instead of
  // kicking off the usual ~350ms count-up/down tween on every single drag tick, which would
  // otherwise lag visibly behind wherever the slider actually is.
  let appliedExtra = 0;
  slider.addEventListener('input', ()=>{
    const extra = Number(slider.value);
    const delta = extra-appliedExtra;
    game.armies[fromId] -= delta;
    game.armies[toId] += delta;
    appliedExtra = extra;
    sliderLabel.textContent = '+'+extra;
    fromCount.textContent = String(game.armies[fromId]);
    toCount.textContent = String(game.armies[toId]);
    lastDrawnArmies[fromId] = game.armies[fromId];
    lastDrawnArmies[toId] = game.armies[toId];
    renderGame();
  });
  sliderRow.appendChild(slider); sliderRow.appendChild(sliderLabel);
  modal.appendChild(sliderRow);
  modal.appendChild(el('p','', 'Kéo để chọn số quân chuyển thêm, tối thiểu 1 quân luôn phải ở lại '+fromName+'.')).style.cssText='font-size:11.5px;color:var(--muted);margin:0 0 10px;';

  const btnRow = el('div',''); btnRow.style.cssText='display:flex;gap:8px;';
  const quickMin = el('button','ghost',withShortcut('Giữ nguyên (+0)','A')); quickMin.title='Phím tắt: A';
  quickMin.addEventListener('click', ()=>{ slider.value='0'; slider.dispatchEvent(new Event('input')); });
  const quickMax = el('button','ghost',withShortcut('Tối đa (+'+extraMax+')','D')); quickMax.title='Phím tắt: D';
  quickMax.addEventListener('click', ()=>{ slider.value=String(extraMax); slider.dispatchEvent(new Event('input')); });
  // Transfer is already live-applied by the slider's own 'input' handler above — confirming just
  // closes the modal, nothing left to actually move.
  const confirmBtn = el('button','primary',withShortcut('Xác nhận','X')); confirmBtn.title='Phím tắt: X';
  confirmBtn.addEventListener('click', ()=>{ close(); renderGame(); });
  btnRow.appendChild(quickMin); btnRow.appendChild(quickMax); btnRow.appendChild(confirmBtn);
  modal.appendChild(btnRow);

  keyHandler = function(e){
    const key = e.key.toLowerCase();
    if(key==='a'){ e.preventDefault(); quickMin.click(); }
    else if(key==='d'){ e.preventDefault(); quickMax.click(); }
    else if(key==='x'){ e.preventDefault(); confirmBtn.click(); }
  };
  document.addEventListener('keydown', keyHandler);
  // sync the big from/to numbers with the slider's initial value (defaults to max extra) —
  // without this they show the pre-transfer counts until the user drags the slider once.
  slider.dispatchEvent(new Event('input'));

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/* ---------------- Save / load an in-progress game ---------------- */
// A save file bundles the map (same plain shape used by the map editor's export) together
// with the `game` object itself, which is already plain JSON-serializable data (no Sets,
// Maps, or function references live on it — those are all on mapData instead).
const GAME_SAVE_FORMAT_VERSION = 1;

function exportGameJSON(){
  // Always the CANONICAL (un-rotated) map, regardless of whether this session is currently
  // displaying a portrait auto-rotated copy (see maybeRotateMapForPortrait() in
  // 06-render-game.js) — otherwise reloading the save on a landscape device would show it
  // sideways relative to how it was actually authored/generated.
  const out = {
    formatVersion: GAME_SAVE_FORMAT_VERSION,
    savedAt: Date.now(),
    spectatorMode,
    mapData: mapToPlainObject(unrotateMapData(mapData)),
    game,
  };
  const blob = new Blob([JSON.stringify(out)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0,16).replace(/[:T]/g,'-');
  a.href = url; a.download = 'risk-save-'+stamp+'.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importGameJSON(obj){
  if(!obj || !obj.mapData || !obj.game) throw new Error('File không đúng định dạng ván chơi đã lưu.');
  mapData = mapFromPlainObject(obj.mapData);
  game = obj.game;
  spectatorMode = !!obj.spectatorMode;
  aiPaused = false; pendingAIResume = null;
  gameZoom = 1;
  resetRenderAnimState(); // no leftover fades/tweens from whatever was on screen before loading
  showScreen('screen-game');
  maybeRotateMapForPortrait();
  renderGame();
  renderCombatLog();
  if(game.over) return;
  // If it was an AI's turn (or still mid initial placement) when saved, nothing is scheduled
  // to continue it on its own — kick the appropriate step back off from wherever it left off.
  // Each of these reads current game state fresh rather than re-deriving it (e.g. aiReinforceStep
  // just keeps spending game.reinforceRemaining, it doesn't recompute/re-grant it), so resuming
  // mid-phase is safe and doesn't double up any army grants.
  if(game.phase==='setup-place'){
    setupPlaceNext();
  } else {
    const cp = currentPlayer();
    if(!cp.isHuman){
      if(game.phase==='reinforce') aiReinforceStep(cp.id);
      else if(game.phase==='attack') aiAttackStep(cp.id);
      else if(game.phase==='fortify') aiFortifyStep(cp.id);
    }
  }
}
