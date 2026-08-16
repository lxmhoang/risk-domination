# Cơ chế AI (bot)

Toàn bộ logic AI nằm trong 1 file: [`src/js/05-ai.js`](src/js/05-ai.js). Không có
lookahead/minimax/ML gì cả — AI chỉ chấm điểm (scoring heuristic) các lựa chọn ở mỗi
bước rồi chọn cái điểm cao nhất. File đó có sẵn 1 comment "design doc" ở đầu, file này
là bản diễn giải tiếng Việt + trỏ tới từng hàm cụ thể.

## 1. Cấu trúc 1 lượt AI

Mỗi lượt AI chạy tuần tự 4 bước, mỗi bước cách nhau 1 khoảng delay rồi tự gọi bước kế
tiếp bằng `setTimeout` (không chặn UI, để người xem thấy diễn biến):

```
aiRunFullTurn(pid)
  → aiReinforceStep   (đặt quân tăng viện + đổi bài)
  → aiAttackStep       (tấn công, lặp lại tới khi hết mục tiêu ngon)
  → aiFortifyStep      (dồn quân từ hậu phương ra biên giới)
  → endTurn()           (phát thẻ bài nếu có chiếm đất, chuyển lượt)
```

Độ trễ giữa các bước dùng hàm `aiDelay(base)` ở [`src/js/02-map-model.js:7`](src/js/02-map-model.js#L7):
- Chơi bình thường (có người): delay = `base` (300/350/260/400ms tuỳ bước) — gần như
  tức thời, chỉ đủ để UI kịp vẽ lại.
- **Chế độ xem AI đấu AI (spectator mode)**: delay = `GAME_CONFIG.spectatorModeDelayMs`
  (đọc từ [`src/config.json`](src/config.json), mặc định 1000ms) — bỏ qua `base`, dùng
  chung 1 giá trị cho mọi bước để dễ xem.
- Riêng giai đoạn đặt quân ban đầu (`setup-place`, đặt từng quân 1 trước khi vào game
  chính) **không** dùng `aiDelay` — luôn cố định 120ms/quân dù có đang ở spectator mode
  hay không, vì đặt quân từng viên một không có gì đáng xem chậm
  ([`src/js/04-game-state.js:81`](src/js/04-game-state.js#L81)).

## 2. Độ khó (difficulty)

`difficultyProfile(diff)` ([05-ai.js:33](src/js/05-ai.js#L33)) trả về 2 con số dùng
xuyên suốt:

| Độ khó | `baseThreshold` (tỉ lệ quân tối thiểu để dám tấn công) | `reserveFactor` (dè chừng bao nhiêu) |
|---|---|---|
| Easy   | 2.0  | 1.0 |
| Normal | 1.5  | 0.6 |
| Hard   | 1.15 | 0.3 |

- `baseThreshold` càng cao → AI càng cần áp đảo quân số mới dám đánh (Easy hiền, Hard liều).
- `reserveFactor` càng cao → AI càng để dành nhiều quân phòng thủ thay vì dồn hết đi đánh.

## 3. Đặt quân tăng viện — `pickAIReinforceTarget`

([05-ai.js:57](src/js/05-ai.js#L57)) Với mỗi lãnh thổ của mình có giáp biên địch, chấm điểm:

```
score = (quân địch mạnh nhất giáp biên) − (quân mình đang có ở đó)
score += 1.5   nếu lãnh thổ này thuộc 1 châu lục mình đã chiếm TRỌN (ưu tiên giữ)
score += 0.8   nếu chỉ còn thiếu 1 lãnh thổ nữa là chiếm trọn châu lục đó
```

Chọn lãnh thổ điểm cao nhất, đặt 1 quân, lặp lại cho tới khi hết quân tăng viện
(`aiReinforceStep`, vòng lặp có guard 200 lần đề phòng vô hạn).

Trước khi đặt quân, AI còn thử đổi bài (`aiTryTradeCards`, xem mục 4).

## 4. Đổi bài (card trade-in) — `aiTryTradeCards` / `findTradeCombo`

- Bắt buộc đổi nếu có ≥5 lá bài (đúng luật Risk).
- Nếu có tổ hợp 3 lá hợp lệ (3 lá cùng loại, hoặc 3 loại khác nhau) nhưng chưa bị bắt
  buộc, AI có 60% cơ hội đổi ngay, 40% giữ lại chờ combo tốt hơn hoặc lượt sau
  (`Math.random()<0.4` thì bỏ qua).
- Giá trị quân thưởng tăng dần theo `TRADE_VALUES` dùng chung với người chơi
  ([`src/js/04-game-state.js:14`](src/js/04-game-state.js#L14)).

## 5. Tấn công — `aiAttackStep`

Đây là phần phức tạp nhất, gồm 3 lớp chiến thuật cộng vào 1 điểm số duy nhất
(`attackScore`, [05-ai.js:153](src/js/05-ai.js#L153)):

### a) Giữ quân dự phòng — `reserveFor(fromId, excludeTo)`
Trước khi tính có nên tấn công từ 1 lãnh thổ hay không, AI nhìn các *lãnh thổ địch khác*
giáp biên lãnh thổ đó (trừ mục tiêu đang xét) và để dành lại:

```
reserve = ceil(quân của láng giềng địch mạnh nhất khác × reserveFactor)
usable  = (quân hiện có − 1 − reserve)   // −1 vì luôn phải chừa lại ≥1 quân trấn giữ
```

→ Nếu 1 lãnh thổ có 2 hướng địch đe doạ, AI không dồn hết quân đánh 1 hướng mà bỏ mặc
hướng kia. `usable < 1` thì lãnh thổ đó bị loại khỏi danh sách có thể tấn công.

### b) Ưu tiên châu lục
`ratio = (usable+1) / quân địch tại ô đích`. Nếu chiếm ô đó xong sẽ chiếm TRỌN 1 châu
lục (`completesContinentFor`), cộng thẳng `+2.5` điểm bonus — đủ lớn để AI chấp nhận tỉ
lệ thắng thấp hơn bình thường miễn là hoàn tất châu lục.

### c) Ưu tiên "kết liễu" đối thủ yếu
Nếu đối thủ đang giữ ô đó chỉ còn ≤2 lãnh thổ trên bản đồ (sắp bị loại):

```
bonus += 1.5 + (số thẻ bài đối thủ đang có) × 0.4
```

→ Đối thủ càng nhiều bài càng đáng bị "làm thịt" trước, vì loại được họ thì cướp luôn
toàn bộ bài của họ (`checkElimination`, [04-game-state.js:265](src/js/04-game-state.js#L265)).

Ngược lại, nếu ô đó thuộc về người chơi đang dẫn đầu (`evaluatePlayerPower` cao nhất —
tính bằng tổng quân + 2×số lãnh thổ) và bản thân AI chưa mạnh hơn họ ít nhất 10%, AI bị
trừ `−0.6` điểm — dè chừng gây sự với kẻ mạnh nhất bàn.

### d) Chọn mục tiêu & ngưỡng quyết định tấn công
Mỗi vòng lặp (`step()`), AI duyệt **mọi cặp** (lãnh thổ mình có ≥2 quân) × (láng giềng
địch), tính điểm theo công thức trên, chọn cặp điểm cao nhất. Có tấn công hay không còn
tuỳ ngưỡng động:

```
effectiveThreshold = max(1.05, baseThreshold − bonus×0.3)
```

Bonus càng lớn (sắp ăn trọn châu lục / sắp kết liễu đối thủ) → ngưỡng càng hạ, AI chấp
nhận đánh dù tỉ lệ quân không áp đảo. Nếu `ratio < effectiveThreshold` (hoặc không còn
mục tiêu nào), AI dừng tấn công và chuyển sang fortify.

AI cứ đánh xong 1 trận (`doBattle`) lại tính lại từ đầu (tối đa 60 vòng lặp phòng vô
hạn) — nghĩa là 1 lượt có thể đánh liên tiếp nhiều trận nếu vẫn còn mục tiêu ngon.

### Cơ chế đổ xúc xắc (dùng chung cho cả người lẫn AI)
`doBattle(fromId, toId)` ở [04-game-state.js:162](src/js/04-game-state.js#L162):
tấn công tối đa 3 xúc xắc (= quân−1, tối đa 3), phòng thủ tối đa 2 xúc xắc (= quân, tối
đa 2). So từng cặp xúc xắc cao nhất với cao nhất — **hoà thì phòng thủ thắng**. Nếu
chiếm được ô (quân địch về 0), số quân tối thiểu phải chuyển sang = số xúc xắc tấn công
đã dùng ở lượt thắng đó; AI chuyển đúng mức tối thiểu này (không dồn thêm), giữ phần còn
lại ở ô xuất phát để phòng thủ.

## 6. Tăng cường (fortify) — `aiFortifyStep`

Logic đơn giản, không chấm điểm nhiều lựa chọn: tìm lãnh thổ "hậu phương" (toàn bộ láng
giềng đều là quân mình, và có >1 quân) đang giữ **nhiều quân nhất**, dồn gần hết
(chừa lại 1) sang lãnh thổ biên giới (có láng giềng địch) gần nhất có đường nối
(`pathExistsOwned`). Chỉ chuyển 1 lần duy nhất mỗi lượt, không lặp tối ưu nhiều bước.

## 7. Kết thúc lượt & phát thẻ bài

`endTurn()` ([04-game-state.js:321](src/js/04-game-state.js#L321)) quyết định có phát
thẻ bài hay không dựa theo `RUNTIME_CONFIG.cardAwardEvent` (chọn ở màn Cài đặt, xem
[config.md](#) / màn Settings), áp dụng như nhau cho cả người chơi lẫn AI vì dùng chung
1 hàm:

- `on_capture` (mặc định) — chiếm được ≥1 lãnh thổ trong lượt (`p.capturedThisTurn`,
  set trong `doBattle` khi chiếm xong 1 ô).
- `on_kill` — chỉ cần hạ được ≥1 quân địch trong lượt, không cần chiếm trọn ô
  (`p.killedThisTurn`, set trong `doBattle` khi `defLoss>0`, tức thắng ≥1 lượt xúc xắc).
- `on_turn_end` — luôn được phát, không cần điều kiện gì.

Nếu đủ điều kiện: random 1 loại thẻ bài, cộng vào tay bài, rồi chuyển sang người chơi
còn sống kế tiếp trong `turnOrder`. AI không có logic riêng cho việc này — nó tự động
nhận thẻ theo đúng chế độ đang chọn vì đi qua cùng `endTurn()`; các công thức chấm điểm
tấn công ở mục 5 (đặc biệt phần "kết liễu đối thủ yếu") không đổi theo chế độ này, vì
chúng nhắm tới việc **cướp trọn bộ bài đã tích luỹ** của đối thủ khi loại họ
(`checkElimination`), không phụ thuộc vào việc thẻ được phát ra sao.

## Tóm tắt độ "thông minh"

AI **không** nhìn trước nhiều nước đi, không mô phỏng phản ứng của đối thủ. Cái làm nó
đỡ "ngáo" hơn 1 AI tấn công-theo-tỉ-lệ-đơn-thuần là 3 lớp cộng điểm ở bước tấn công
(mục 5): giữ quân dự phòng trước mối đe doạ thứ 2, ham hoàn tất châu lục, và săn đối thủ
sắp chết để cướp bài — cùng với việc so sánh sức mạnh tổng thể để né gây sự với người
đang dẫn đầu khi mình chưa đủ mạnh.
