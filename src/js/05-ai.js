/* =========================================================================
   AI LOGIC
   ---------------------------------------------------------------------
   This comment block is the AI's "design doc"; ai.md at the repo root walks
   through the same logic step by step, with the numbers.
   Every decision is a simple weighted-scoring heuristic, not lookahead/
   minimax or ML. But the turn isn't just four independently-scored steps
   run back to back — it starts with ONE overall campaign decision that the
   rest of the turn serves:

   0. TURN INTENT (see pickAITurnIntent()): before touching any armies, the
      AI looks at the WHOLE board once and commits to a single campaign for
      the turn — finish a continent, kill off a crippled opponent, brace a
      threatened border, or quietly build up on the continent it dominates
      most (attempt_continent). Reinforce,
      attack AND fortify then all read that same intent and bias their
      scoring toward it, instead of each step re-deciding "what matters"
      from scratch in isolation. This is the one part of the AI that
      resembles how a human actually plans a turn.

   Everything below is scoring detail for the four steps that CARRY OUT that
   intent, run in sequence (reinforce -> attack -> fortify -> end turn):

   1. RESERVE AWARENESS ("biết giữ quân"): before attacking FROM a territory,
      the AI first sets aside a defensive reserve sized to the strongest
      OTHER enemy neighbor that territory faces (see reserveFor()). Only the
      surplus above that reserve is considered "usable" for the attack-odds
      calculation, so a stack sitting next to a second, untouched threat
      won't get thrown entirely at the first juicy target. The reserve
      shrinks on Hard and grows on Easy (aggressiveThreshold in
      difficultyProfile()).
   2. CONTINENT AWARENESS ("giữ châu lục để ăn điểm"): capturing a territory
      that completes a continent gets a large score bonus (attackScore()),
      and reinforcement placement (pickAIReinforceTarget) favors defending
      the borders of continents the AI already fully owns, or pushing to
      finish one that's one territory away.
   3. KILL PRIORITY ("diệt hẳn player ngoắc ngoải"): an opponent reduced to
      very few territories is a soft target worth going a little out of your
      way for, because eliminating them transfers their whole card hand to
      the killer (see checkElimination) — the fewer territories/the more
      cards they're holding, the bigger the score bonus to finish them off.
      The AI is also more cautious about picking fights with whoever is
      currently the strongest player (evaluatePlayerPower), unless it's
      already comparably strong itself.
   4. PERSONALITY (per-AI flavor on top of difficulty): each AI player has a
      `personality` (see AI_PERSONALITIES) that nudges the same knobs — how
      big a reserve to keep, how eager to chase continents/kills — so AIs at
      the same difficulty still play distinctly from each other.
   5. ALLIANCE (optional, game.allianceEnabled): when on, and one player has
      pulled CLEARLY ahead of the field (findAllianceLeader() — margin-gated,
      not just "whoever's highest this turn"), that player is marked as the
      common enemy (updateCommonEnemy()) and every OTHER AI is reluctant to
      fight fellow non-leaders and instead piles onto them — and keeps doing so
      until their power falls below a fraction of what it was when marked, even
      if they're no longer the leader. The target itself is exempt and just
      plays normally.
   ========================================================================= */

// Labels only — the numbers behind each personality (threshold shift, reserve multiplier, kill/
// continent bonus multipliers) live in the config (src/config.json, keys pers<Name>…, editable on
// the Cấu hình screen) and are read by personalityTraits() below. `cfgKey` is the <Name> part.
const AI_PERSONALITIES = {
  balanced:    { label:'Cân bằng',                cfgKey:'Balanced' },
  turtle:      { label:'Rùa (thủ chắc)',           cfgKey:'Turtle' },
  rusher:      { label:'Xông pha (háo chiến)',     cfgKey:'Rusher' },
  opportunist: { label:'Cơ hội (săn con mồi yếu)', cfgKey:'Opportunist' },
};
function personalityTraits(personality){
  const k = (AI_PERSONALITIES[personality] || AI_PERSONALITIES.balanced).cfgKey;
  return {
    thresholdAdj: RUNTIME_CONFIG['pers'+k+'ThresholdAdj'],
    reserveMult: RUNTIME_CONFIG['pers'+k+'ReserveMult'],
    killBonusMult: RUNTIME_CONFIG['pers'+k+'KillBonus'],
    continentBonusMult: RUNTIME_CONFIG['pers'+k+'ContinentBonus'],
  };
}

// ---------------------------------------------------------------------
// TRIGGER/RESPONSE LEVELS ("thang trigger/đối sách" — xem ai-strategy-discussion.md).
// Mỗi intent có 1 thang TRIGGER (level nào phải khớp để intent này được chọn lượt này)
// và 1 thang ĐỐI SÁCH (response nào dùng để thực thi) — 2 trục hoàn toàn độc lập: response
// KHÔNG suy ra từ trigger-level nào vừa khớp. Cả 2 roll qua personality lean (bảng dưới,
// chỉ là mức AI đó "hay chạm" — trọng số cao hơn, không phải mức DUY NHẤT có thể ra) + 1
// lần roll "mood" ngẫu nhiên mỗi lượt (rollTurnMood()) — không có công thức lệch ±N cố
// định, chỉ random có trọng số.
//
// Vài ô (đánh dấu *) không được tài liệu thảo luận chốt rõ cho personality đó — mặc định
// về giá trị của `balanced` làm giả định code-time.
const TRIGGER_LEAN = {
  stay_survival:    { turtle:4, rusher:2, opportunist:3, balanced:3 },
  finish_continent: { turtle:4, rusher:2, balanced:3, opportunist:3 /* * */ },
  kill_weak:        { opportunist:4, turtle:2, balanced:3, rusher:3 /* * */ },
  defend:           { turtle:3, balanced:2, rusher:1, opportunist:2 /* * */ },
  expand:           { rusher:3, turtle:1, balanced:2, opportunist:2 },
  push_to_win:      { rusher:3, opportunist:3, balanced:2, turtle:2 },
  break_continent:  { rusher:3, opportunist:3, balanced:2, turtle:2 },
  revenge:          { rusher:3, balanced:2, opportunist:2, turtle:1 },
};
const RESPONSE_LEAN = {
  // stay_survival: 2 = "Cực đoan (co cụm)", 1 = "Đánh rỉa". balanced:null = không nghiêng
  // bên nào (đúng tài liệu: "balanced → tuỳ mood.response").
  stay_survival:    { turtle:2, rusher:1, opportunist:1, balanced:null },
  finish_continent: { turtle:'A', rusher:'B', balanced:'A', opportunist:'A' /* * */ },
  kill_weak:        { opportunist:'B', rusher:'B', turtle:'A', balanced:'A' },
  defend:           { turtle:'B', balanced:'A', rusher:'A', opportunist:'A' /* * */ },
  expand:           { rusher:'B', turtle:'A', balanced:'A', opportunist:'A' },
  push_to_win:      { rusher:'B', turtle:'A', balanced:'A', opportunist:'A' },
  break_continent:  { rusher:'B', turtle:'A', balanced:'A', opportunist:'A' },
  revenge:          { rusher:'B', turtle:'A', balanced:'A', opportunist:'A' },
};

// 1 lần/lượt, dùng chung cho mọi intent: 2 số ngẫu nhiên độc lập trong [0,1) — 1 cho trục
// trigger, 1 cho trục đối sách. Cùng 2 số này áp dụng cho MỌI intent trong lượt (xem
// pickTriggerLevel/pickResponse) nên cùng 1 lượt "mood" lệch đều các intent, nhưng trục
// trigger và trục đối sách hoàn toàn không liên quan tới nhau.
function rollTurnMood(){
  return { trigger: random(), response: random() };
}
// Chọn 1 giá trị trong `levels`, nghiêng trọng số gấp 3 về `lean` (nếu có — null/undefined
// = không nghiêng, random đều) bằng roll [0,1) đã cho. Dùng chung cho thang trigger (levels
// số, ví dụ [1,2,3,4]) và thang đối sách (levels ['A','B'] hoặc [1,2]).
function weightedLeanPick(lean, levels, roll){
  const weights = levels.map(lv=> (lean!=null && lv===lean) ? 3 : 1);
  const total = weights.reduce((s,w)=>s+w, 0);
  let acc = 0, r = roll*total;
  for(let i=0;i<levels.length;i++){ acc += weights[i]; if(r<acc) return levels[i]; }
  return levels[levels.length-1];
}
function pickTriggerLevel(intentType, personality, levels, mood){
  const lean = (TRIGGER_LEAN[intentType] || {})[personality];
  return weightedLeanPick(lean==null?null:lean, levels, mood.trigger);
}
function pickResponse(intentType, personality, levels, mood){
  const lean = (RESPONSE_LEAN[intentType] || {})[personality];
  return weightedLeanPick(lean==null?null:lean, levels, mood.response);
}

// ---------------------------------------------------------------------
// TỶ LỆ QUÂN SỐ ("capture ratio" — xem ai-strategy-discussion.md): dùng chung cho mọi chỗ
// ước lượng "có đánh chiếm được 1 Tỉnh không" (finish_continent giờ dùng continentForce() cho
// cả lục địa thay vì hàm này). A = tổng
// quân của mình ở các láng giềng của Tỉnh đó, B = quân địch tại đó. A KHÔNG trừ quân dự
// phòng cho láng giềng địch khác (khác reserveFor() ở aiAttackStep) — đã quyết đánh thì
// không giữ phần nào lại để phòng thủ nữa.
function captureRatio(pid, terrId){
  const t = mapData.territories[terrId];
  let A = 0;
  t.neighbors.forEach(n=>{ if(game.owner[n]===pid) A += game.armies[n]||0; });
  const B = Math.max(1, game.armies[terrId]||0);
  return A/B;
}
// 3 mức dùng lại đúng 3 ngưỡng `ai*Threshold` đã configurable trên admin portal (nhóm "AI
// theo độ khó" trong server/admin-config.js) — không thêm field admin mới trùng ý nghĩa.
function captureRatioThreshold(name){
  const key = name==='canThan' ? 'aiEasyThreshold' : name==='chuQuan' ? 'aiHardThreshold' : 'aiNormalThreshold';
  return RUNTIME_CONFIG[key];
}

