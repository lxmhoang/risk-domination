# Cơ chế AI (bot)

Toàn bộ logic AI nằm trong 1 file: [`src/js/05-ai.js`](src/js/05-ai.js). Không có
lookahead/minimax/ML — AI chỉ chấm điểm (scoring heuristic) các lựa chọn ở mỗi bước rồi
chọn cái điểm cao nhất. Mọi yếu tố ngẫu nhiên đi qua `random()` có seed, nên cùng seed
thì AI chơi y hệt.

Các con số trong tài liệu này là **giá trị mặc định** trong
[`src/config.json`](src/config.json); chúng chỉnh được ở màn Cấu hình, nên một ván cụ thể
có thể chạy với số khác.

## 1. Cấu trúc 1 lượt AI

```
aiRunFullTurn(pid)
  → pickAITurnIntent(pid)  (chọn 1 ý định cho cả lượt, mục 4 — chạy đúng 1 lần)
  → aiReinforceStep         (đổi bài, rồi đặt quân tăng viện)
  → aiAttackStep            (tấn công, lặp tới khi hết mục tiêu đủ ngưỡng)
  → aiFortifyStep           (dồn quân từ hậu phương ra biên)
  → endTurn()               (phát thẻ bài nếu đủ điều kiện, chuyển lượt)
```

`intent` được truyền qua tham số cho cả 3 bước reinforce/attack/fortify. Khi resume 1 ván
lưu giữa chừng lượt AI thì không có `intent` cũ, mỗi bước tự tính lại
(`intent || pickAITurnIntent(pid)`); hàm này không có tác dụng phụ nên tính lại được.

