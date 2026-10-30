# Chiến lược của AI (tra cứu nhanh)

Mỗi lượt, AI chọn **đúng 1 chiến lược** (`pickAITurnIntent` trong
[`src/js/05-ai.js`](src/js/05-ai.js)) rồi cả 3 bước tăng viện → tấn công → fortify đều phục
vụ chiến lược đó. Tên chiến lược hiện ở thanh dưới cùng giữa màn chơi và trong nhật ký trận
đấu. Chi tiết đầy đủ ở [`ai.md`](ai.md); lịch sử thảo luận ở
[`ai-strategy-discussion.md`](ai-strategy-discussion.md).

## Thứ tự ưu tiên — theo tier

"Lọt sàng xuống nia": xét tier 1 trước. Trong 1 tier, lọc các chiến lược **khớp** (trigger =
yes) — có 1 thì chọn luôn, có nhiều thì **random đều** 1 cái — rồi dừng. Không cái nào khớp
thì xuống tier tiếp theo. Tier cuối có thêm **fallback** `attempt_continent`, chỉ dùng khi
không còn gì khác khớp, nên lúc nào cũng chọn được.

| Tier | Chiến lược | Tên hiển thị | Thang trigger | Đối sách |
|---|---|---|---|---|
| 1 | `stay_survival` | Sống còn | 1–4 | 1 / 2 |
| 2 | `kill_weak` | Kết liễu đối thủ yếu | 1–4 | A / B |
| 2 | `push_to_win` | Tổng tấn công | 1–3 | A / B |
| 3 | `defend` | Phòng thủ biên giới | 1–3 | A / B |
| 3 | `break_continent` | Phá châu lục | 1–3 | A / B |
| 4 | `finish_continent` | Hoàn tất châu lục | 1–4 | A / B |
| 4 | `revenge` | Trả thù | 1–3 | A / B |
| 4 | `expand` | Mở rộng | 1–3 | A / B — **tạm tắt**, chỉ là lưới an toàn cuối |
| 4 (fallback) | `attempt_continent` | Âm mưu chiếm châu lục | không có | không có |

Thêm chiến lược mới: viết 1 hàm trong `AI_STRATEGIES` (`src/js/05-ai.js`) rồi bỏ tên vào 1
tier trong `AI_STRATEGY_TIERS`.

## Cơ chế chung: trigger, đối sách, mood

- **Thang trigger**: chiến lược có được xét lượt này không, và với điều kiện chặt tới đâu.
  Level 1 luôn là "bỏ qua hẳn lượt này".
- **Thang đối sách**: sau khi được chọn thì thực thi nặng hay nhẹ. **Độc lập** với level
  trigger.
- **Mood**: đầu mỗi lượt roll 2 số ngẫu nhiên độc lập — 1 cho trục trigger, 1 cho trục đối
  sách — dùng chung cho mọi chiến lược trong lượt đó.
- **Lean theo tính cách**: mỗi tính cách "hay chạm" 1 mức — mức đó nặng gấp 3 các mức khác:
  - Thang 4 mức: mức lean 50%, mỗi mức còn lại ~17%.
  - Thang 3 mức: mức lean 60%, mỗi mức còn lại 20%.
  - Đối sách 2 lựa chọn: lean 75% / còn lại 25%; không lean thì 50/50.
- Ô có dấu `*` trong các bảng lean dưới đây không được chốt rõ khi thảo luận, đang tạm theo
  `balanced`.

**3 ngưỡng tỉ lệ quân** dùng chung (chỉnh ở `/admin`, nhóm "AI theo độ khó"):

| Tên | Config | Mặc định |
|---|---|---|
| Cẩn thận | `aiEasyThreshold` | 2.0 |
| Bình thường | `aiNormalThreshold` | 1.5 |
| Chủ quan | `aiHardThreshold` | 1.15 |

---

## 1. `stay_survival` — Sống còn

"Sắp chết thì không màng chiếm châu lục." Ưu tiên cao nhất.

**Trigger.** Với mỗi ô địch giáp biên của mình:
`tỉ lệ = quân địch ở ô đó / tổng quân của mình trên toàn bản đồ`. Lấy biên có tỉ lệ cao
nhất. Ngưỡng **đảo chiều** — ngưỡng thấp = dễ trigger:

