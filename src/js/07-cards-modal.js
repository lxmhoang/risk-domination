/* =========================================================================
   CARDS MODAL
   ========================================================================= */
function openCardsModal(forced){
  const p = game.players[0];
  const root = $('modalRoot');
  const overlay = el('div','modal-overlay');
  const modal = el('div','modal');
  modal.appendChild(el('h3','', forced? '⚠️ Bạn phải đổi thẻ bài (≥5 thẻ)!' : '🃏 Thẻ bài của bạn'));
  const cardsWrap = el('div','');
  const selected = new Set();
  p.cards.forEach((type,i)=>{
    const item = el('div','card-item', CARD_ICON[type]+`<span class="label">${type}</span>`);
    item.addEventListener('click', ()=>{
      if(selected.has(i)){ selected.delete(i); item.classList.remove('selected'); }
      else if(selected.size<3){ selected.add(i); item.classList.add('selected'); }
    });
    cardsWrap.appendChild(item);
  });
  modal.appendChild(cardsWrap);
  const info = el('div','', '<p style="color:var(--muted);font-size:12px;margin-top:10px;">Chọn 3 thẻ giống nhau hoặc 3 loại khác nhau để đổi lấy quân.</p>');
  modal.appendChild(info);
  const btnRow = el('div',''); btnRow.style.marginTop='14px'; btnRow.style.display='flex'; btnRow.style.gap='8px';
  const tradeBtn = el('button','primary','Đổi thẻ');
  tradeBtn.addEventListener('click', ()=>{
    const idxs = [...selected];
    if(idxs.length!==3) return;
    const types = idxs.map(i=>p.cards[i]);
    const uniq = new Set(types);
    if(!(uniq.size===1||uniq.size===3)){ alert('Phải chọn 3 thẻ cùng loại hoặc 3 loại khác nhau.'); return; }
    tradeCards(p, idxs);
    document.body.removeChild(overlay);
    if(p.cards.length>=5) openCardsModal(true);
    else renderGame();
  });
  btnRow.appendChild(tradeBtn);
  if(!forced){
    const closeBtn = el('button','ghost','Đóng');
    closeBtn.addEventListener('click', ()=> document.body.removeChild(overlay));
    btnRow.appendChild(closeBtn);
  }
  modal.appendChild(btnRow);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
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

