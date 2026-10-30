# Thảo luận: nâng cấp AI theo hướng "1 chiến lược tổng thể/lượt" + thang trigger/đối sách

Ghi lại thảo luận (2026-09 → 2026-10). **Đã implement** trong `src/js/05-ai.js`; mô tả
đúng theo code ở [`ai.md`](ai.md). Xem mục "Trạng thái implement" cuối file cho những chỗ
code đơn giản hoá hoặc chưa làm.

## Bối cảnh

`ai.md` hiện mô tả AI theo 4 bước độc lập (reinforce/trade/attack/fortify), mỗi bước tự
chấm điểm riêng, không có 1 sợi chỉ xuyên suốt lượt. Đã thêm `pickAITurnIntent(pid)`
chạy 1 lần đầu lượt, chọn 1 trong 4 ý định (`finish_continent`, `kill_weak`, `defend`,
`expand`) theo thứ tự ưu tiên cố định, rồi truyền xuống cả 3 bước reinforce/attack/
fortify để chúng cộng điểm ưu tiên theo đúng ý định đã chọn thay vì tính độc lập.

## Đề xuất mở rộng (đã làm — xem "Trạng thái implement")

### Tỷ lệ quân số (dùng chung cho mọi chỗ ước lượng tấn công bên dưới)

A = tổng quân của mình ở các Tỉnh giáp Tỉnh mục tiêu
B = quân địch ở Tỉnh mục tiêu
ratio = A/B

A **không** trừ quân dự phòng cho các láng giềng địch khác (khác với `reserveFor` ở
`aiAttackStep` hiện tại) — đã quyết đánh thì không giữ phần nào lại để phòng thủ nữa.

3 mức, dùng lại đúng 3 ngưỡng `baseThreshold` đã có sẵn và configurable trên admin portal
(nhóm "AI theo độ khó" trong `server/admin-config.js` — `aiEasyThreshold` /
`aiNormalThreshold` / `aiHardThreshold`) thay vì thêm 1 bộ ngưỡng mới cùng tính chất:

- **Cẩn thận** = `aiEasyThreshold` (hiện 2.0)
- **Bình thường** = `aiNormalThreshold` (hiện 1.5)
- **Chủ quan** = `aiHardThreshold` (hiện 1.15)

Đóng gói thành 1 hàm chung (ví dụ `estimateCaptureRatio(targetId, pid)` trả về `ratio`),
dùng lại ở mọi logic bên dưới (stay_survival, finish_continent, …) thay vì mỗi intent tự
viết lại công thức A/B riêng — mức nào trong 3 mức trên được dùng ở đâu do personality +
mood của intent đó quyết định (xem từng intent), nhưng *nguồn ngưỡng* và *nơi config*
luôn là một, không tạo field admin mới trùng ý nghĩa với 3 ngưỡng độ khó đã có.

Ý tưởng: mỗi intent (kể cả intent mới `stay_survival`) không còn là điều kiện đơn "có/
không" nữa, mà có **2 thang riêng**:


1. **Thang trigger** (nhiều mức, quy ước Level 4 = cẩn trọng nhất, Level 1 = bỏ qua hẳn
   intent đó lượt này) — quyết định intent này CÓ được chọn hay không. Lưu ý: "cẩn
   trọng" không phải lúc nào cũng nghĩa là khó trigger hơn — với intent phòng thủ
   (`stay_survival`, `defend`) cẩn trọng = trigger SỚM/DỄ hơn (thà lo hụt còn hơn chết);
   với intent tấn công/tham lam (`finish_continent`, `kill_weak`, `expand`) cẩn trọng =
   trigger KHÓ/CHẶT hơn (chỉ làm khi chắc ăn).
2. **Thang đối sách** — sau khi trigger, chọn cách thực thi nặng/nhẹ khác nhau.

Level nào được dùng phụ thuộc `personality` của AI đó (thiên hướng cố định) **+ 1 lần
roll "mood" random mỗi lượt** để tạo đa dạng lối chơi giữa các lượt dù cùng 1
AI/personality. Mood gồm **2 thuộc tính độc lập**, roll chung 1 lần nhưng không liên
quan tới nhau:

- **mood.trigger** — lệch level của **thang trigger**, áp lên TẤT CẢ intent trong lượt.
- **mood.response** — lệch level của **thang đối sách**, áp lên TẤT CẢ intent trong lượt.