// Two gates the #1 player (by evaluatePlayerPower) must BOTH clear before the alliance
// mechanic (game.allianceEnabled) recognizes them as "the leader" worth ganging up on — see
// findAllianceLeader() below:
// (Both from the config — allianceLeaderVsField / allianceLeaderMargin.)
//  - allianceLeaderVsField: strong enough to threaten the WHOLE rest of the field,
//    not just edge out the closest rival — e.g. with 5 other players, being 1.2x the #2 player
//    means little if the #1 is still weaker than the other 4 combined, since they wouldn't
//    need to team up to handle him.
//  - allianceLeaderMargin: clearly ahead of the single closest rival specifically — without
//    this, a 1-army edge in an otherwise close 2-player-ish spread could still pass the field
//    check above.

// Alliance-specific "who's the leader" check — considers EVERY alive player (including
// whoever is currently acting), unlike the plain "wary of the strongest opponent" logic in
// attackScore() which only ever looks at OTHER players. That distinction matters here:
// without including self, the actual strongest player on the board could never recognize
// ITSELF as the leader, and would end up applying the "gang up"/reluctance bonuses to its own
// attacks instead of being exempt from them. Returns null when no one clears both gates above.
function findAllianceLeader(){
  const powers = game.players.filter(pl=>pl.alive)
    .map(pl=>({id:pl.id, power:evaluatePlayerPower(pl.id)}))
    .sort((a,b)=>b.power-a.power);
  if(powers.length<2) return null;
  const top = powers[0], rest = powers.slice(1);
  const restTotal = rest.reduce((s,x)=>s+x.power, 0);
  if(top.power < restTotal*RUNTIME_CONFIG.allianceLeaderVsField) return null;
  if(top.power < rest[0].power*RUNTIME_CONFIG.allianceLeaderMargin) return null;
  return top.id;
}

// The alliance's actual target — "kẻ thù chung" (common enemy). Being the leader only gets a
// player MARKED (game.commonEnemy = {id, startPower}); from then on the gang-up follows the mark,
// not the leader status: it keeps going after the mark's player even once they've dropped below
// the leader thresholds, and a different player who becomes the leader meanwhile is left alone.
// The mark comes off when its player is eliminated or their power falls below
// allianceReleaseFraction (1/3) of what it was when they were marked — only then is the leader
// looked for again, and whoever it is becomes the new common enemy. Returns the target's id or
// null. Called from every AI decision (and at the start of each turn, see startReinforce()), so
// the mark stays current; it lives in game so a saved game / the UI see the same thing.
function updateCommonEnemy(){
  const ce = game.commonEnemy;
  if(ce){
    const pl = game.players[ce.id];
    if(pl && pl.alive && evaluatePlayerPower(ce.id) >= ce.startPower*RUNTIME_CONFIG.allianceReleaseFraction) return ce.id;
    game.commonEnemy = null;
  }
  const leaderId = findAllianceLeader();
  if(leaderId==null) return null;
  game.commonEnemy = { id:leaderId, startPower:evaluatePlayerPower(leaderId) };
  return leaderId;
}

function difficultyProfile(diff, personality){
  // baseThreshold: minimum armies-vs-armies ratio required to attack at all.
  // reserveFactor: how much of a bordering third-party threat to keep in
  //   reserve rather than throw into an attack (higher = more cautious).
  // Both per difficulty, from the config (aiEasy…/aiNormal…/aiHard…).
  const d = diff==='easy' ? 'Easy' : diff==='hard' ? 'Hard' : 'Normal';
  const base = {baseThreshold: RUNTIME_CONFIG['ai'+d+'Threshold'], reserveFactor: RUNTIME_CONFIG['ai'+d+'Reserve']};
  const trait = personalityTraits(personality);
  return {
    baseThreshold: Math.max(1.05, base.baseThreshold + trait.thresholdAdj),
    reserveFactor: Math.max(0, base.reserveFactor * trait.reserveMult),
    killBonusMult: trait.killBonusMult,
    continentBonusMult: trait.continentBonusMult,
  };
}
function difficultyThreshold(diff){ return difficultyProfile(diff).baseThreshold; }

function evaluatePlayerPower(pid){
  const mine = ownedTerritories(pid);
  const armies = mine.reduce((s,id)=> s+(game.armies[id]||0), 0);
  // Reinforcement income (computeReinforcements(), 04-game-state.js: territory-count base +
  // any continent bonuses held) is a leading indicator of SNOWBALL potential, not just current
  // standing army — two players with identical armies/territories right now aren't equally
  // dangerous if one is pulling in twice the income every turn. Weighted up (×6) since its raw
  // range (roughly 3-20) would otherwise barely move a power score in the tens-to-hundreds range.
  // Armies weighted ×2 as the main immediate-threat signal; territory count only ×1 now — its
  // significance is already mostly captured via reinforcements (which derives from it directly),
  // so it's kept around just as a small tie-breaker rather than double-counted at full weight.
  // (Weights from the config — powerWeightArmies / …Territories / …Reinforcements.)
  const reinforcements = computeReinforcements(pid);
  const C = RUNTIME_CONFIG;
  return armies*C.powerWeightArmies + mine.length*C.powerWeightTerritories + reinforcements*C.powerWeightReinforcements;
}

// Would owning `terrId` complete every territory of its continent for `pid`?
function completesContinentFor(pid, terrId){
  const t = mapData.territories[terrId];
  if(!t || t.continentId==null) return false;
  const contTerrs = Object.values(mapData.territories).filter(x=>x.continentId===t.continentId);
  return contTerrs.every(x=> x.id===terrId || game.owner[x.id]===pid);
}

// ---------------------------------------------------------------------
// stay_survival ("sắp chết thì không màng chiếm châu lục") — ưu tiên số 1, xem
// ai-strategy-discussion.md. Ngược với mọi intent khác: ngưỡng tỷ lệ quân số bị ĐẢO
// CHIỀU — ngưỡng THẤP mới là trigger dễ/sớm hơn, vì "cẩn trọng" ở 1 intent phòng thủ
// nghĩa là lo hụt sớm, không phải chờ chắc ăn mới phản ứng. B = tổng quân TOÀN BẢN ĐỒ
// của tôi (khác captureRatio() dùng chung, vốn B chỉ tính quân tại 1 Tỉnh) — công thức
// riêng của intent này. Phần "quân bên thứ 3 phải bị vượt qua" (mối đe doạ 2 bước, không
// giáp biên trực tiếp) CHƯA cài — tài liệu thảo luận xác nhận hướng nhưng chưa có công
// thức cụ thể để code theo.
function evaluateStaySurvival(pid, mood){
  const p = game.players[pid];
  const level = pickTriggerLevel('stay_survival', p.personality, [1,2,3,4], mood);
  if(level===1) return null; // "Vô tư" — bỏ qua hẳn lượt này
  const threshold = level===4 ? captureRatioThreshold('chuQuan')  // 1.15 — dễ trigger nhất
    : level===3 ? captureRatioThreshold('binhThuong')             // 1.5
    : captureRatioThreshold('canThan');                           // 2.0 — khó trigger nhất
  const myTotalArmies = ownedTerritories(pid).reduce((s,id)=> s+(game.armies[id]||0), 0);
  let worstRatio = 0, worstBorderId = null, worstNeighborId = null;
  ownedTerritories(pid).forEach(id=>{
    mapData.territories[id].neighbors.forEach(n=>{
      if(game.owner[n]===pid || game.owner[n]==null) return;
      let enemyArmies = game.armies[n]||0;
      if(level===4) enemyArmies += computeReinforcements(game.owner[n]); // dự phóng tăng viện lượt tới
      const ratio = enemyArmies / Math.max(1, myTotalArmies);
      if(ratio>worstRatio){ worstRatio=ratio; worstBorderId=id; worstNeighborId=n; }
    });
  });
  if(worstBorderId==null || worstRatio<threshold) return null;
  const response = pickResponse('stay_survival', p.personality, [1,2], mood);
  return {type:'stay_survival', level, response, focusTerrId:worstBorderId, threatNeighborId:worstNeighborId};
}

// Kiểm tra "kiểu reserveFor" cho TRỌN đường biên mới của 1 châu lục sau khi chiếm thêm
// `newTerrId` — dùng cho finish_continent Level 4. Đơn giản hoá: so quân hiện có ở mỗi
// lãnh thổ biên châu lục với quân địch mạnh nhất giáp nó (không mô phỏng chuyển quân
// fortify thật, vì lúc trigger chưa biết fortify sẽ đổ bao nhiêu).
// `newTerrIds` = mọi ô còn thiếu (finish_continent giờ cho phép thiếu nhiều ô).
function canHoldContinentBorders(pid, contId, newTerrIds){
  const isNew = id=> newTerrIds.includes(id);
  return continentTerritories(contId).every(t=>{
    const enemyNb = [...t.neighbors].filter(n=> !isNew(n) && game.owner[n]!==pid);
    if(!enemyNb.length) return true;
    const maxEnemy = Math.max(...enemyNb.map(n=>game.armies[n]));
    const myArmies = isNew(t.id) ? 1 : (game.armies[t.id]||0); // ô vừa chiếm: quân tối thiểu doBattle chuyển qua
    return myArmies>=maxEnemy;
  });
}

