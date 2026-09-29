/* =========================================================================
   CARDS MODAL
   ========================================================================= */
function openCardsModal(forced){
  const p = game.players[0];
  // no-blur/translucent: same reasoning as the fortify/capture-move modals — the map behind
  // stays visible instead of being blacked out.
  const overlay = el('div','modal-overlay no-blur');
  const modal = el('div','modal translucent');
  if(forced) modal.appendChild(el('h3','', '⚠️ Bạn phải đổi thẻ bài (≥5 thẻ)!'));
  const cardsWrap = el('div','');
  const selected = new Set();
  // Pre-select a valid tradeable combo if the player already has one, so the common case
  // ("I have a valid set, just trade it") needs zero clicks before D/Xác nhận.
  const autoCombo = findTradeCombo(p.cards);
  if(autoCombo) autoCombo.forEach(i=>selected.add(i));

  function comboIfValid(){
    const idxs = [...selected];
    if(idxs.length!==3) return null;
    const uniq = new Set(idxs.map(i=>p.cards[i]));
    return (uniq.size===1||uniq.size===3) ? idxs : null;
  }
  // Trading is only ever a reinforce-phase action of your OWN turn (it hands out extra armies to
  // place) — the cards button stays open/browsable during other players' turns or your own
  // attack/fortify, but the button stays hidden then even with a valid combo selected.
  const canTradeThisPhase = game.phase==='reinforce' && currentPlayerId()===p.id;
  function updatePreview(){
    const idxs = canTradeThisPhase ? comboIfValid() : null;
    previewEl.textContent = idxs
      ? `Đổi 3 thẻ này sẽ nhận ${tradeInValue(game.tradeRule, game.tradeCount+1, (p.personalTradeCount||0)+1)} quân.`
      : '';
    // Only worth showing the button once the current selection is actually tradeable —
    // otherwise it'd just alert() the same thing back at the player on every click.
    tradeBtn.hidden = !idxs;
  }

  p.cards.forEach((type,i)=>{
    const item = el('div','card-item'+(selected.has(i)?' selected':''), `<span class="icon">${CARD_ICON[type]}</span><span class="label">${type}</span>`);
    item.addEventListener('click', ()=>{
      if(selected.has(i)){ selected.delete(i); item.classList.remove('selected'); }
      else if(selected.size<3){ selected.add(i); item.classList.add('selected'); }
      updatePreview();
    });
    cardsWrap.appendChild(item);
  });
  modal.appendChild(cardsWrap);
  const info = el('div','', '<p style="color:var(--muted);font-size:12px;margin-top:10px;">Chọn 3 thẻ giống nhau hoặc 3 loại khác nhau để đổi lấy quân.</p>');
  modal.appendChild(info);
  const previewEl = el('p',''); previewEl.style.cssText='font-size:13px;color:var(--good);font-weight:700;margin-top:8px;min-height:18px;';
  modal.appendChild(previewEl);

  const btnRow = el('div',''); btnRow.style.marginTop='14px'; btnRow.style.display='flex'; btnRow.style.gap='8px';
  const tradeBtn = el('button','primary',withShortcut('Đổi thẻ','D')); tradeBtn.title='Phím tắt: D';
  tradeBtn.addEventListener('click', ()=>{
    if(!canTradeThisPhase) return; // hidden, but still reachable via the 'D' shortcut below
    const idxs = comboIfValid();
    if(!idxs){ alert('Phải chọn 3 thẻ cùng loại hoặc 3 loại khác nhau.'); return; }
    tradeCards(p, idxs);
    close();
    if(p.cards.length>=5) openCardsModal(true);
    else renderGame();
  });
  btnRow.appendChild(tradeBtn);
  modal.appendChild(btnRow);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  updatePreview();

  // No explicit "Huỷ" button anymore — clicking the dimmed area outside the panel dismisses it,
  // same as tapping away from any other non-forced popover. Still can't be dismissed at all
  // while forced (≥5 cards): there's nothing to click outside of that should let you escape
  // without trading down.
  if(!forced){
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) close(); });
  }

  function keyHandler(e){
    const key = e.key.toLowerCase();
    if(key==='d'){ e.preventDefault(); tradeBtn.click(); }
    else if(key==='escape' && !forced){ e.preventDefault(); close(); }
  }
  document.addEventListener('keydown', keyHandler);
  function close(){
    document.removeEventListener('keydown', keyHandler);
    document.body.removeChild(overlay);
  }
}

function showGameOver(winner){
  const overlay = el('div',''); overlay.id='gameOverOverlay';
  let html = `<h1>${winner? '🏆 '+winner.name+' Chiến Thắng!' : 'Ván chơi kết thúc'}</h1>
    <p>${winner && winner.isHuman? 'Chúc mừng, bạn đã chinh phục toàn bộ bản đồ!' : winner? 'Đối thủ AI đã chinh phục toàn bộ bản đồ.' : ''}</p>
    <p style="font-size:13px;">Ván đấu kéo dài ${game.roundNumber} vòng.</p>`;

  const rows = game.players.map(p=>({p, terr: ownedTerritories(p.id).length}))
    .sort((a,b)=> (b.p.alive - a.p.alive) || (b.terr - a.terr) || (b.p.totalKills - a.p.totalKills));
  html += `<div class="summary-table-wrap"><table class="summary-table"><thead><tr>
    <th></th><th>Người chơi</th><th>Trạng thái</th><th>Lãnh thổ</th><th>📦 Viện binh</th><th>😵 Tiêu diệt</th>
    </tr></thead><tbody>`;
  rows.forEach(({p,terr})=>{
    const status = p.alive ? 'Còn sống' : ('Bị loại'+(p.eliminatedRound? ' (vòng '+p.eliminatedRound+')' : ''));
    html += `<tr>
      <td><span class="pdot" style="background:${p.color}"></span></td>
      <td>${p.name}${p.isHuman?' (Bạn)':''}</td>
      <td>${status}</td>
      <td>${terr}</td>
      <td>${p.totalReinforced}</td>
      <td>${p.totalKills}</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;

  if(game.biggestBattle){
    const b = game.biggestBattle;
    html += `<p style="font-size:13px;">⚔️ Trận đánh lớn nhất: <b>${b.attackerName}</b> tấn công <b>${b.toName}</b> (${b.defenderName}) từ ${b.fromName} — tổng cộng ${b.totalLoss} quân tổn thất, ở vòng ${b.round}.</p>`;
  }

  overlay.innerHTML = html;
  if(game.startSnapshot){
    const replayBtn = el('button','primary','🔁 Chơi lại ván này');
    replayBtn.title = 'Chơi lại đúng vị trí lãnh thổ/quân xuất phát ban đầu — diễn biến sau đó (xúc xắc, quyết định AI) có thể khác lần trước.';
    replayBtn.addEventListener('click', ()=>{ document.body.removeChild(overlay); replaySameGame(); });
    overlay.appendChild(replayBtn);
  }
  const backBtn = el('button', game.startSnapshot?'ghost':'primary', 'Về Menu chính');
  backBtn.addEventListener('click', ()=>{ document.body.removeChild(overlay); showScreen('screen-menu'); });
  overlay.appendChild(backBtn);
  document.body.appendChild(overlay);
}