| Level | Tên | Ngưỡng | Ghi chú |
|---|---|---|---|
| 4 | Nhạy bén | ≥ 1.15 | quân địch cộng thêm tăng viện lượt tới của họ |
| 3 | Bình thường | ≥ 1.5 | |
| 2 | Dè dặt | ≥ 2.0 | |
| 1 | Vô tư | — | bỏ qua |

Lean trigger: turtle 4 · rusher 2 · opportunist 3 · balanced 3.

**Đối sách.** Lean: turtle 2 · rusher 1 · opportunist 1 · balanced không nghiêng.

- **2 — Co cụm**: không tấn công. Toàn bộ tăng viện và fortify dồn vào đúng biên bị đe doạ.
- **1 — Đánh rỉa**: tăng viện vẫn dồn vào biên bị đe doạ, rồi cố kiếm 1 lá bài và dừng
  tấn công:
  - `on_capture`: đánh ô địch ít quân nhất, cố chiếm.
  - `on_kill`: đánh đúng 1 hiệp có lợi.
  - `on_turn_end`: không đánh (như Co cụm).

**Chưa làm:** tính đến mối đe doạ từ "bên thứ 3" không giáp biên trực tiếp.

---

## 2. `finish_continent` — Hoàn tất châu lục

**Lực trên lục địa** (`continentForce`, dùng chung với `attempt_continent`):

```
A = quân của mình trong châu lục
  + quân ở ô ngoài châu lục có đường fortify tới (mỗi ô chừa 1),
    trừ ô thuộc châu lục khác đã chiếm trọn mà đang giáp player khác
  + quân tăng viện lượt này
B = tổng quân địch trên các ô còn thiếu
tỉ lệ = A / B
```

**Trigger.** Châu lục mình có ≥1 ô nhưng chưa trọn (thiếu bao nhiêu ô cũng được), ít nhất 1
ô còn thiếu giáp ô của mình, và tỉ lệ ≥ **2.0 (Cẩn thận)**. Nhiều châu lục cùng đạt → lấy tỉ
lệ cao nhất.

| Level | Tên | Điều kiện thêm |
|---|---|---|
| 4 | Thận trọng | chiếm xong vẫn giữ được trọn biên mới của châu lục |
| 3 | Bình thường | — |
| 2 | Bất cẩn | — (hiện giống Level 3) |
| 1 | Mù mờ | bỏ qua |

Lean trigger: turtle 4 · rusher 2 · balanced 3 · opportunist 3`*`.

**Thực thi.**
- **Tăng viện**: ô trong châu lục +1.2 điểm.
- **Tấn công**: vòng tấn công thường, ô đích trong châu lục +0.8 bonus — đánh lan liên tiếp
  nhiều ô được.
- **Fortify**: đích ưu tiên là ô biên trong châu lục.

**Đối sách.** Lean: turtle A · rusher B · balanced A · opportunist A`*`.

- **A — Có tính toán**: fortify chỉ kéo đủ quân bù chênh lệch ở biên, phần dư ở lại hậu
  phương.
- **B — Dốc lực**: fortify rút hết hậu phương (chừa 1).

---

## 3. `kill_weak` — Kết liễu đối thủ yếu

Loại được ai thì lấy toàn bộ bài của họ.

**Trigger.** Có đối thủ còn ít lãnh thổ và giáp đất mình; nhiều người đạt → chọn người ít ô
nhất.

| Level | Tên | Điều kiện |
|---|---|---|
| 4 | Săn đuổi chủ động | ≤ 3 ô, và tổng quân của họ ≤ sức mạnh của mình × 0.5 (ước lượng thô) |
| 3 | Bình thường | ≤ 2 ô |
| 2 | Dè dặt | ≤ 2 ô (hiện giống Level 3) |
| 1 | Không màng | bỏ qua |

Lean trigger: opportunist 4 · turtle 2 · balanced 3 · rusher 3`*`.

**Thực thi.**
- **Tăng viện**: toàn bộ dồn vào biên giáp đối thủ đó.
- **Tấn công**: vòng tấn công thường, bonus khi đánh đối thủ đó.
- **Fortify**: đích ưu tiên là ô giáp đối thủ đó.