Các bước nối nhau bằng `aiSchedule()` ([02-map-model.js:18](src/js/02-map-model.js#L18))
chứ không gọi `setTimeout` trực tiếp, để nút tạm dừng dừng được chuỗi này và để server
chạy không cần chờ thật. Độ trễ lấy từ `aiDelay(base)`
([02-map-model.js:7](src/js/02-map-model.js#L7)):

- Chơi bình thường: delay = `base` (300 / 350 / 260 / 400ms tuỳ bước).
- Chế độ xem AI đấu AI: delay = `spectatorModeDelayMs` (300ms), bỏ qua `base`.
- Giữa 2 trận đánh liên tiếp: cố định 80ms, không qua `aiDelay`, vì hoạt ảnh tấn công đã
  đủ cho người xem.
- Lượt AI chỉ bắt đầu sau khi banner "lượt của X" tắt (`TURN_INTRO_TOTAL_MS`).

### Đặt quân ban đầu

Mặc định (`manualInitialPlacement: false`) quân ban đầu của **mọi** người chơi được rải
ngẫu nhiên lên đất của họ (`autoPlaceInitialArmies`,
[04-game-state.js:169](src/js/04-game-state.js#L169)) — AI không quyết định gì ở đây.

Khi bật đặt quân thủ công, AI đặt từng quân một bằng `pickAIReinforceTarget` không có
`intent` ([04-game-state.js:107](src/js/04-game-state.js#L107)), cố định 120ms/quân kể cả
ở chế độ xem.

## 2. Độ khó (difficulty)

`difficultyProfile(diff, personality)` ([05-ai.js:104](src/js/05-ai.js#L104)):

| Độ khó | `baseThreshold` (tỉ lệ quân tối thiểu để dám tấn công) | `reserveFactor` (giữ lại bao nhiêu quân phòng thủ) |
|---|---|---|
| Easy   | 2.0  | 1.0 |
| Normal | 1.5  | 0.6 |
| Hard   | 1.15 | 0.3 |

- `baseThreshold` càng cao → AI càng cần áp đảo quân số mới đánh.
- `reserveFactor` càng cao → AI càng giữ nhiều quân lại thay vì đem đi đánh.

## 3. Tính cách (personality)

Mỗi AI có 1 trong 4 tính cách, chọn ở màn setup. Tính cách chỉnh 4 con số trên nền độ khó
(`personalityTraits`, [05-ai.js:64](src/js/05-ai.js#L64)):

| Tính cách | Cộng vào ngưỡng | Nhân quân dự phòng | Nhân bonus kết liễu | Nhân bonus châu lục |
|---|---|---|---|---|
| Cân bằng (`balanced`)       | 0     | ×1.0 | ×1.0 | ×1.0 |
| Rùa (`turtle`)              | +0.4  | ×1.6 | ×0.7 | ×1.2 |
| Xông pha (`rusher`)         | −0.35 | ×0.4 | ×1.0 | ×0.8 |
| Cơ hội (`opportunist`)      | −0.1  | ×0.9 | ×1.8 | ×0.9 |

Ngưỡng sau khi cộng không bao giờ thấp hơn 1.05. Tính cách **không** ảnh hưởng tới việc
chọn ý định lượt (mục 4), đặt quân, đổi bài hay fortify — chỉ tới bước tấn công.

## 4. Ý định của lượt — `pickAITurnIntent`

([05-ai.js:231](src/js/05-ai.js#L231), thiết kế đầy đủ ở
[`ai-strategy-discussion.md`](ai-strategy-discussion.md)) Chạy 1 lần đầu lượt, chọn **1
chiến dịch duy nhất**. Mỗi intent (trừ `expand`, luôn có sẵn làm phương án cuối) có 2
thang riêng:

- **Thang trigger** (1-4 hoặc 1-3 tuỳ intent) — intent này CÓ được chọn lượt này không,
  và với điều kiện nào. Level 1 luôn là "bỏ qua hẳn".
- **Thang đối sách** (`'A'`/`'B'` hoặc `1`/`2`) — chọn cách thực thi nặng/nhẹ, **độc lập
  hoàn toàn** với level trigger nào vừa khớp (không suy ra từ việc trigger nghiêm trọng
  tới đâu).

Cả 2 chọn bằng `weightedLeanPick`: 1 lần roll "mood" ngẫu nhiên đầu lượt
(`rollTurnMood()`, 2 số độc lập trong `[0,1)` — 1 cho trục trigger, 1 cho trục đối sách,
dùng chung cho MỌI intent lượt đó), nghiêng trọng số gấp 3 về mức mà `personality` của AI
đó "hay chạm" (bảng `TRIGGER_LEAN`/`RESPONSE_LEAN`) — không phải mức duy nhất có thể ra.
Vài ô trong 2 bảng này không được tài liệu thảo luận chốt rõ cho personality đó, đánh dấu
`/* * */` trong code — mặc định về giá trị của `balanced`.

Intent được xét theo thứ tự cố định, khớp cái đầu tiên thì dừng:

1. **`stay_survival`** — ưu tiên số 1, xem riêng dưới đây.
2. **`finish_continent`** — thiếu đúng 1 lãnh thổ để chiếm trọn 1 châu lục, lãnh thổ đó
   giáp đất mình, VÀ "Tỷ lệ quân số" (xem định nghĩa dưới) tại đó ≥ ngưỡng `aiEasyThreshold`.
   Level 4 còn đòi thêm: sau khi chiếm vẫn giữ được TRỌN đường biên mới của châu lục
   (`canHoldContinentBorders`, kiểm tra thô — so quân hiện có với địch mạnh nhất giáp mỗi
   biên, không mô phỏng fortify thật).
3. **`kill_weak`** — có đối thủ còn ≤2 lãnh thổ (≤3 ở Level 4) và giáp đất mình. Level 4
   còn đòi tổng quân của họ đủ ít so với sức mạnh của tôi (`myPower×0.5` — ước lượng thô,
   không mô phỏng chiến đấu thật).
4. **`defend`** — biên bị áp đảo nặng nhất của mình thua láng giềng địch mạnh nhất ≥1
   (Level 3) hoặc ≥2 (Level 2) quân, **và** mình yếu hơn đối thủ mạnh nhất.
5. **`expand`** — luôn trả về, không gate. Level 3 ("Cơ hội nhất") đổi tiêu điểm từ "biên
   yếu nhất của mình" sang "cặp (biên của tôi, láng giềng địch) có tỉ lệ quân/quân tốt
   nhất" — ước lượng thô, `aiAttackStep` vẫn tính lại đầy đủ (reserve, vùng, …) trước khi
   thực đánh. Level 1 ("Rụt rè") không chủ động tấn công — `aiAttackStep` bỏ qua thẳng
   sang fortify.

Ý định được tính lại từ đầu mỗi lượt (kể cả roll mood); AI không nhớ lượt trước mình định
làm gì.

### "Tỷ lệ quân số" — `captureRatio(pid, terrId)`

Dùng chung cho `finish_continent` (và tương tự, công thức riêng, cho `stay_survival`):

```
A = tổng quân của mình ở các láng giềng của Tỉnh đó (KHÔNG trừ quân dự phòng — khác
    reserveFor() ở bước attack; đã quyết đánh thì không giữ phần nào lại)
B = quân địch tại Tỉnh đó
ratio = A / B
```

3 mức ngưỡng tái dùng đúng `aiEasyThreshold`/`aiNormalThreshold`/`aiHardThreshold` (mục
2) — không thêm field admin mới.

### `stay_survival` — ưu tiên số 1

([05-ai.js:150](src/js/05-ai.js#L150)) "Sắp chết thì không màng chiếm châu lục". Khác mọi
intent khác: ngưỡng bị **đảo chiều** — ngưỡng THẤP mới là trigger dễ/sớm hơn.

Với mỗi láng giềng địch của mọi lãnh thổ biên: `A` = quân địch tại đó (+ quân tăng viện
dự phóng lượt tới của họ, chỉ ở Level 4), `B` = **tổng quân toàn bản đồ** của tôi (khác
`captureRatio` dùng B = quân tại 1 Tỉnh). Lấy biên có `A/B` cao nhất:

| Level | Ngưỡng | A gồm dự phóng? |
|---|---|---|
| 4 — Nhạy bén | ≥1.15 (`aiHardThreshold`) | Có |
| 3 — Bình thường | ≥1.5 (`aiNormalThreshold`) | Không |
| 2 — Dè dặt | ≥2.0 (`aiEasyThreshold`) | Không |
| 1 — Vô tư | bỏ qua hẳn | — |

3 mức lồng nhau (Level 2 đúng ⟹ 3, 4 cũng đúng) nên chỉ cần tính đúng 1 lần theo công
thức của level đã roll được.

Đối sách roll độc lập (`1`/`2`, không liên quan tới level trigger nào vừa khớp):
- **2 — Cực đoan (co cụm)**: `aiAttackStep` bỏ qua tấn công, đi thẳng sang fortify;
  `pickAIReinforceTarget` dồn **toàn bộ** quân tăng viện vào đúng biên bị đe doạ
  (`focusTerrIdOverride`, thắng tuyệt đối mọi điểm số khác).
- **1 — Đánh rỉa** (`staySurvivalNibble`): vẫn cố 1 hành động kiếm bài rồi dừng hẳn lượt
  đó, chọn theo `cardAwardEvent` đang bật — `on_capture`: chọn đúng 1 ô địch ít quân nhất
  đánh được, cố chiếm; `on_kill`: đánh đúng 1 hiệp có lợi (ratio≥1.05) rồi dừng; `on_turn_end`:
  không cần đánh gì (coi như Response 2).

Phần "quân bên thứ 3 phải bị vượt qua" (mối đe doạ 2 bước, không giáp biên trực tiếp)
**chưa cài** — tài liệu thảo luận xác nhận hướng nhưng chưa có công thức cụ thể.

### Sức mạnh người chơi — `evaluatePlayerPower`

([05-ai.js:196](src/js/05-ai.js#L196))

```
power = tổng quân × 2 + số lãnh thổ × 1 + quân tăng viện mỗi lượt × 6
```

Quân tăng viện được nhân nặng vì nó cho biết ai đang lớn nhanh, không chỉ ai đang đông.

## 5. Đặt quân tăng viện — `pickAIReinforceTarget`

([05-ai.js:391](src/js/05-ai.js#L391)) Chỉ xét lãnh thổ có giáp địch. Chấm điểm:

```
score = (quân địch mạnh nhất giáp biên) − (quân mình ở đó)
score += 1.5   nếu ô này thuộc châu lục mình đã chiếm trọn
score += 0.8   nếu châu lục đó chỉ còn thiếu 1 ô
score += 1.2   nếu ô thuộc châu lục của ý định finish_continent
score += 1.2   nếu ô giáp đối thủ của ý định kill_weak
score += 1.0   nếu ô chính là focusTerrId của ý định defend / expand
```

Đặt 1 quân vào ô điểm cao nhất, tính lại, lặp tới khi hết quân. Vì điểm gốc giảm 1 mỗi
khi thêm 1 quân, quân có xu hướng được **rải cho các biên ngang nhau** chứ không dồn vào
một chỗ.

Ngoại lệ — khi lượt có 1 "mục tiêu duy nhất" thì biên giáp mục tiêu đó thắng tuyệt đối,
bất kể điểm, nên toàn bộ quân dồn vào đó:

- Ý định là `stay_survival` → mục tiêu là `focusTerrId` (biên bị đe doạ nhất) — thắng
  tuyệt đối trước cả các override khác dưới đây, bất kể đối sách nào được chọn.
- Ý định là `kill_weak` → mục tiêu là đối thủ đang bị nhắm.
- Liên minh đang kích hoạt (mục 7c) → mục tiêu là người dẫn đầu; lúc này quân địch
  không phải của người dẫn đầu cũng không được tính là mối đe doạ.

## 6. Đổi bài — `aiTryTradeCards`

([05-ai.js:281](src/js/05-ai.js#L281)) Chạy đầu bước reinforce.

- Có ≥5 lá: bắt buộc đổi.
- Có bộ 3 hợp lệ (3 lá giống nhau hoặc 3 lá khác nhau) mà chưa bị bắt buộc: AI giữ lại
  với xác suất tuỳ luật đổi bài của ván:
  - `progressive`: giữ 70% — lần đổi sau luôn được nhiều quân hơn nên chờ có lợi.
  - `fixed` và `exponential`: giữ 10% — chờ không được thêm gì.

Giá trị quân nhận được tính bằng `tradeInValue`
([04-game-state.js:33](src/js/04-game-state.js#L33)), dùng chung với người chơi.

## 7. Tấn công — `aiAttackStep`

([05-ai.js:568](src/js/05-ai.js#L568)) Trước hết, 3 trường hợp đi thẳng sang fortify
hoặc chạy đường riêng, không qua vòng lặp chấm điểm bên dưới:

- `stay_survival`, đối sách Cực đoan (2), hoặc Đánh rỉa (1) dưới `cardAwardEvent==='on_turn_end'`
  → bỏ qua tấn công hoàn toàn, sang fortify ngay.
- `stay_survival`, đối sách Đánh rỉa (1) ở 2 chế độ còn lại → `staySurvivalNibble()`, xem
  mục 4.
- `expand`, Level 1 ("Rụt rè") → bỏ qua tấn công, sang fortify ngay.

Các trường hợp còn lại chạy vòng lặp chấm điểm như sau:

### a) Quân dự phòng — `reserveFor(fromId, excludeTo)`

```
reserve = ceil(quân của láng giềng địch mạnh nhất, không tính ô đang định đánh × reserveFactor)
usable  = quân hiện có − 1 − reserve
```

`usable < 1` thì ô đó không được dùng để tấn công.

### b) Tỉ lệ lực lượng

```
tỉ lệ đơn  = (usable + 1) / quân địch ở ô đích
```

Nếu mình còn ô khác cũng giáp ô đích, cộng `usable` của các ô đó lại thành "tỉ lệ vùng",
rồi lấy **trung bình** của tỉ lệ đơn và tỉ lệ vùng. Nhờ vậy một ô bị kẹp giữa 2 đạo quân
của mình được coi là đánh được dù từng đạo riêng lẻ chưa đủ ngưỡng.

Đây là tỉ lệ quân số, không phải xác suất thắng tính theo xúc xắc.

### c) Điểm cộng/trừ (`bonus`)

| Điều kiện | Điểm |
|---|---|
| Chiếm ô này là trọn 1 châu lục | +2.5 × hệ số châu lục của tính cách |
| Chủ ô đích còn ≤2 lãnh thổ | +(1.5 + số bài của họ × 0.4) × hệ số kết liễu |
| Chủ ô đích là đối thủ mạnh nhất, và mình chưa mạnh hơn họ 10% | −0.6 |
| Liên minh đang kích hoạt, ô đích của người dẫn đầu | +1.2 |
| Ý định `finish_continent`, ô đích thuộc châu lục đó | +0.8 |
| Ý định `kill_weak`, ô đích của đối thủ đang bị nhắm, đối sách B (truy sát tận diệt) | +1.6 |
| Ý định `kill_weak`, ô đích của đối thủ đang bị nhắm, đối sách A (ăn miếng ngon) | +1.0 |
| Ý định `defend` (áp cho mọi đòn tấn công), đối sách B (gia cố mạnh) | −0.5 |
| Ý định `defend` (áp cho mọi đòn tấn công), đối sách A (gia cố nhẹ) | −0.3 |

Ngoài bonus điểm số, 2 đối sách còn giới hạn **số trận đánh được phép** trong lượt
(`aiAttackStep`'s `step()`):

- `kill_weak`, đối sách A (ăn miếng ngon) — dừng hẳn ngay sau lần đầu chiếm được 1 ô của
  đối thủ đang nhắm (không cố loại hẳn như đối sách B).
- `expand`, đối sách A (thăm dò) — giới hạn tối đa 2 trận cả lượt dù vẫn còn mục tiêu
  ngon; đối sách B (đánh sâu, hành vi mặc định cũ) không giới hạn.

**Liên minh chống người dẫn đầu** (tuỳ chọn `game.allianceEnabled`).
`findAllianceLeader()` ([05-ai.js:92](src/js/05-ai.js#L92)) xét mọi người còn sống, kể cả
chính AI đang đi, và chỉ công nhận người mạnh nhất là "leader" khi đạt cả 2 ngưỡng:

```
power top-1 ≥ tổng power của tất cả người còn lại × 0.6
power top-1 ≥ power người thứ nhì               × 1.2
```

Người đạt ngưỡng không chỉ là "leader" mà còn bị gán nhãn **kẻ thù chung**
(`game.commonEnemy = {id, startPower}`, cập nhật bởi `updateCommonEnemy()`). Liên minh bám theo
nhãn chứ không theo trạng thái leader: kẻ thù chung vẫn bị đánh dù đã tụt dưới ngưỡng leader, và
trong lúc đó một leader khác không bị hội đồng. Nhãn chỉ gỡ khi người đó bị loại hoặc sức mạnh
< `allianceReleaseFraction` (mặc định 1/3, chỉnh ở trang admin) × sức mạnh lúc bị gán nhãn; sau đó
mới tìm leader hiện tại để gán nhãn mới. Trên thẻ người chơi, kẻ thù chung có dấu 🎯.

Khi có kẻ thù chung, mọi AI khác bị **khoá cứng**: lượt đó chỉ được tấn công đất của leader.
Nếu không có ô nào giáp leader thì không tấn công gì. Quân dự phòng cũng chỉ tính trước
đất của leader. Leader thì chơi bình thường.

### d) Chọn mục tiêu và ngưỡng

Mỗi vòng, AI duyệt mọi cặp (ô mình có ≥2 quân) × (láng giềng địch), chọn cặp có
`score = tỉ lệ + bonus` cao nhất. Chỉ đánh nếu:

```
tỉ lệ ≥ max(1.05, baseThreshold − bonus × 0.3)
```

Không đạt thì AI dừng tấn công, chuyển sang fortify. Tối đa 60 vòng mỗi lượt.

AI không còn "liều đánh để kiếm bài": đoạn ép 1 đòn dưới ngưỡng mỗi lượt đã bị tắt
(`stillNeedsCardThisTurn()` luôn trả `false`). Bàn cờ bế tắc thì AI có thể đi nhiều lượt
không đánh.

### e) Đánh một trận — `battleBatch`

Với cặp đã chọn, AI đánh liên tiếp nhiều hiệp vào cùng ô đích, kiểm tra lại quân dự
phòng và ngưỡng trước **mỗi hiệp**, dừng khi chiếm được hoặc hết lợi thế. Chỉ xúc xắc của
hiệp cuối được hiển thị, log gộp thành 1 dòng.

Luật xúc xắc (`doBattle`, [04-game-state.js:283](src/js/04-game-state.js#L283)) dùng
chung với người chơi: tấn công tối đa 3 xúc xắc, phòng thủ tối đa 2, hoà thì phòng thủ
thắng.

Khi chiếm được ô, AI chỉ chuyển sang **mức tối thiểu** (bằng số xúc xắc vừa dùng, 1–3
quân). Phần còn lại ở nguyên ô xuất phát. Người chơi thì được chọn chuyển thêm.

## 8. Fortify — `aiFortifyStep`

([05-ai.js:798](src/js/05-ai.js#L798))

- Nguồn: **mọi** ô hậu phương (toàn bộ láng giềng là đất mình) có >1 quân.
- Đích: các ô biên, xếp ô thuộc mặt trận của ý định lên trước, rồi lấy ô **đầu tiên** có
  đường nối qua đất mình (`pathExistsOwned`).
- Mặt trận của ý định: biên bị đe doạ (`stay_survival`), châu lục đang theo đuổi
  (`finish_continent`), ô giáp đối thủ đang bị nhắm (`kill_weak`), hoặc `focusTerrId`
  (`defend` / `expand`). Khi liên minh kích hoạt thì là mọi ô giáp leader, thay cho ý
  định.
- Lượng chuyển mỗi nguồn → đích phụ thuộc đối sách của `finish_continent`:
  - Đối sách B (dốc lực giữ đất, mặc định mọi intent khác) — chuyển **hết**, chừa lại 1.
  - Đối sách A (có tính toán) — chỉ chuyển đủ bù chênh lệch quân của biên đích (quân địch
    mạnh nhất giáp biên đó trừ quân hiện có), dừng nhận quân vào 1 biên ngay khi đủ; phần
    dư ở lại hậu phương, không bị kéo đi hết.

AI không chuyển quân giữa 2 ô biên với nhau, và (trừ đối sách A của `finish_continent`
trên) không chia quân theo mức độ bị đe doạ của từng biên.

## 9. Kết thúc lượt và thẻ bài

`endTurn()` ([04-game-state.js:385](src/js/04-game-state.js#L385)) phát 1 thẻ theo
`cardAwardEvent`, áp dụng như nhau cho người và AI:

- `on_capture` (mặc định) — chiếm được ≥1 ô trong lượt.
- `on_kill` — hạ được ≥1 quân địch trong lượt.
- `on_turn_end` — luôn được phát.

AI không điều chỉnh hành vi theo chế độ này. Loại được một người chơi thì lấy toàn bộ
bài của họ (`checkElimination`, [04-game-state.js:341](src/js/04-game-state.js#L341)) —
đó là lý do của bonus kết liễu ở mục 7c.

## 10. Giới hạn đã biết

- Không nhìn trước nước đi, không mô phỏng phản ứng của đối thủ.
- Không có trí nhớ giữa các lượt: ý định, mục tiêu, ai vừa đánh mình đều không được lưu —
  kể cả `mood` (mục 4) cũng roll lại từ đầu mỗi lượt, không có quán tính qua các lượt.
- Quân tăng viện vẫn bị rải đều các biên ngoài các override "mục tiêu duy nhất" (mục 5),
  và đạo quân chính không tiến theo sau khi chiếm ô (mục 7e), nên AI hiếm khi đánh xuyên
  nhiều ô trong 1 lượt trừ khi `kill_weak` đối sách B chủ động theo đuổi.
- Công thức "bên thứ 3 phải bị vượt qua" của `stay_survival` (mục 4) chưa cài — chỉ xét
  mối đe doạ giáp biên trực tiếp.
- Vài ô trong bảng `TRIGGER_LEAN`/`RESPONSE_LEAN` (mục 4) không được tài liệu thảo luận
  chốt rõ cho personality đó — đang mặc định về `balanced`, đánh dấu `/* * */` trong code.
- **Mood dùng chung 1 roll cho MỌI intent trong lượt (đúng như đã chốt với user) có thể
  khiến nhiều intent cùng "rơi vào mức bỏ qua" trong cùng 1 lượt** — so với bản trước khi
  có hệ thống level, `test/ai-smoke-test.js` cho thấy số vòng cần để kết thúc 1 ván tăng
  lên đáng kể ở Normal/Hard (ví dụ Normal 4 người: ~83 vòng → ~968 vòng ở 1 lần chạy thử),
  tức AI **thụ động hơn**, không chỉ "khó đoán hơn". Đây là hệ quả của thiết kế mood dùng
  chung đã được xác nhận, không phải lỗi cài sai — nhưng đáng cân nhắc lại nếu độ thụ động
  này vượt quá mức "thú vị, khó đoán" mong muốn (xem mục tiêu AI trong bộ nhớ dự án).

Hướng nâng cấp đang thảo luận: [`ai-strategy-discussion.md`](ai-strategy-discussion.md) —
phần `stay_survival`/thang trigger-đối sách ở đó giờ **đã code xong** (05-ai.js), tài liệu
đó vẫn giữ lại làm lịch sử thảo luận/thiết kế.
