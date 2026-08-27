/* =========================================================================
   CARDS MODAL
   ========================================================================= */
function openCardsModal(forced){
  const p = game.players[0];
  const overlay = el('div','modal-overlay');
  const modal = el('div','modal');
  modal.appendChild(el('h3','', forced? '⚠️ Bạn phải đổi thẻ bài (≥5 thẻ)!' : '🃏 Thẻ bài của bạn'));
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
  function updatePreview(){
    const idxs = comboIfValid();
    previewEl.textContent = idxs
      ? `Đổi 3 thẻ này sẽ nhận ${tradeInValue(game.tradeRule, game.tradeCount+1, (p.personalTradeCount||0)+1)} quân.`
      : '';
  }

  p.cards.forEach((type,i)=>{
    const item = el('div','card-item'+(selected.has(i)?' selected':''), CARD_ICON[type]+`<span class="label">${type}</span>`);
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
    const idxs = comboIfValid();
    if(!idxs){ alert('Phải chọn 3 thẻ cùng loại hoặc 3 loại khác nhau.'); return; }
    tradeCards(p, idxs);
    close();
    if(p.cards.length>=5) openCardsModal(true);
    else renderGame();
  });
  btnRow.appendChild(tradeBtn);
  let cancelBtn = null;
  if(!forced){
    cancelBtn = el('button','ghost',withShortcut('Huỷ','H')); cancelBtn.title='Phím tắt: H';
    cancelBtn.addEventListener('click', close);
    btnRow.appendChild(cancelBtn);
  }
  modal.appendChild(btnRow);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  updatePreview();

  function keyHandler(e){
    const key = e.key.toLowerCase();
    if(key==='d'){ e.preventDefault(); tradeBtn.click(); }
    else if(key==='h' && cancelBtn){ e.preventDefault(); cancelBtn.click(); }
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
  const backBtn = el('button','primary','Về Menu chính');
  backBtn.addEventListener('click', ()=>{ document.body.removeChild(overlay); showScreen('screen-menu'); });
  overlay.appendChild(backBtn);
  document.body.appendChild(overlay);
}