Tức là đối sách (response) KHÔNG suy ra từ việc trigger-level nào vừa khớp/nghiêm trọng
tới đâu — nó là 1 roll riêng, độc lập hoàn toàn với trigger. 1 lượt "trigger dễ nổi nóng"
(mood.trigger lệch về phía dễ kích hoạt) hoàn toàn có thể đi cùng 1 "đối sách nhẹ nhàng"
(mood.response lệch về phía Response A) trong cùng 1 lượt, và ngược lại.

### Intent mới: `stay_survival`

Nên đứng **ưu tiên số 1**, trên cả `finish_continent` — sắp chết thì không màng chuyện
chiếm nốt châu lục.

Công thức: với mỗi láng giềng địch trực tiếp của 1 lãnh thổ biên, A = quân địch tại đó
(+ dự phóng tăng viện lượt tới của họ nếu level yêu cầu, ước theo kiểu
`computeReinforcements`), B = tổng số quân tôi có trên map (+ quân bên thứ 3 phải bị vượt qua để càn qua hết các lãnh thổ của tôi. ratio = A/B.

Tái dùng đúng 3 giá trị ngưỡng của "Tỷ lệ quân số" (2.0 / 1.5 / 1.15, cùng nguồn
`ai*Threshold` trên admin portal) — nhưng **chiều gán bị đảo lại** so với các intent tấn
công, vì ở đây ngưỡng THẤP mới là trigger DỄ/SỚM hơn (xem lưu ý "cẩn trọng" ở đầu mục
này), không phải ngưỡng cao:

- **Level 4 — Nhạy bén**: A gồm dự phóng tăng viện lượt tới của địch. Ngưỡng ratio ≥ 1.15
  (giá trị thấp nhất trong 3 mức → dễ trigger nhất).
- **Level 3 — Bình thường**: như trên nhưng A chỉ tính quân hiện tại. Ngưỡng ratio ≥ 1.5.
- **Level 2 — Dè dặt**: như Level 3, ngưỡng nâng lên ratio ≥ 2.0 (giá trị cao nhất trong
  3 mức → khó trigger nhất trong các level còn active).
- **Level 1 — Vô tư**: bỏ qua hẳn, không xét stay_survival lượt này.

Lưu ý: 3 mức trên **lồng nhau** trên cùng 1 tín hiệu (Level 2 đúng ⟹ Level 3, 4 cũng
đúng) — không phải 4 tình huống loại trừ nhau. `mood.trigger` + personality quyết định
"kiểm tra sâu tới mức nào" (ngưỡng nào còn buồn kiểm tra), rồi lấy mức SÂU NHẤT (khắt khe
nhất) đang đúng để biết stay_survival có trigger hay không.

Đối sách — chọn **độc lập** với trigger-level nào vừa khớp, bằng `mood.response` +
personality (xem mục "Thang đối sách" ở trên — không suy từ độ nghiêm trọng của trigger):
- **Response 2 — Cực đoan (co cụm)**: không tấn công gì cả lượt, dồn hết quân dự phòng về
  đúng biên bị đe doạ, nằm yên.
- **Response 1 — Đánh rỉa**: vẫn cố kiếm 1 lá bài: `on_capture` → chọn đúng 1 ô địch ít
  quân nhất chiếm rồi dừng; `on_kill` → đánh 1 hiệp có lợi rồi dừng; `on_turn_end` →
  behave như Response 2 (không cần đánh).

Personality lean (trigger): turtle → hay chạm Level 4; rusher → mặc định Level 2;
opportunist/balanced → Level 3. Personality lean (response): turtle → hay chạm Response
2; rusher/opportunist → hay chạm Response 1; balanced → tuỳ `mood.response`.

### `finish_continent`

**Cập nhật 2026-10-28:** không còn đòi "thiếu đúng 1 ô" — thiếu bao nhiêu ô cũng được, miễn
đủ mạnh để chiếm hết các ô còn thiếu. "Đủ mạnh" đo bằng **Lực trên lục địa** (dùng chung
với `attempt_continent`):

```
A = quân của tôi trong lục địa
  + quân ở ô ngoài lục địa có đường fortify tới (trừ ô thuộc lục địa khác đã chiếm trọn
    mà đang giáp player khác), mỗi ô chừa 1
  + quân tăng viện lượt này
B = tổng quân địch trên các ô còn thiếu
ratio = A/B ≥ mức Cẩn thận
```

"Giáp biên" = ít nhất 1 ô còn thiếu giáp ô của tôi.

- **Level 4 — Thận trọng**: ratio đạt, giáp biên, VÀ sau khi chiếm hết vẫn đủ quân giữ
  TRỌN đường biên mới của châu lục.
- **Level 3 — Bình thường**: ratio đạt, giáp biên — KHÔNG kiểm tra giữ châu lục sau đó.
- **Level 2 — Bất cẩn**: như Level 3.
- **Level 1 — Mù mờ**: bỏ qua, không màng hoàn tất châu lục lượt này.

Đối sách:
- **Response B — Dốc lực giữ đất**: sau khi chiếm, fortify kéo TOÀN BỘ quân thừa (kể cả
  rút từ mặt trận khác) về củng cố biên châu lục mới.
- **Response A — Có tính toán**: fortify chỉ kéo đủ mức tối thiểu để biên yếu nhất an
  toàn, phần còn lại vẫn phục vụ intent khác.

Personality lean (trigger): turtle → hay chạm Level 4; rusher → hay chạm Level 2;
balanced → hay chạm Level 3. Personality lean (response): turtle/balanced → hay chạm
Response A; rusher → hay chạm Response B.

### `kill_weak`

- **Level 4 — Săn đuổi chủ động**: đối thủ ≤3 lãnh thổ (không chỉ ≤2), giáp biên, VÀ
  tổng quân của họ toàn bản đồ đủ ít để tôi khả năng kết liễu trong 1-2 lượt.
- **Level 3 — Bình thường (hành vi hiện tại)**: đối thủ ≤2 lãnh thổ, giáp biên.
- **Level 2 — Dè dặt**: như Level 3, nhưng chỉ theo đuổi nếu không làm `usable` quân của
  tôi tụt xuống dưới mức stay_survival cần.
- **Level 1 — Không màng**: bỏ qua, không chủ động săn đối thủ yếu lượt này.

Đối sách:
- **Response B — Truy sát tận diệt**: hạ thêm ngưỡng tấn công riêng với đúng đối thủ
  này, cố đánh xuyên nhiều ô của họ trong 1 lượt để loại hẳn.
- **Response A — Ăn miếng ngon**: chỉ đớp 1 miếng ngon nhất lượt này, không cố loại hẳn
  bằng mọi giá.

Personality lean (trigger): opportunist → hay chạm Level 4 (khớp `killBonusMult:1.8`
sẵn có); turtle → hay chạm Level 2; balanced → hay chạm Level 3. Personality lean
(response): opportunist/rusher → hay chạm Response B; turtle/balanced → hay chạm
Response A.

### `defend`

Khác `stay_survival`: đây là "1 biên đang hơi yếu, nên củng cố" — chưa phải nguy cơ bị
loại. Nếu `stay_survival` đã trigger thì `defend` coi như vô nghĩa lượt đó.

**Cập nhật 2026-10-30:** chỉ xét tỉnh thuộc châu lục đã chiếm trọn — không phòng thủ biên
ở châu lục đang âm mưu chiếm hay châu lục không quan tâm.

- **Level 3 — Chăm chút**: bất kỳ biên nào chênh lệch quân ≥1 (dù nhẹ) VÀ tôi không dẫn
  đầu bàn.
- **Level 2 — Bình thường (hành vi hiện tại)**: biên yếu nhất chênh lệch ≥2 VÀ
  myPower < leaderPower.
- **Level 1 — Phớt lờ**: bỏ qua defend, nhường lại cho expand (chỉ dựa vào
  stay_survival để bắt trường hợp thực sự nguy).

Đối sách:
- **Response B — Gia cố mạnh**: bonus reinforce/fortify +1.0 như cũ, mở rộng phạt tấn
  công nơi khác từ −0.3 lên −0.5.
- **Response A — Gia cố nhẹ (hành vi hiện tại)**: bonus +1.0, phạt tấn công nơi khác
  giữ nguyên −0.3.

Personality lean: turtle → Level 3/Response B; balanced → Level 2/Response A; rusher →
Level 1.

### `expand` (mặc định/fallback — luôn có thể trigger)

- **Level 3 — Cơ hội nhất**: quét tất cả biên, chọn cặp có tỉ lệ thắng tốt nhất cho tôi
  (dễ ăn nhất), bất kể có phải biên yếu hay không.
- **Level 2 — Bình thường (hành vi hiện tại)**: chọn đúng biên yếu nhất của mình.
- **Level 1 — Rụt rè**: không chủ động tấn công mở rộng — chỉ reinforce/fortify.

Đối sách:
- **Response B — Đánh sâu (hành vi hiện tại)**: đánh liên tục cả lượt miễn còn tỉ lệ
  tốt.
- **Response A — Thăm dò**: giới hạn tối đa 1-2 trận lượt này dù vẫn còn mục tiêu ngon.

Personality lean: rusher → Level 3/Response B; turtle → Level 1/Response A; balanced/
opportunist → Level 2/Response A.

## Đã chốt với user (2026-10)

0. ✅ (2026-10-31) Thay thứ tự cố định bằng **tier**: tier 1 `stay_survival` · tier 2
   `kill_weak` · tier 3 `defend` · tier 4 `finish_continent`, `expand` (tắt) + fallback
   `attempt_continent`. Trong 1 tier nhiều chiến lược khớp thì random đều; fallback chỉ dùng
   khi không còn gì khớp. Mục 1 dưới đây là thứ tự cũ.
   Thêm 3 chiến lược (chi tiết ở `ai-strategy.md`): `push_to_win` (tier 2), `break_continent`
   (tier 3), `revenge` (tier 4, AI nhớ ai đánh mình qua `game.damageTaken`). Ngưỡng, level và
   lean của 3 cái này do Claude đề xuất, chưa tinh chỉnh với user.
   Sau đó: `break_continent` xuống tier 4; tier của mọi chiến lược (trừ fallback) chỉnh được
   trên trang `/admin` (key `aiTier<Tên>`).
1. ✅ Thứ tự ưu tiên: `stay_survival` (nếu trigger) > `finish_continent` > `kill_weak` >
   `defend` > `expand`.
2. ✅ Cơ chế personality+mood: roll **1 lần mood chung mỗi lượt** (không phải roll riêng
   từng intent) — nhưng mood gồm **2 thuộc tính độc lập** (`mood.trigger`,
   `mood.response`), mỗi thuộc tính lệch level của đúng 1 thang (trigger hoặc đối sách),
   áp lên TẤT CẢ intent trong lượt. Xem mục "Thang đối sách" ở trên.
3. ✅ Công thức "bên thứ 3" ở `stay_survival` Level 4 — đúng ý user, giữ như đã viết.
4. ✅ Đối sách (response) KHÔNG suy ra từ việc trigger-level nào vừa khớp/nghiêm trọng
   tới đâu. Nó là 1 roll độc lập (`mood.response` + personality lean riêng cho response),
   không liên quan gì tới `mood.trigger` hay level trigger đã khớp. Đã sửa lại phần đối
   sách của `stay_survival` theo đúng cơ chế này (trước đó bản nháp lỡ gán cứng Response 2
   ↔ Level 2, Response 1 ↔ Level 3/4 — sai).
5. ✅ `stay_survival` tái dùng đúng 3 giá trị ngưỡng của "Tỷ lệ quân số" (2.0 / 1.5 /
   1.15), nhưng B vẫn là tổng quân TOÀN BẢN ĐỒ của tôi (không phải quân ở 1 Tỉnh biên như
   công thức chung) — công thức A/B riêng của `stay_survival`, chỉ mượn chung *3 con số
   ngưỡng + nguồn config*, không mượn định nghĩa A/B.

## Giả định còn treo, cần user xác nhận trước khi code

1. Thang trigger/đối sách của `defend`/`kill_weak`/`finish_continent`/`expand` (mục
   riêng từng intent ở trên) vẫn đang liệt kê theo kiểu "Personality lean: X → Level
   N/Response M" — tức mặc định 1 cặp (level, response) cố định cho mỗi personality,
   CHƯA áp dụng cơ chế 2 thuộc tính mood độc lập vừa chốt ở mục 2/4 trên. Cần viết lại
   các dòng "Personality lean" này thành 2 dòng riêng (trigger lean / response lean,
   như đã làm cho `stay_survival`) cho đồng bộ.
2. Range cụ thể của `mood.trigger`/`mood.response` (ví dụ ±1 level, hay random 1-trong-4
   level không phụ thuộc baseline?) và cách nó cộng/lệch với baseline của personality —
   chưa có công thức, chỉ có ý tưởng "độc lập nhau".