**Đối sách.** Lean: opportunist B · rusher B · turtle A · balanced A.

- **A — Ăn miếng ngon**: bonus +1.0; dừng tấn công ngay sau lần đầu chiếm được 1 ô của họ.
- **B — Truy sát tận diệt**: bonus +1.6; đánh tiếp tới khi loại hẳn hoặc hết tỉ lệ.

**Chưa làm:** điều kiện riêng của Level 2 (không để quân tụt dưới mức an toàn).

---

## 4. `defend` — Phòng thủ biên giới

"1 biên đang hơi yếu" — nhẹ hơn `stay_survival`.

**Trigger.** Chỉ xét tỉnh thuộc **châu lục mình đã chiếm trọn** — biên ở châu lục đang âm
mưu hay không quan tâm thì bỏ qua (chưa chiếm trọn châu lục nào thì không bao giờ
trigger). Trong số đó lấy biên có `chênh lệch = quân địch mạnh nhất giáp nó − quân mình ở
đó` lớn nhất, **và** mình không phải người mạnh nhất bàn.

| Level | Tên | Điều kiện |
|---|---|---|
| 3 | Chăm chút | chênh lệch ≥ 1 |
| 2 | Bình thường | chênh lệch ≥ 2 |
| 1 | Phớt lờ | bỏ qua |

Lean trigger: turtle 3 · balanced 2 · rusher 1 · opportunist 2`*`.

**Thực thi.**
- **Tăng viện**: biên đó +1.0 điểm.
- **Fortify**: đích ưu tiên là biên đó.
- **Tấn công**: vẫn chạy vòng thường nhưng mọi đòn bị trừ điểm (theo đối sách).

**Đối sách.** Lean: turtle B · balanced A · rusher A · opportunist A`*`.

- **A — Gia cố nhẹ**: mọi đòn tấn công −0.3.
- **B — Gia cố mạnh**: mọi đòn tấn công −0.5.

---

## 3 chiến lược thêm 2026-10-31

### `push_to_win` — Tổng tấn công (tier 2)

Mình áp đảo rõ cả bàn → bỏ dè dặt, đánh dồn để kết thúc ván (tránh ván kéo dài lê thê cuối game).

| Level | Điều kiện |
|---|---|
| 3 | sức mạnh ≥ 0.8 × tổng sức mạnh các đối thủ còn lại |
| 2 | sức mạnh ≥ 1.0 × tổng đó |
| 1 | bỏ qua |

Lean trigger: rusher 3 · opportunist 3 · balanced 2 · turtle 2.

**Đối sách.** Lean: rusher B, còn lại A.
- **A — Dồn dập**: mọi đòn tấn công +0.8.
- **B — Tất tay**: mọi đòn +1.5 và không giữ quân dự phòng.

### `break_continent` — Phá châu lục (tier 3)

Đối thủ giữ trọn 1 châu lục giáp đất mình → đánh vào 1 ô để cắt thưởng của họ.

| Level | Điều kiện (Tỷ lệ quân số tại ô định phá) |
|---|---|
| 3 | ≥ 1.15 (Chủ quan) |
| 2 | ≥ 1.5 (Bình thường) |
| 1 | bỏ qua |

Nhiều châu lục đạt → chọn châu lục thưởng cao nhất, rồi ô có tỉ lệ tốt nhất. Lean trigger:
rusher 3 · opportunist 3 · balanced 2 · turtle 2.

**Thực thi.**
- **Tăng viện**: toàn bộ vào ô mạnh nhất của mình giáp ô định phá.
- **Tấn công**: +2.0 vào đúng ô định phá, +1.5 vào ô khác của châu lục đó.
- **Fortify**: đích ưu tiên là ô giáp châu lục đó.

**Đối sách.** Lean: rusher B, còn lại A.
- **A — Phá rồi thôi**: chiếm được 1 ô của châu lục là dừng tấn công.
- **B — Phá rồi đánh tiếp** như thường.

### `revenge` — Trả thù (tier 4)