// ---------------------------------------------------------------------
// LỰC TRÊN 1 LỤC ĐỊA — dùng chung cho finish_continent ("đủ mạnh để chiếm hết các ô còn
// thiếu chưa") và attempt_continent ("lục địa nào mình áp đảo nhất"), nên khi tỉ lệ của 1
// lục địa đang "âm mưu" lên đủ cao thì lượt sau nó tự chín thành finish_continent.
function continentTerritories(contId){
  return Object.values(mapData.territories).filter(t=>t.continentId===contId);
}
function ownsWholeContinent(pid, contId){
  return continentTerritories(contId).every(t=>game.owner[t.id]===pid);
}
// Ô của 1 lục địa mình đã chiếm trọn VÀ đang giáp player khác — không rút quân khỏi đây để
// đi lo lục địa khác (giữ điểm thưởng đang có).
function isProtectedHolding(pid, id){
  const t = mapData.territories[id];
  if(t.continentId==null) return false;
  if(![...t.neighbors].some(n=>game.owner[n]!==pid)) return false;
  return ownsWholeContinent(pid, t.continentId);
}
// Mọi ô của tôi nối liền (qua ô của tôi) với 1 trong các ô `startIds` — tức là quân ở đó có
// đường fortify tới.
function ownedComponentFrom(pid, startIds){
  const seen = new Set(startIds), queue = [...startIds];
  while(queue.length){
    const id = queue.shift();
    mapData.territories[id].neighbors.forEach(n=>{
      if(!seen.has(n) && game.owner[n]===pid){ seen.add(n); queue.push(n); }
    });
  }
  return seen;
}
// A = quân của tôi trong lục địa + quân ngoài lục địa có đường fortify tới (trừ ô được bảo vệ,
// mỗi ô chừa 1) + quân tăng viện lượt này; B = tổng quân địch trên các ô còn thiếu.
// null nếu tôi chưa có ô nào ở đó hoặc đã chiếm trọn.
function continentForce(pid, contId){
  const contTerrs = continentTerritories(contId);
  const mineIn = contTerrs.filter(t=>game.owner[t.id]===pid).map(t=>t.id);
  const missing = contTerrs.filter(t=>game.owner[t.id]!==pid).map(t=>t.id);
  if(!mineIn.length || !missing.length) return null;
  let A = (game.phase==='reinforce' && currentPlayerId()===pid) ? (game.reinforceRemaining||0) : 0;
  ownedComponentFrom(pid, mineIn).forEach(id=>{
    if(mapData.territories[id].continentId!==contId && isProtectedHolding(pid, id)) return;
    A += Math.max(0, (game.armies[id]||0)-1);
  });
  const B = missing.reduce((s,id)=> s+(game.armies[id]||0), 0);
  return {ratio: A/Math.max(1,B), missing};
}
// Ô tập kết của attempt_continent: ô địch YẾU NHẤT trong lục địa mà 1 ô của tôi trong lục địa
// giáp được (targetId), và ô mạnh nhất của tôi trong lục địa giáp nó (stagingId). Không có ô
// địch nào như vậy → ô mạnh nhất của tôi trong lục địa đang giáp địch, rồi ô mạnh nhất bất kỳ.
function attemptContinentStaging(pid, contId){
  const contTerrs = continentTerritories(contId);
  const mineIn = contTerrs.filter(t=>game.owner[t.id]===pid).map(t=>t.id);
  const strongest = ids=> ids.reduce((b,id)=> (b==null || game.armies[id]>game.armies[b]) ? id : b, null);
  let targetId = null;
  contTerrs.forEach(t=>{
    if(game.owner[t.id]===pid) return;
    if(![...t.neighbors].some(n=>mineIn.includes(n))) return;
    if(targetId==null || game.armies[t.id]<game.armies[targetId]) targetId = t.id;
  });
  if(targetId!=null){
    const nb = [...mapData.territories[targetId].neighbors];
    return {targetId, stagingId: strongest(mineIn.filter(id=>nb.includes(id)))};
  }
  const facing = mineIn.filter(id=>[...mapData.territories[id].neighbors].some(n=>game.owner[n]!==pid));
  return {targetId:null, stagingId: strongest(facing.length ? facing : mineIn)};
}

// ---------------------------------------------------------------------
// TURN INTENT ("chiến lược tổng thể của lượt"): computed ONCE at the start
// of the turn (aiRunFullTurn), before reinforce/attack/fortify run. Rather
// than each of those three steps scoring its own options in isolation, they
// all read the same `intent` and bias their scoring toward it — a turn spent
// "closing out a continent" reinforces, attacks AND fortifies toward that
// continent instead of three unrelated locally-greedy choices that just
// happen to run back to back. This mirrors how a human plans a turn: look at
// the whole board first, decide the ONE thing this turn is for, then spend
// every action in service of that — rather than re-deciding from scratch at
// every step.
//
// Mỗi chiến lược là 1 hàm "evaluator" trong AI_STRATEGIES: trả về intent nếu nó khớp (trigger
// = yes) lượt này, null nếu không. Hàm phải KHÔNG có tác dụng phụ (pickAITurnIntent được gọi
// lại khi resume 1 ván lưu giữa lượt). Mỗi chiến lược (trừ fallback) có thang TRIGGER và thang
// ĐỐI SÁCH riêng — xem TRIGGER_LEAN/RESPONSE_LEAN và ai-strategy-discussion.md. `ctx.mood` roll
// 1 lần/lượt, dùng chung cho mọi chiến lược.
//
// Chọn theo TIER ("lọt sàng xuống nia"): xét tier 1 trước; trong 1 tier, lọc mọi chiến lược
// khớp — có 1 thì lấy luôn, có nhiều thì random đều 1 cái — rồi dừng. Không cái nào khớp thì
// xuống tier sau. Tier cuối còn có chiến lược FALLBACK (attempt_continent), chỉ dùng khi không
// còn gì khác khớp, nên lúc nào cũng chọn được. Thêm chiến lược mới = viết evaluator rồi bỏ tên
// vào AI_TIERED_STRATEGIES + 1 key aiTier<Tên> trong src/config.json và server/admin-config.js.
// Tier của mỗi chiến lược lấy từ config (aiTier<Tên>, chỉnh trên trang /admin): "0" = tắt,
// "1".."5" = tier đó. Fallback (AI_FALLBACK_STRATEGY) không có trong danh sách — luôn đứng cuối.
// `expand` mặc định tắt nhưng vẫn là lưới an toàn cuối cùng khi chính fallback không có mục tiêu
// (mọi lục địa tôi có mặt đều đã chiếm trọn).
const AI_TIERED_STRATEGIES = ['stay_survival', 'kill_weak', 'push_to_win', 'defend', 'break_continent',
  'finish_continent', 'revenge', 'expand'];
const AI_FALLBACK_STRATEGY = 'attempt_continent';
function strategyTierKey(name){
  return 'aiTier'+name.split('_').map(w=> w[0].toUpperCase()+w.slice(1)).join('');
}
// [[tên…] của tier nhỏ nhất, …] — tier trống bị bỏ qua.
function strategyTiers(){
  const byTier = {};
  AI_TIERED_STRATEGIES.forEach(name=>{
    const tier = Number(RUNTIME_CONFIG[strategyTierKey(name)]);
    if(!(tier>=1)) return; // "0" hoặc thiếu = tắt
    (byTier[tier] = byTier[tier] || []).push(name);
  });
  return Object.keys(byTier).map(Number).sort((a,b)=>a-b).map(t=> byTier[t]);
}

const AI_STRATEGIES = {
  // "Sắp chết thì không màng chiếm châu lục" — xem evaluateStaySurvival() ở trên.
  stay_survival: ctx=> evaluateStaySurvival(ctx.pid, ctx.mood),

  // Đối thủ còn ít lãnh thổ và giáp đất tôi — kết liễu để lấy hết bài của họ.
  kill_weak: ctx=>{
    const {pid, p, mood} = ctx;
    const killLevel = pickTriggerLevel('kill_weak', p.personality, [1,2,3,4], mood);
    if(killLevel<=1) return null;
    const maxTerrs = killLevel>=4 ? 3 : 2;
    let weakTarget=null, weakCount=Infinity;
    ctx.opponents.forEach(pl=>{
      const terrs = ownedTerritories(pl.id);
      if(terrs.length===0 || terrs.length>maxTerrs) return;
      const reachable = terrs.some(tid=>[...mapData.territories[tid].neighbors].some(n=>game.owner[n]===pid));
      if(!reachable) return;
      if(killLevel>=4){
        // "đủ ít để tôi khả năng kết liễu trong 1-2 lượt" — xấp xỉ bằng tổng quân của họ so
        // với sức mạnh của tôi, không mô phỏng chiến đấu thật.
        const theirArmies = terrs.reduce((s,id)=>s+(game.armies[id]||0), 0);
        if(theirArmies > ctx.myPower*0.5) return;
      }
      if(terrs.length<weakCount){ weakCount=terrs.length; weakTarget=pl.id; }
    });
    if(weakTarget==null) return null;
    const response = pickResponse('kill_weak', p.personality, ['A','B'], mood);
    return {type:'kill_weak', level:killLevel, response, targetPlayerId:weakTarget};
  },

  // Biên yếu nhất — chỉ xét tỉnh thuộc châu lục tôi đã chiếm trọn (biên ở châu lục đang âm mưu
  // hay không quan tâm thì kệ), và chỉ khi tôi không phải người mạnh nhất bàn.
  defend: ctx=>{
    const {pid, p, mood} = ctx;
    const defendLevel = pickTriggerLevel('defend', p.personality, [1,2,3], mood);
    if(defendLevel<=1 || ctx.myPower>=ctx.leaderPower) return null;
    const held = weakestBorder(pid, ctx.mine.filter(id=>{
      const c = mapData.territories[id].continentId;
      return c!=null && ownsWholeContinent(pid, c);
    }));
    if(held.id==null || held.deficit < (defendLevel>=3 ? 1 : 2)) return null;
    const response = pickResponse('defend', p.personality, ['A','B'], mood);
    return {type:'defend', level:defendLevel, response, focusTerrId:held.id};
  },

  // Thiếu bao nhiêu ô cũng được, miễn tổng lực (continentForce) ≥ ngưỡng Cẩn thận và ít nhất 1 ô
  // còn thiếu giáp ô của tôi. Nhiều lục địa cùng đạt → lấy tỉ lệ cao nhất.
  finish_continent: ctx=>{
    const {pid, p, mood} = ctx;
    const contLevel = pickTriggerLevel('finish_continent', p.personality, [1,2,3,4], mood);
    if(contLevel<=1) return null;
    let best = null;
    ctx.forces.forEach(({contId, force})=>{
      const frontier = force.missing.filter(id=>[...mapData.territories[id].neighbors].some(n=>game.owner[n]===pid));
      if(!frontier.length) return;
      if(force.ratio < captureRatioThreshold('canThan')) return;
      if(contLevel>=4 && !canHoldContinentBorders(pid, contId, force.missing)) return;
      if(best && force.ratio<=best.ratio) return;
      const focus = frontier.reduce((b,id)=> (b==null || game.armies[id]<game.armies[b]) ? id : b, null);
      best = {contId, ratio:force.ratio, focus};
    });
    if(!best) return null;
    const response = pickResponse('finish_continent', p.personality, ['A','B'], mood);
    return {type:'finish_continent', level:contLevel, response, continentId:best.contId, focusTerrId:best.focus};
  },

  // Áp đảo rõ cả bàn → bỏ dè dặt, đánh dồn để kết thúc ván. Level 3: sức mạnh ≥ 0.8 × tổng các
  // đối thủ còn lại; Level 2: ≥ 1.0 ×. Đối sách A "dồn dập" (+0.8 mọi đòn), B "tất tay" (+1.5
  // mọi đòn và không giữ quân dự phòng) — xem attackScore()/reserveFor() ở aiAttackStep.
  push_to_win: ctx=>{
    const {p, mood} = ctx;
    const level = pickTriggerLevel('push_to_win', p.personality, [1,2,3], mood);
    if(level<=1 || !ctx.opponents.length) return null;
    const oppTotal = ctx.opponents.reduce((s,pl)=> s+evaluatePlayerPower(pl.id), 0);
    if(ctx.myPower < oppTotal*(level>=3 ? 0.8 : 1.0)) return null;
    const response = pickResponse('push_to_win', p.personality, ['A','B'], mood);
    return {type:'push_to_win', level, response};
  },

  // Đối thủ đang giữ trọn 1 châu lục giáp đất tôi → đánh vào 1 ô để cắt thưởng của họ. Ô nhắm =
  // ô của châu lục đó có Tỷ lệ quân số (captureRatio) tốt nhất cho tôi; Level 3 cần ≥ Chủ quan
  // (1.15), Level 2 ≥ Bình thường (1.5). Nhiều châu lục đạt → thưởng cao nhất, rồi tỉ lệ tốt nhất.
  // Đối sách A: chiếm 1 ô là thôi; B: chiếm xong vẫn đánh tiếp như thường.
  break_continent: ctx=>{
    const {pid, p, mood} = ctx;
    const level = pickTriggerLevel('break_continent', p.personality, [1,2,3], mood);
    if(level<=1) return null;
    const bar = captureRatioThreshold(level>=3 ? 'chuQuan' : 'binhThuong');
    let best = null;
    Object.values(mapData.continents).forEach(c=>{
      const contId = c.id;
      const terrs = continentTerritories(contId);
      if(!terrs.length) return;
      const holder = game.owner[terrs[0].id];
      if(holder==null || holder===pid || !terrs.every(t=>game.owner[t.id]===holder)) return;
      const bonus = c.bonus||0;
      terrs.forEach(t=>{
        if(![...t.neighbors].some(n=>game.owner[n]===pid)) return;
        const ratio = captureRatio(pid, t.id);
        if(ratio<bar) return;
        if(!best || bonus>best.bonus || (bonus===best.bonus && ratio>best.ratio))
          best = {contId, holder, bonus, ratio, terrId:t.id};
      });
    });
    if(!best) return null;
    const response = pickResponse('break_continent', p.personality, ['A','B'], mood);
    return {type:'break_continent', level, response, continentId:best.contId, targetPlayerId:best.holder, focusTerrId:best.terrId};
  },

  // Ai đánh tôi đau nhất kể từ cuối lượt trước của tôi (game.damageTaken, ghi ở doBattle) thì
  // lượt này nhắm vào họ. Mức đau = số ô bị chiếm × 3 + số quân mất. Level 3 "thù dai": ≥ 3;
  // Level 2: ≥ 6. Họ phải còn sống và giáp đất tôi. Đối sách A "trả đũa": chiếm 1 ô của họ là
  // thôi; B "truy cùng": thưởng nặng hơn, đánh tiếp.
  revenge: ctx=>{
    const {pid, p, mood} = ctx;
    const level = pickTriggerLevel('revenge', p.personality, [1,2,3], mood);
    if(level<=1) return null;
    const hurt = (game.damageTaken && game.damageTaken[pid]) || {};
    const bar = level>=3 ? 3 : 6;
    let target = null, worst = 0;
    Object.keys(hurt).forEach(k=>{
      const aid = Number(k), pl = game.players[aid];
      if(!pl || !pl.alive || aid===pid) return;
      const pain = hurt[k].territories*3 + hurt[k].armies;
      if(pain<bar || pain<=worst) return;
      const borders = ctx.mine.some(id=>[...mapData.territories[id].neighbors].some(n=>game.owner[n]===aid));
      if(!borders) return;
      target = aid; worst = pain;
    });
    if(target==null) return null;
    const response = pickResponse('revenge', p.personality, ['A','B'], mood);
    return {type:'revenge', level, response, targetPlayerId:target};
  },

  // FALLBACK — "âm mưu chiếm lục địa": lục địa tôi áp đảo nhất (cùng chỉ số continentForce với
  // finish_continent), dồn quân vào đó và chờ nó chín. Không có thang trigger/đối sách riêng.
  attempt_continent: ctx=>{
    if(!ctx.forces.length) return null;
    const best = ctx.forces.reduce((b,x)=> (!b || x.force.ratio>b.force.ratio) ? x : b, null);
    return {type:'attempt_continent', continentId:best.contId};
  },

  // Mặc định tắt (aiTierExpand = "0") — luôn trả intent nên còn dùng làm lưới an toàn cuối.
  expand: ctx=>{
    const {pid, p, mood} = ctx;
    const expandLevel = pickTriggerLevel('expand', p.personality, [1,2,3], mood);
    const expandResponse = pickResponse('expand', p.personality, ['A','B'], mood);
    let expandFocus = weakestBorder(pid, ctx.mine).id;
    if(expandLevel>=3){
      // "Cơ hội nhất" — chọn cặp (biên của tôi, láng giềng địch) có tỉ lệ quân tốt nhất (ước
      // lượng thô; attackScore() ở aiAttackStep vẫn tính lại đầy đủ trước khi thực sự đánh).
      let bestRatio=-Infinity;
      ctx.mine.forEach(id=>{
        mapData.territories[id].neighbors.forEach(n=>{
          if(game.owner[n]===pid) return;
          const ratio = (game.armies[id]||0)/Math.max(1, game.armies[n]||1);
          if(ratio>bestRatio){ bestRatio=ratio; expandFocus=id; }
        });
      });
    }
    return {type:'expand', level:expandLevel, response:expandResponse, focusTerrId:expandFocus};
  },
};

// Biên yếu nhất trong `ids`: chênh lệch = quân địch mạnh nhất giáp nó − quân tôi ở đó.
function weakestBorder(pid, ids){
  let id0=null, deficit0=-Infinity;
  ids.forEach(id=>{
    const enemyNb = [...mapData.territories[id].neighbors].filter(n=>game.owner[n]!==pid);
    if(!enemyNb.length) return;
    const deficit = Math.max(...enemyNb.map(n=>game.armies[n])) - game.armies[id];
    if(deficit>deficit0){ deficit0=deficit; id0=id; }
  });
  return {id:id0, deficit:deficit0};
}

function pickAITurnIntent(pid){
  const mine = ownedTerritories(pid);
  const opponents = game.players.filter(pl=>pl.alive && pl.id!==pid);
  let leaderPower = -1;
  opponents.forEach(pl=>{ leaderPower = Math.max(leaderPower, evaluatePlayerPower(pl.id)); });
  // Lục địa tôi có ≥1 ô mà chưa chiếm trọn — ứng viên của finish_continent lẫn attempt_continent.
  const continentIds = [...new Set(mine.map(id=>mapData.territories[id].continentId).filter(c=>c!=null))];
  const ctx = {
    pid, p: game.players[pid], mood: rollTurnMood(), mine, opponents, leaderPower,
    myPower: evaluatePlayerPower(pid),
    forces: continentIds.map(contId=>({contId, force:continentForce(pid, contId)})).filter(x=>x.force),
  };
  for(const tier of strategyTiers()){
    const matched = tier.map(name=> AI_STRATEGIES[name](ctx)).filter(Boolean);
    if(matched.length===1) return matched[0];
    if(matched.length>1) return matched[Math.floor(random()*matched.length)];
  }
  return AI_STRATEGIES[AI_FALLBACK_STRATEGY](ctx) || AI_STRATEGIES.expand(ctx);
}