Ai đánh mình đau nhất kể từ cuối lượt trước của mình thì lượt này nhắm vào họ. Đây là trí nhớ
duy nhất của AI giữa các lượt (`game.damageTaken`).

`mức đau = số ô bị chiếm × 3 + số quân mất`

| Level | Tên | Điều kiện |
|---|---|---|
| 3 | Thù dai | mức đau ≥ 3 |
| 2 | Bình thường | mức đau ≥ 6 |
| 1 | — | bỏ qua |

Kẻ đó phải còn sống và giáp đất mình. Lean trigger: rusher 3 · balanced 2 · opportunist 2 ·
turtle 1.

**Thực thi** giống `kill_weak`: tăng viện dồn vào biên giáp kẻ đó, fortify về đó.

**Đối sách.** Lean: rusher B, còn lại A.
- **A — Trả đũa**: tấn công họ +1.2; chiếm được 1 ô của họ là dừng.
- **B — Truy cùng**: tấn công họ +1.8; đánh tiếp.

---

## 5. `attempt_continent` — Âm mưu chiếm châu lục

Fallback khi 4 chiến lược trên không khớp. Không có thang trigger/đối sách.

**Trigger.** Luôn chạy nếu có ít nhất 1 châu lục mình có ≥1 ô mà chưa trọn.

**Thực thi.**

1. **Chọn châu lục**: Lực trên lục địa (mục 2) cao nhất. Khi tỉ lệ lên ≥ 2.0 thì lượt sau
   nó tự "chín" thành `finish_continent`.
2. **Tăng viện**: toàn bộ vào 1 ô trong châu lục — ô mạnh nhất của mình giáp ô địch ít quân
   nhất trong châu lục.
3. **Tấn công** — giữ lực cho châu lục, chỉ cố kiếm 1 lá bài:
   - a. **Hú hoạ**: dùng quân ở ô *không* có đường tới châu lục, đánh 1 ô địch tỉ lệ tốt
     nhất, đánh tới khi chiếm hoặc hết quân (không xét ngưỡng).
   - b. Không chiếm được → đánh ô địch ít quân nhất trong châu lục, dừng khi tỉ lệ dưới
     ngưỡng tấn công của độ khó.
   - Chiếm được 1 ô là thôi.
4. **Fortify**: dồn mọi ô ngoài châu lục có đường tới (cả ô đang giáp địch, chừa 1) vào
   châu lục, ưu tiên ô tập kết ở bước 2 rồi ô giáp địch. **Không** rút khỏi ô của châu lục
   đã chiếm trọn đang giáp player khác.

---

## 6. `expand` — Mở rộng (tạm tắt)

Chỉ chạy khi không có châu lục nào để âm mưu (mọi châu lục mình có mặt đều đã chiếm trọn).

**Trigger.**

| Level | Tên | Hành vi |
|---|---|---|
| 3 | Cơ hội nhất | tập trung vào cặp biên có tỉ lệ quân tốt nhất |
| 2 | Bình thường | tập trung vào biên yếu nhất của mình |
| 1 | Rụt rè | không tấn công, chỉ tăng viện/fortify |

Lean trigger: rusher 3 · turtle 1 · balanced 2 · opportunist 2.

**Đối sách.** Lean: rusher B · turtle A · balanced A · opportunist A.

- **A — Thăm dò**: tối đa 2 trận/lượt.
- **B — Đánh sâu**: không giới hạn.

---

## Luật chung áp lên mọi chiến lược

- **Liên minh** (nếu bật): khi có "kẻ thù chung", mọi AI khác chỉ được đánh kẻ đó, và tăng
  viện/fortify dồn về biên giáp kẻ đó — **thắng** mọi chiến lược trên, trừ `stay_survival`
  (tăng viện vẫn dồn về biên bị đe doạ).
- **Ngưỡng tấn công** (vòng tấn công thường):
  `tỉ lệ ≥ max(1.05, ngưỡng độ khó + chỉnh theo tính cách − bonus × 0.3)` — bonus của chiến
  lược làm AI chịu đánh ở tỉ lệ xấu hơn.
- Trí nhớ giữa các lượt chỉ có "ai đánh mình" (cho `revenge`); chiến lược và mood chọn lại
  từ đầu mỗi lượt.