function pickAIReinforceTarget(pid, mine, intent){
  // Same gang-up logic as aiAttackStep's reserveFor(): once a runaway leader has locked every
  // other AI into "attack only the leader" this turn, a border facing a fellow non-leader isn't
  // a real threat (they won't attack it either) — so new reinforcements shouldn't be pulled
  // toward defending it. Only borders facing the leader still count as under threat.
  const allianceLeaderId = game.allianceEnabled ? updateCommonEnemy() : null;
  const mustOnlyDefendAgainstLeader = allianceLeaderId!=null && pid!==allianceLeaderId;
  // This turn's single-minded focus, if it has one: the gang-up leader (forced on every other
  // AI), or — for the leader itself, or anyone else not under that lock — a kill_weak intent's
  // chosen victim. Below, a border facing this focus wins outright over every other border,
  // regardless of score, so reinforcement actually piles into one decisive spearhead instead of
  // the base score's tendency to spread just-enough parity across every front at once (the base
  // "maxEnemyArmy - myArmy" term only ever tries to level the score, never to overwhelm it).
  const focusPlayerId = mustOnlyDefendAgainstLeader ? allianceLeaderId
    : (intent && (intent.type==='kill_weak' || intent.type==='revenge') ? intent.targetPlayerId : null);
  // stay_survival overrides even the kill_weak/leader focus above — a border about to be
  // wiped out always wins outright over any other reinforcement plan this turn.
  const focusTerrIdOverride = (intent && intent.type==='stay_survival') ? intent.focusTerrId : null;
  if(focusTerrIdOverride!=null && mine.includes(focusTerrIdOverride)) return focusTerrIdOverride;
  // attempt_continent bước 2: dồn hết tăng viện vào 1 ô trong lục địa mục tiêu, ưu tiên ô giáp ô
  // địch yếu nhất trong lục địa (để bước 3 đánh được nếu cần). Khoá liên minh vẫn được ưu tiên hơn.
  if(intent && intent.type==='attempt_continent' && !mustOnlyDefendAgainstLeader){
    const s = attemptContinentStaging(pid, intent.continentId);
    if(s.stagingId!=null) return s.stagingId;
  }
  // break_continent: dồn hết vào ô mạnh nhất của tôi giáp ô định phá.
  if(intent && intent.type==='break_continent' && !mustOnlyDefendAgainstLeader){
    const nb = [...mapData.territories[intent.focusTerrId].neighbors].filter(n=>mine.includes(n));
    if(nb.length) return nb.reduce((b,id)=> game.armies[id]>game.armies[b] ? id : b);
  }
  let best=null, bestScore=-Infinity;
  let bestFocus=null, bestFocusScore=-Infinity;
  mine.forEach(id=>{
    const t = mapData.territories[id];
    const enemyNb = [...t.neighbors].filter(n=>game.owner[n]!==pid);
    if(enemyNb.length===0) return; // only border territories are worth reinforcing
    const threatNb = mustOnlyDefendAgainstLeader ? enemyNb.filter(n=>game.owner[n]===allianceLeaderId) : enemyNb;
    const maxEnemyArmy = threatNb.length ? Math.max(...threatNb.map(n=>game.armies[n])) : 0;
    let score = maxEnemyArmy - game.armies[id];
    if(t.continentId!=null){
      const contTerrs = Object.values(mapData.territories).filter(x=>x.continentId===t.continentId);
      const ownedCount = contTerrs.filter(x=>game.owner[x.id]===pid).length;
      if(ownedCount===contTerrs.length) score += 1.5;       // defend a continent I already hold
      else if(ownedCount>=contTerrs.length-1) score += 0.8; // one territory away from completing it
    }
    // Nudge reinforcement toward wherever this turn's chosen campaign (see
    // pickAITurnIntent) is actually happening, so troops don't land on some
    // unrelated border just because it scored marginally higher locally.
    if(intent){
      if(intent.type==='finish_continent' && t.continentId===intent.continentId) score += 1.2;
      else if(intent.type==='kill_weak' && enemyNb.some(n=>game.owner[n]===intent.targetPlayerId)) score += 1.2;
      else if((intent.type==='defend'||intent.type==='expand') && id===intent.focusTerrId) score += 1.0;
    }
    if(focusPlayerId!=null && enemyNb.some(n=>game.owner[n]===focusPlayerId)){
      if(score>bestFocusScore){ bestFocusScore=score; bestFocus=id; }
    }
    if(score>bestScore){ bestScore=score; best=id; }
  });
  if(focusPlayerId!=null && bestFocus!=null) return bestFocus;
  if(best===null) best = randChoice(mine);
  return best;
}

// Human-readable flavor text for the "<name> đang suy nghĩ..." hint shown throughout an AI
// turn (see aiSetStepHint() below) — the WHY behind this turn's campaign (pickAITurnIntent),
// in plain Vietnamese: the strategy's name plus its target. Shows WHICH strategy fired, but
// never its trigger level/response — showing those would spoil the "khó đoán" quality the
// level system is for.
const AI_INTENT_LABELS = {
  stay_survival: 'Sống còn',
  finish_continent: 'Hoàn tất châu lục',
  attempt_continent: 'Âm mưu chiếm châu lục',
  push_to_win: 'Tổng tấn công',
  break_continent: 'Phá châu lục',
  revenge: 'Trả thù',
  kill_weak: 'Kết liễu đối thủ yếu',
  defend: 'Phòng thủ biên giới',
  expand: 'Mở rộng',
};
function describeAITurnIntent(intent){
  const label = AI_INTENT_LABELS[intent.type] || intent.type;
  switch(intent.type){
    case 'stay_survival': case 'defend': {
      const t = mapData.territories[intent.focusTerrId];
      return label+(t?' ở '+t.name:'');
    }
    case 'finish_continent': case 'attempt_continent': {
      const c = mapData.continents[intent.continentId];
      return label+(c?' '+c.name:'');
    }
    case 'kill_weak': case 'revenge': {
      const target = game.players[intent.targetPlayerId];
      return label+(target?' ('+target.name+')':'');
    }
    case 'break_continent': {
      const c = mapData.continents[intent.continentId], holder = game.players[intent.targetPlayerId];
      return label+(c?' '+c.name:'')+(holder?' của '+holder.name:'');
    }
    default: // expand
      return label;
  }
}
// Every step of an AI turn (reinforce/attack/fortify, see aiRunFullTurn below) sets its own
// hint instead of 1 generic "đang suy nghĩ..." for the whole turn — `step` names what's
// happening RIGHT NOW ("đặt quân tăng viện", "tấn công", …), ai-strategy-discussion.md's
// WHY (describeAITurnIntent above) rides along so a viewer can follow 1 campaign across all
// 4 steps instead of 4 unrelated-looking actions. Reuses whatever aiDelay() pacing the
// caller is already scheduling its NEXT step with — no separate "how long to show a hint"
// setting, same "Độ trễ khi xem AI đấu" knob paces both.
function aiSetStepHint(pid, intent, step){
  host.setActionHint(game.players[pid].name+' · 🎯 '+describeAITurnIntent(intent)+' — đang '+step);
}

function aiRunFullTurn(pid){
  const intent = pickAITurnIntent(pid);
  logMsg('info', game.players[pid].name+' chọn chiến lược: '+describeAITurnIntent(intent)+'.', pid);
  aiSetStepHint(pid, intent, 'suy nghĩ');
  aiSchedule(()=>{ aiReinforceStep(pid, intent); }, aiDelay(300));
}

function aiReinforceStep(pid, intent){
  intent = intent || pickAITurnIntent(pid); // e.g. resuming a save mid-phase, see importGameJSON
  const p = game.players[pid];
  aiSetStepHint(pid, intent, 'đặt quân tăng viện');
  aiTryTradeCards(p);
  let guard=0;
  while(game.reinforceRemaining>0 && guard++<200){
    const mine = ownedTerritories(pid);
    const target = pickAIReinforceTarget(pid, mine, intent);
    game.armies[target]++;
    game.reinforceRemaining--;
  }
  host.renderGame();
  aiSchedule(()=> aiAttackStep(pid, intent), aiDelay(350));
}

function aiTryTradeCards(p){
  let guard=0;
  // How willing the AI is to hold a valid combo instead of cashing it in immediately depends
  // on which trade rule is active (see tradeInValue() for what each rule means):
  //  - progressive: the shared global count only goes up, so a LATER trade always pays MORE —
  //    holding is a real (if risky, since forced at 5 cards) strategy, so hold fairly often.
  //  - fixed: the reward depends only on the set traded, so waiting gains nothing — trade ASAP.
  //  - exponential: only the player's OWN trade count matters, and it compounds — the sooner
  //    (and more often) this AI personally trades, the faster ITS OWN future trades ramp up, so
  //    trade ASAP rather than sitting on cards that aren't growing in value by waiting.
  const holdChance = game.tradeRule==='progressive' ? 0.7 : 0.1;
  while(guard++<10){
    const combo = findTradeCombo(p.cards);
    const forced = p.cards.length>=5;
    if(!combo) break;
    if(!forced && random()<holdChance && p.cards.length<5) break; // sometimes hold cards
    tradeCards(p, combo);
  }
}

// The valid combo that pays the most (only the fixed rule pays differently per set; under the
// other rules every valid combo is worth the same, so the first one found stays).
function findTradeCombo(cards){
  let best = null, bestValue = -1;
  for(let i=0;i<cards.length;i++) for(let j=i+1;j<cards.length;j++) for(let k=j+1;k<cards.length;k++){
    const set=[cards[i],cards[j],cards[k]];
    const uniq = new Set(set);
    if(uniq.size!==1 && uniq.size!==3) continue;
    const value = tradeInValue(game.tradeRule, 0, 0, set);
    if(value>bestValue){ best=[i,j,k]; bestValue=value; }
  }
  return best;
}

function tradeCards(p, indices){
  const idxSorted = indices.slice().sort((a,b)=>b-a);
  const removed = idxSorted.map(i=>p.cards[i]);
  idxSorted.forEach(i=> p.cards.splice(i,1));
  const value = tradeInValue(game.tradeRule, game.tradeCount, p.personalTradeCount||0, removed);
  game.tradeCount++;
  p.personalTradeCount = (p.personalTradeCount||0)+1;
  p.totalReinforced += value;
  if(game.phase==='reinforce' && currentPlayerId()===p.id){
    game.reinforceRemaining += value;
  } else {
    game.pool[p.id] = (game.pool[p.id]||0) + value;
  }
  logMsg('info', p.name+' đổi thẻ bài lấy '+value+' quân.', p.id);
  host.renderGame();
}

// stay_survival Response 1 ("Đánh rỉa") — vẫn cố kiếm 1 lá bài rồi dừng hẳn, không đánh
// tiếp lượt này (khác hẳn cách step() bên dưới đánh liên tục tới khi hết mục tiêu ngon).
// Chọn mục tiêu theo cardAwardEvent đang bật (xem ai-strategy-discussion.md):
//  - on_capture (mặc định): chọn đúng 1 ô địch ÍT QUÂN NHẤT mà tôi đánh được, cố chiếm.
//  - on_kill: đánh đúng 1 hiệp có lợi (ratio ≥ 1.05) rồi dừng, không cần chiếm được.
//  - on_turn_end: không cần đánh gì (xử lý ở nơi gọi, trước khi tới đây).
function staySurvivalNibble(pid, intent){
  const p = game.players[pid];
  const mine = ownedTerritories(pid);
  if(RUNTIME_CONFIG.cardAwardEvent==='on_kill'){
    let bestOpt=null, bestRatio=-Infinity;
    mine.forEach(from=>{
      if(game.armies[from]<2) return;
      mapData.territories[from].neighbors.forEach(to=>{
        if(game.owner[to]===pid) return;
        const ratio = game.armies[from]/Math.max(1,game.armies[to]);
        if(ratio>=1.05 && ratio>bestRatio){ bestRatio=ratio; bestOpt={from,to}; }
      });
    });
    if(bestOpt){
      const { from, to } = bestOpt;
      const toName = mapData.territories[to].name, fromName = mapData.territories[from].name;
      doBattle(from, to, {});
      logMsg('info', p.name+' đánh rỉa 1 hiệp vào '+toName+' từ '+fromName+' rồi dừng.', pid);
    }
    host.renderGame();
    aiSchedule(()=> aiFortifyStep(pid, intent), aiDelay(260)); // give the hint above its beat
    return;
  }
  // on_capture — chọn đúng 1 ô địch ít quân nhất mà tôi đánh được (usable>=1), cố chiếm.
  let bestOpt=null, bestEnemyArmies=Infinity;
  mine.forEach(from=>{
    const usable = game.armies[from]-1;
    if(usable<1) return;
    mapData.territories[from].neighbors.forEach(to=>{
      if(game.owner[to]===pid) return;
      if(game.armies[to]<bestEnemyArmies){ bestEnemyArmies=game.armies[to]; bestOpt={from,to}; }
    });
  });
  if(!bestOpt){ aiSchedule(()=> aiFortifyStep(pid, intent), aiDelay(260)); return; }
  const { from, to } = bestOpt;
  game.selectedFrom=from; game.selectedTo=to; host.renderGame();
  aiSchedule(()=>{
    if(game.over) return;
    let rounds=0, captured=false;
    while(game.armies[from]>=2 && game.armies[to]>0 && rounds<5000){
      const res = doBattle(from, to, {silent:true});
      rounds++;
      if(res.captured){ captured=true; break; }
    }
    game.selectedFrom=null; game.selectedTo=null;
    if(rounds>0) logMsg('info', p.name+' đánh rỉa '+mapData.territories[to].name+(captured?' và chiếm được!':' rồi dừng.'), pid);
    host.renderGame();
    if(game.over) return;
    aiFortifyStep(pid, intent);
  }, aiDelay(260));
}

// 1 trận đánh của AI từ `from` vào `to`: chỉ mục tiêu 1 nhịp, rồi đánh liên tục (log gộp 1
// dòng, có animation như executeAttack ở aiAttackStep) cho tới khi chiếm được, hết quân, hoặc
// keepGoing() trả false. Xong thì gọi onDone(captured).
function aiStrike(pid, from, to, keepGoing, onDone){
  const p = game.players[pid];
  game.selectedFrom = from; game.selectedTo = to;
  host.renderGame();
  aiSchedule(()=>{
    if(game.over) return;
    const fromName = mapData.territories[from].name, toName = mapData.territories[to].name;
    const defenderId = game.owner[to], defP = game.players[defenderId];
    const fromCountBefore = game.armies[from], toCountBefore = game.armies[to];
    let rounds=0, attLoss=0, defLoss=0, captured=false, lastRes=null;
    while(rounds<5000 && game.armies[from]>=2 && keepGoing()){
      lastRes = doBattle(from, to, {silent:true});
      rounds++; attLoss += lastRes.attLoss; defLoss += lastRes.defLoss;
      recordBattleStat(p.name, defP.name, fromName, toName, attLoss+defLoss);
      if(lastRes.captured){ captured=true; break; }
    }
    function finish(){
      game.selectedFrom=null; game.selectedTo=null;
      if(game.over) return;
      aiSchedule(()=> onDone(captured), 80);
    }
    if(!rounds){ host.renderGame(); finish(); return; }
    const roundsLabel = rounds>1 ? ` (${rounds} hiệp)` : '';
    logMsg('attack', `${p.name} tấn công ${toName} từ ${fromName}${roundsLabel}: mất ${attLoss}, đối phương mất ${defLoss}.`, [pid, defenderId]);
    host.showDice(lastRes.ad, lastRes.dd, lastRes.results);
    if(captured) logMsg('capture', `${p.name} chiếm được ${toName}!`, [pid, defenderId]);
    host.startAttackAnim({
      fromId:from, toId:to, attLoss, defLoss, captured,
      fromCountBefore, toCountBefore, fromCountAfter:game.armies[from], toCountAfter:game.armies[to],
      attackerColor:p.color, defenderColor:defP.color,
    }, finish);
    host.renderGame();
  }, aiDelay(260));
}

// attempt_continent bước 3 — giữ nguyên lực lượng cho lục địa mục tiêu, chỉ cố kiếm 1 lá bài:
//  a. "Hú họa": dùng quân ở ô KHÔNG có đường fortify tới lục địa (vô dụng cho kế hoạch), đánh 1
//     ô địch có tỉ lệ tốt nhất, đánh tới khi chiếm được hoặc hết quân.
//  b. Không chiếm được (hoặc không có ô nào như vậy) → đánh ô địch ÍT QUÂN NHẤT trong lục địa từ ô
//     mạnh nhất của tôi giáp nó, dừng khi tỉ lệ xuống dưới ngưỡng tấn công thường của độ khó —
//     mong các ô nhiều quân của player khác trong lục địa bỏ đi hoặc đánh lẫn nhau.
// Mỗi trận chỉ nhắm 1 ô; chiếm được 1 ô là thôi tấn công lượt này.
function attemptContinentAttack(pid, intent){
  const p = game.players[pid];
  const contId = intent.continentId;
  const leaderId = game.allianceEnabled ? updateCommonEnemy() : null;
  const allowed = to=> game.owner[to]!==pid && (leaderId==null || leaderId===pid || game.owner[to]===leaderId);
  const toFortify = ()=> aiFortifyStep(pid, intent);

  function inContinent(){
    const threshold = difficultyProfile(game.difficulty, p.personality).baseThreshold;
    let to = null;
    continentTerritories(contId).forEach(t=>{
      if(!allowed(t.id)) return;
      if(![...t.neighbors].some(n=>game.owner[n]===pid && game.armies[n]>=2)) return;
      if(to==null || game.armies[t.id]<game.armies[to]) to = t.id;
    });
    const from = to==null ? null : [...mapData.territories[to].neighbors]
      .filter(n=>game.owner[n]===pid && game.armies[n]>=2)
      .reduce((b,id)=> (b==null || game.armies[id]>game.armies[b]) ? id : b, null);
    const ratioOk = ()=> game.armies[from]/Math.max(1, game.armies[to]) >= threshold;
    if(from==null || !ratioOk()){ aiSchedule(toFortify, aiDelay(260)); return; }
    aiSetStepHint(pid, intent, 'thăm dò trong lục địa');
    aiStrike(pid, from, to, ratioOk, toFortify);
  }

  const mineIn = ownedTerritories(pid).filter(id=>mapData.territories[id].continentId===contId);
  const reach = ownedComponentFrom(pid, mineIn);
  let best=null, bestRatio=-Infinity;
  ownedTerritories(pid).forEach(from=>{
    if(reach.has(from) || game.armies[from]<2) return;
    mapData.territories[from].neighbors.forEach(to=>{
      if(!allowed(to)) return;
      const r = game.armies[from]/Math.max(1, game.armies[to]);
      if(r>bestRatio){ bestRatio=r; best={from,to}; }
    });
  });
  if(!best){ aiSetStepHint(pid, intent, 'giữ quân'); inContinent(); return; }
  aiSetStepHint(pid, intent, 'đánh hú hoạ kiếm bài');
  aiStrike(pid, best.from, best.to, ()=>true, captured=> captured ? toFortify() : inContinent());
}

function aiAttackStep(pid, intent){
  intent = intent || pickAITurnIntent(pid); // e.g. resuming a save mid-phase, see importGameJSON
  game.phase='attack';
  const p = game.players[pid];
  // stay_survival Response 2 ("co cụm") — không tấn công gì cả lượt, đi thẳng sang fortify
  // để dồn quân về đúng biên bị đe doạ (xem pickAIReinforceTarget's focusTerrIdOverride và
  // isIntentFront ở aiFortifyStep). Response 1 dưới cardAwardEvent==='on_turn_end' cũng
  // "behave như Response 2" vì không cần đánh mới có bài. expand Level 1 ("Rụt rè") cũng
  // không chủ động tấn công — chỉ reinforce/fortify.
  if(intent.type==='stay_survival'){
    if(intent.response===2 || RUNTIME_CONFIG.cardAwardEvent==='on_turn_end'){
      aiSetStepHint(pid, intent, 'co cụm phòng thủ');
      aiSchedule(()=> aiFortifyStep(pid, intent), aiDelay(260)); return;
    }
    aiSetStepHint(pid, intent, 'đánh rỉa kiếm bài');
    staySurvivalNibble(pid, intent); return;
  }
  if(intent.type==='expand' && intent.level===1){
    aiSetStepHint(pid, intent, 'giữ nguyên quân, không mạo hiểm');
    aiSchedule(()=> aiFortifyStep(pid, intent), aiDelay(260)); return;
  }
  if(intent.type==='attempt_continent'){ attemptContinentAttack(pid, intent); return; }
  aiSetStepHint(pid, intent, 'tấn công');
  const profile = difficultyProfile(game.difficulty, p.personality);
  const opponents = game.players.filter(pl=>pl.alive && pl.id!==pid);
  const myPower = evaluatePlayerPower(pid);
  let leaderId = null, leaderPower = -1;
  opponents.forEach(pl=>{ const pw = evaluatePlayerPower(pl.id); if(pw>leaderPower){ leaderPower=pw; leaderId=pl.id; } });
  // Only computed when the setting is on — findAllianceLeader() scans every alive player
  // (self included) and requires a real margin over the runner-up (see its own comment).
  const allianceLeaderId = game.allianceEnabled ? updateCommonEnemy() : null;
  const iAmAllianceLeader = pid!=null && pid===allianceLeaderId;
  // Hard gang-up: once there's a runaway leader, every other AI attacks ONLY the leader's
  // territories this turn — no picking on a fellow underdog instead, no falling back to
  // opportunistic expansion elsewhere. If nothing of theirs borders the leader, they simply
  // don't attack at all this turn (see the candidate-loop filter in step() below, and the
  // "no legal attack" path at bestOpt===null, which already skips straight to fortify).
  const mustOnlyAttackLeader = allianceLeaderId!=null && !iAmAllianceLeader;

  // How many armies a territory should keep in reserve, sized to the strongest
  // enemy neighbor it borders OTHER than the one currently being considered.
  // Once gang-up mode is active (mustOnlyAttackLeader), every other non-leader AI is under the
  // same rule — none of them will attack anywhere but the leader this turn either — so a fellow
  // non-leader neighbor isn't a real threat right now. Only the leader's own bordering
  // territories still justify holding troops back; everything else is freed up to go into the
  // leader front instead of sitting idle "just in case" against an ally.
  function reserveFor(fromId, excludeTo){
    if(intent.type==='push_to_win' && intent.response==='B') return 0; // "tất tay"
    const t = mapData.territories[fromId];
    let maxOther = 0;
    t.neighbors.forEach(n=>{
      if(n===excludeTo) return;
      if(game.owner[n]===pid) return;
      if(mustOnlyAttackLeader && game.owner[n]!==allianceLeaderId) return;
      maxOther = Math.max(maxOther, game.armies[n]);
    });
    return Math.ceil(maxOther*profile.reserveFactor);
  }

  function attackScore(fromId, toId){
    const usable = Math.max(0, game.armies[fromId]-1-reserveFor(fromId,toId));
    if(usable<1) return null; // nothing safe to attack with once the reserve is set aside
    const singleRatio = (usable+1)/Math.max(1,game.armies[toId]);
    // Area-level superiority: every OTHER territory of mine that also borders `toId` counts as
    // backup for a coordinated campaign, not just `fromId` in isolation — a target flanked by two
    // of my stacks is winnable in a 2-move campaign even if neither stack alone clears the odds
    // bar on its own, the same way a human wouldn't size up a contested border by just one
    // province. step() re-evaluates after every attack, so a weaker opening strike here naturally
    // sets up whichever territory follows to finish off whatever's left standing.
    // Blended with (not replacing) the single-territory ratio rather than used outright: this
    // particular attack only actually commits `fromId`'s own army, so full credit for strength
    // that hasn't swung yet — and might get spent elsewhere, or lost first — would be overconfident.
    let areaUsable = usable;
    mapData.territories[toId].neighbors.forEach(nb=>{
      if(nb!==fromId && game.owner[nb]===pid) areaUsable += Math.max(0, game.armies[nb]-1-reserveFor(nb,toId));
    });
    const ratio = areaUsable>usable ?
      (singleRatio + (areaUsable+1)/Math.max(1,game.armies[toId]))/2 : singleRatio;
    let bonus = 0;
    if(completesContinentFor(pid, toId)) bonus += 2.5*profile.continentBonusMult;
    const defenderId = game.owner[toId];
    const defP = defenderId!=null ? game.players[defenderId] : null;
    if(defP){
      const defTerrCount = ownedTerritories(defenderId).length;
      if(defTerrCount<=2) bonus += (1.5 + defP.cards.length*0.4)*profile.killBonusMult; // finish them off for the cards
      if(defenderId===leaderId && myPower<leaderPower*1.1) bonus -= 0.6; // wary of picking a fight I can't afford
      // mustOnlyAttackLeader's candidate-loop filter (see step()) already guarantees
      // defenderId===allianceLeaderId here whenever that's active — this just makes the AI
      // more willing to accept worse odds against the leader specifically (lowers
      // effectiveThreshold via bestEval.bonus) rather than walking away from a marginal fight.
      if(mustOnlyAttackLeader && defenderId===allianceLeaderId) bonus += 1.2;
    }
    // Keep this attack aligned with this turn's chosen campaign (see
    // pickAITurnIntent) instead of chasing whatever pair scores highest in
    // isolation this round.
    if(intent.type==='finish_continent' && mapData.territories[toId].continentId===intent.continentId) bonus += 0.8;
    else if(intent.type==='kill_weak' && defenderId===intent.targetPlayerId){
      // Response B ("truy sát tận diệt") accepts worse odds against this specific target
      // than Response A ("ăn miếng ngon") would — see ai-strategy-discussion.md.
      bonus += intent.response==='B' ? 1.6 : 1.0;
    }
    else if(intent.type==='defend') bonus -= (intent.response==='B' ? 0.5 : 0.3); // hold back rather than adventure elsewhere
    else if(intent.type==='push_to_win') bonus += intent.response==='B' ? 1.5 : 0.8;
    else if(intent.type==='revenge' && defenderId===intent.targetPlayerId) bonus += intent.response==='B' ? 1.8 : 1.2;
    else if(intent.type==='break_continent' && defenderId===intent.targetPlayerId
      && mapData.territories[toId].continentId===intent.continentId) bonus += toId===intent.focusTerrId ? 2.0 : 1.5;
    return {ratio, score:ratio+bonus, bonus};
  }

  // Fights repeated silent rounds against the same target while the attack is still
  // profitable (reserve/threshold re-checked every round, since armies shrink round by
  // round), so a huge army-count mismatch resolves in one go instead of needing hundreds
  // of individually-delayed AI turns. Only the final round's dice are shown, and all the
  // rounds get folded into one combat-log line, since the in-between rounds have no delay
  // to actually be seen anyway.
  const BATCH_GUARD = 5000;
  // force: skip the normal odds threshold (still bound by attackScore's reserve/usable
  // safety floor, just not "is this a good idea") — used by the "guarantee a card every
  // turn" rule below to push through a marginal fight it would otherwise walk away from.
  function battleBatch(fromId, toId, fromName, toName, defenderName, force){
    let rounds=0, attLossTotal=0, defLossTotal=0, captured=false, lastRes=null;
    while(rounds<BATCH_GUARD){
      if(game.armies[fromId]<2) break;
      const ev = attackScore(fromId, toId);
      if(!ev) break;
      if(!force){
        const threshold = Math.max(1.05, profile.baseThreshold - ev.bonus*0.3);
        if(ev.ratio<threshold) break;
      }
      lastRes = doBattle(fromId, toId, {silent:true});
      rounds++;
      attLossTotal += lastRes.attLoss;
      defLossTotal += lastRes.defLoss;
      // Recorded every round (not just once after the loop) so that if THIS round's capture
      // ends the game (checkElimination -> checkWinCondition -> showGameOver runs synchronously
      // inside doBattle, before control even returns here), the summary screen already reflects
      // this battle's running total instead of a stale earlier record.
      recordBattleStat(p.name, defenderName, fromName, toName, attLossTotal+defLossTotal);
      if(lastRes.captured){ captured=true; break; }
    }
    return {rounds, attLossTotal, defLossTotal, captured, lastRes};
  }

  // Disabled: this used to force a below-threshold attack once per turn so every AI was
  // guaranteed at least 1 card-earning action (a capture under 'on_capture'/default, a kill under
  // 'on_kill'). Turned off per request — now AI purely attacks on odds (plus the area-superiority
  // bonus in attackScore() above), never gambles into a bad fight just to chase a card. A
  // genuinely gridlocked board (no attacker anywhere clears the odds bar) can now go whole turns,
  // or in the extreme a whole game, without anyone drawing a card.
  function stillNeedsCardThisTurn(){
    return false;
  }

  let guard=0;
  // kill_weak Response A ("ăn miếng ngon") stops chasing the target after 1 capture against
  // them this turn, instead of pursuing to elimination like Response B. expand Response A
  // ("thăm dò") caps the WHOLE turn at a couple of attacks even with targets still left.
  let attacksCompleted = 0, killWeakBiteDone = false;
  // Đối sách A của kill_weak / revenge / break_continent: "đớp 1 miếng" — chiếm được 1 ô đúng
  // mục tiêu là thôi tấn công lượt này.
  const biteOnly = intent.response==='A' && ['kill_weak','revenge','break_continent'].includes(intent.type);
  function isBite(toId, defenderId){
    if(defenderId!==intent.targetPlayerId) return false;
    return intent.type!=='break_continent' || mapData.territories[toId].continentId===intent.continentId;
  }
  const EXPAND_RESPONSE_A_CAP = 2;
  function step(){
    if(game.over) return;
    guard++;
    if(guard>60){ game.selectedFrom=null; game.selectedTo=null; aiFortifyStep(pid, intent); return; }
    if(biteOnly && killWeakBiteDone){
      game.selectedFrom=null; game.selectedTo=null; aiFortifyStep(pid, intent); return;
    }
    if(intent.type==='expand' && intent.response==='A' && attacksCompleted>=EXPAND_RESPONSE_A_CAP){
      game.selectedFrom=null; game.selectedTo=null; aiFortifyStep(pid, intent); return;
    }
    const mine = ownedTerritories(pid);
    let bestOpt=null, bestEval=null;
    for(const from of mine){
      if(game.armies[from]<2) continue;
      const t = mapData.territories[from];
      for(const to of t.neighbors){
        if(game.owner[to]===pid) continue;
        if(mustOnlyAttackLeader && game.owner[to]!==allianceLeaderId) continue;
        const ev = attackScore(from, to);
        if(!ev) continue;
        if(!bestEval || ev.score>bestEval.score){ bestEval=ev; bestOpt={from,to}; }
      }
    }
    // bonuses (continent completion / finishing off a weak player) justify taking slightly
    // worse pure odds than the difficulty's base threshold would normally allow.
    const effectiveThreshold = bestEval ? Math.max(1.05, profile.baseThreshold - bestEval.bonus*0.3) : Infinity;
    const meetsThreshold = !!bestOpt && bestEval.ratio>=effectiveThreshold;
    const forcedForCard = !meetsThreshold && !!bestOpt && stillNeedsCardThisTurn();
    if(!bestOpt || (!meetsThreshold && !forcedForCard)){
      game.selectedFrom=null; game.selectedTo=null;
      // No attack happened yet this turn (the common "nothing worth attacking" case) — give
      // the "đang tấn công" hint set at the top of aiAttackStep at least 1 beat before it's
      // replaced by fortify's, instead of swapping it out instantly. Once at least 1 attack
      // has actually run, its own delays already gave that hint plenty of screen time.
      if(attacksCompleted===0) aiSchedule(()=> aiFortifyStep(pid, intent), aiDelay(260));
      else aiFortifyStep(pid, intent);
      return;
    }

    const { from, to } = bestOpt;
    // Same selectedFrom/selectedTo the human attack UI uses — this is what makes the pulsing
    // badges and the animated arrow (drawGameCanvas, see attackAnim in 06-render-game.js) show
    // up for an AI's move too, not just a human's. Shown for one aiDelay() beat (the AI's
    // existing "thinking" pause, previously just empty wait time) before actually fighting.
    game.selectedFrom = from; game.selectedTo = to;
    host.renderGame();
    if(game.over) return;
    aiSchedule(()=> executeAttack(from, to, forcedForCard), aiDelay(260));
  }
  function executeAttack(from, to, forcedForCard){
    if(game.over) return;
    const fromName = mapData.territories[from].name, toName = mapData.territories[to].name;
    const defenderId = game.owner[to];
    const defenderName = game.players[defenderId].name;
    const attackerColor = p.color, defenderColor = game.players[defenderId].color;
    if(forcedForCard) logMsg('info', p.name+' liều đánh '+toName+' để kiếm bài.', [pid, defenderId]);
    const fromCountBefore = game.armies[from], toCountBefore = game.armies[to];
    const result = battleBatch(from, to, fromName, toName, defenderName, forcedForCard);
    const fromCountAfter = game.armies[from], toCountAfter = game.armies[to];
    function nextDecision(){
      game.selectedFrom=null; game.selectedTo=null;
      if(game.over) return;
      // Deliberately NOT aiDelay() here: in spectator mode that ignores its argument and always
      // waits the full configured spectator delay — stacking a second one of those on top of the
      // one already spent before the strike (see step()) plus the ~1.1s attackAnim itself would
      // make every attack take several seconds. The animation just played already gave viewers
      // something to watch; this is just a small breather before the next decision, not a second
      // full "thinking pause".
      aiSchedule(step, 80);
    }
    if(result.rounds<=0){ host.renderGame(); nextDecision(); return; }
    attacksCompleted++;
    if(result.captured && isBite(to, defenderId)) killWeakBiteDone = true;
    const roundsLabel = result.rounds>1 ? ` (${result.rounds} hiệp)` : '';
    logMsg('attack', `${p.name} tấn công ${toName} từ ${fromName}${roundsLabel}: mất ${result.attLossTotal}, đối phương mất ${result.defLossTotal}.`, [pid, defenderId]);
    if(result.lastRes) host.showDice(result.lastRes.ad, result.lastRes.dd, result.lastRes.results);
    if(result.captured) logMsg('capture', `${p.name} chiếm được ${toName}!`, [pid, defenderId]);
    // startAttackAnim's onDone fires once the fly/impact/return sequence finishes (see
    // 06-render-game.js) — the next attack decision waits for that instead of firing right
    // after the battle resolves, same as the human attack flow.
    host.startAttackAnim({
      fromId:from, toId:to, attLoss:result.attLossTotal, defLoss:result.defLossTotal, captured:result.captured,
      fromCountBefore, toCountBefore, fromCountAfter, toCountAfter, attackerColor, defenderColor,
    }, nextDecision);
    host.renderGame();
  }
  step();
}

function aiFortifyStep(pid, intent){
  intent = intent || pickAITurnIntent(pid); // e.g. resuming a save mid-phase, see importGameJSON
  game.phase='fortify';
  aiSetStepHint(pid, intent, 'tăng cường quân');
  host.renderGame();
  const p = game.players[pid];
  // Same gang-up detection as aiAttackStep/pickAIReinforceTarget — a forced leader-only turn is
  // also this turn's fortify front, not just this turn's attack target, so troops actually pile
  // up where the AI is allowed to strike instead of wherever pickAITurnIntent's unrelated
  // continent/kill_weak/defend logic happened to land independently of the alliance rule.
  const allianceLeaderId = game.allianceEnabled ? updateCommonEnemy() : null;
  const mustOnlyAttackLeader = allianceLeaderId!=null && pid!==allianceLeaderId;
  // move armies from every safe interior territory to the front
  const mine = ownedTerritories(pid);
  const interior = mine.filter(id=>{
    const t = mapData.territories[id];
    return [...t.neighbors].every(n=>game.owner[n]===pid) && game.armies[id]>1;
  });
  const borders = mine.filter(id=>{
    const t = mapData.territories[id];
    return [...t.neighbors].some(n=>game.owner[n]!==pid);
  });
  // A border isn't just "a border" — prefer whichever one IS this turn's
  // chosen campaign (see pickAITurnIntent) before falling back to whichever
  // border a path happens to reach first, so the army sent forward actually
  // lands on next turn's front instead of a border unrelated to the plan.
  function isIntentFront(id){
    const t = mapData.territories[id];
    if(mustOnlyAttackLeader) return [...t.neighbors].some(n=>game.owner[n]===allianceLeaderId);
    if(intent.type==='stay_survival') return id===intent.focusTerrId; // "co cụm" — đúng biên bị đe doạ
    if(intent.type==='finish_continent' || intent.type==='attempt_continent') return t.continentId===intent.continentId;
    if(intent.type==='kill_weak' || intent.type==='revenge') return [...t.neighbors].some(n=>game.owner[n]===intent.targetPlayerId);
    if(intent.type==='break_continent') return [...t.neighbors].some(n=>game.owner[n]===intent.targetPlayerId && mapData.territories[n].continentId===intent.continentId);
    if(intent.type==='push_to_win') return false; // không có mặt trận riêng
    return id===intent.focusTerrId; // defend / expand
  }
  const orderedBorders = [...borders].sort((a,b)=> (isIntentFront(b)?1:0) - (isIntentFront(a)?1:0));
  // finish_continent Response A ("có tính toán") chỉ kéo đủ mức tối thiểu để biên yếu nhất
  // an toàn, thay vì Response B ("dốc lực") rút sạch mọi hậu phương như hành vi mặc định
  // bên dưới — phần còn lại ở nguyên hậu phương, phục vụ intent khác lượt sau.
  const minimalPull = intent.type==='finish_continent' && intent.response==='A';
  const neededAt = {};
  if(minimalPull){
    orderedBorders.forEach(id=>{
      const t = mapData.territories[id];
      const enemyNb = [...t.neighbors].filter(n=>game.owner[n]!==pid);
      const maxEnemy = enemyNb.length ? Math.max(...enemyNb.map(n=>game.armies[n])) : 0;
      neededAt[id] = Math.max(0, maxEnemy - (game.armies[id]||0));
    });
  }
  // A human player can make as many fortify moves as they like before ending their turn, so drain
  // EVERY interior territory with spare troops in this one pass instead of just the single
  // largest one — otherwise every other interior garrison stays stranded forever wherever it
  // happened to end up (typically the bare-minimum 1 army left right after a capture), since
  // nothing else in the game ever revisits it. Moves are tallied per destination so multiple
  // interior sources funneling into the same front log as one summary line each, not a spammy
  // line per source.
  const movedTo = {};
  // attempt_continent bước 4: dồn quân từ MỌI ô ngoài lục địa có đường tới lục địa (cả ô đang giáp
  // địch, chừa 1 quân) vào lục địa — trừ ô của lục địa khác đã chiếm trọn mà đang giáp player khác
  // (isProtectedHolding). Đích: ô tập kết của bước 2 trước, rồi các ô trong lục địa giáp địch.
  if(intent.type==='attempt_continent' && !mustOnlyAttackLeader){
    const contId = intent.continentId;
    const mineIn = mine.filter(id=>mapData.territories[id].continentId===contId);
    const facing = mineIn.filter(id=>[...mapData.territories[id].neighbors].some(n=>game.owner[n]!==pid));
    const staging = attemptContinentStaging(pid, contId).stagingId;
    const dests = (facing.length ? facing : mineIn).slice()
      .sort((a,b)=> (b===staging?1:0)-(a===staging?1:0));
    mine.forEach(src=>{
      if(mapData.territories[src].continentId===contId || game.armies[src]<2 || isProtectedHolding(pid, src)) return;
      const dst = dests.find(d=> pathExistsOwned(src, d, pid));
      if(dst==null) return;
      const moving = game.armies[src]-1;
      game.armies[src] -= moving; game.armies[dst] += moving;
      movedTo[dst] = (movedTo[dst]||0)+moving;
    });
  }
  if(orderedBorders.length){
    interior.forEach(src=>{
      let bestDst=null;
      for(const dst of orderedBorders){
        if(minimalPull && (neededAt[dst]||0)<=0) continue; // biên này đã đủ, bỏ qua
        if(pathExistsOwned(src,dst,pid)){ bestDst=dst; break; }
      }
      if(bestDst){
        let moving = game.armies[src]-1;
        if(minimalPull) moving = Math.min(moving, neededAt[bestDst]||0);
        if(moving>0){
          game.armies[src]-=moving; game.armies[bestDst]+=moving;
          movedTo[bestDst] = (movedTo[bestDst]||0)+moving;
          if(minimalPull) neededAt[bestDst] -= moving;
        }
      }
    });
  }
  Object.keys(movedTo).forEach(dstId=>{
    logMsg('info', p.name+' tăng cường '+movedTo[dstId]+' quân đến '+mapData.territories[dstId].name+'.', pid);
  });
  host.renderGame();
  aiSchedule(()=> endTurn(), aiDelay(400));
}

