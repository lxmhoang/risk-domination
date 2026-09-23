# Thảo luận: nâng cấp AI theo hướng "1 chiến lược tổng thể/lượt" + thang trigger/đối sách

Ghi lại nguyên trạng thảo luận (2026-09) để lục lại sau — **CHƯA implement**, chỉ mới
đã làm xong phần `pickAITurnIntent` cơ bản (4 intent, không có thang level) trong
`src/js/05-ai.js` + tài liệu ở [`ai.md`](ai.md). Phần dưới đây là bước tiếp theo được
đề xuất nhưng đang tạm dừng lại để làm việc khác trước.

## Bối cảnh

`ai.md` hiện mô tả AI theo 4 bước độc lập (reinforce/trade/attack/fortify), mỗi bước tự
chấm điểm riêng, không có 1 sợi chỉ xuyên suốt lượt. Đã thêm `pickAITurnIntent(pid)`
chạy 1 lần đầu lượt, chọn 1 trong 4 ý định (`finish_continent`, `kill_weak`, `defend`,
`expand`) theo thứ tự ưu tiên cố định, rồi truyền xuống cả 3 bước reinforce/attack/
fortify để chúng cộng điểm ưu tiên theo đúng ý định đã chọn thay vì tính độc lập.

## Đề xuất mở rộng (chưa làm)

Ý tưởng: mỗi intent (kể cả intent mới `stay_survival`) không còn là điều kiện đơn "có/
không" nữa, mà có **2 thang riêng**:

1. **Thang trigger** (nhiều mức, quy ước Level 4 = cẩn trọng nhất, Level 1 = bỏ qua hẳn
   intent đó lượt này) — quyết định intent này CÓ được chọn hay không. Lưu ý: "cẩn
   trọng" không phải lúc nào cũng nghĩa là khó trigger hơn — với intent phòng thủ
   (`stay_survival`, `defend`) cẩn trọng = trigger SỚM/DỄ hơn (thà lo hụt còn hơn chết);
   với intent tấn công/tham lam (`finish_continent`, `kill_weak`, `expand`) cẩn trọng =
   trigger KHÓ/CHẶT hơn (chỉ làm khi chắc ăn).
2. **Thang đối sách** — sau khi trigger, chọn cách thực thi nặng/nhẹ khác nhau.

Level nào được dùng (cả trigger lẫn đối sách) phụ thuộc `personality` của AI đó (thiên
hướng cố định) **+ 1 yếu tố "mood" random mỗi lượt** để tạo đa dạng lối chơi giữa các
lượt dù cùng 1 AI/personality.

### Intent mới: `stay_survival`

Nên đứng **ưu tiên số 1**, trên cả `finish_continent` — sắp chết thì không màng chuyện
chiếm nốt châu lục.

Công thức: với mỗi láng giềng địch trực tiếp của 1 lãnh thổ biên, A = quân địch tại đó
(+ dự phóng tăng viện lượt tới của họ nếu level yêu cầu, ước theo kiểu
`computeReinforcements`), B = quân tôi tại đó (+ quân bên thứ 3 phải bị vượt qua nếu là
mối đe doạ 2 bước chứ không giáp biên trực tiếp — **chỗ này còn đang đoán, chưa chắc
đúng ý user, cần xác nhận lại**). ratio = A/B.

- **Level 4 — Nhạy bén**: A gồm dự phóng tăng viện lượt tới của địch. Ngưỡng ratio ≥ 1.5.
- **Level 3 — Bình thường**: như trên nhưng A chỉ tính quân hiện tại. Ngưỡng vẫn 1.5.
- **Level 2 — Dè dặt**: như Level 3, ngưỡng nâng lên ratio ≥ 2.0.
- **Level 1 — Vô tư**: bỏ qua hẳn, không xét stay_survival lượt này.

Lưu ý: 3 mức trên **lồng nhau** trên cùng 1 tín hiệu (Level 2 đúng ⟹ Level 3, 4 cũng
đúng) — không phải 4 tình huống loại trừ nhau. Personality+mood quyết định "kiểm tra sâu
tới mức nào" (ngưỡng nào còn buồn kiểm tra), rồi lấy mức SÂU NHẤT (khắt khe nhất) đang
đúng để suy ra độ nghiêm trọng → chọn đối sách.

Đối sách:
- **Response 2 — Cực đoan (co cụm)**: khi Level 2's bar đúng (nguy hiểm hiện tại, thật)
  → không tấn công gì cả lượt, dồn hết quân dự phòng về đúng biên bị đe doạ, nằm yên.
- **Response 1 — Đánh rỉa**: khi chỉ Level 3/4's bar đúng (cảnh báo sớm) → vẫn cố kiếm 1
  lá bài: `on_capture` → chọn đúng 1 ô địch ít quân nhất chiếm rồi dừng; `on_kill` →
  đánh 1 hiệp có lợi rồi dừng; `on_turn_end` → behave như Response 2 (không cần đánh).

Personality lean: turtle → hay chạm Level 4; rusher → mặc định Level 2; opportunist/
balanced → Level 3.

### `finish_continent`

- **Level 4 — Thận trọng**: thiếu đúng 1 ô, giáp biên, VÀ sau khi chiếm vẫn đủ quân giữ
  TRỌN đường biên mới của châu lục (kiểm tra kiểu `reserveFor` cho từng biên mới, không
  chỉ riêng ô vừa chiếm).
- **Level 3 — Bình thường**: thiếu đúng 1 ô, giáp biên, ô đó không bị phòng thủ quá dày
  — nhưng KHÔNG kiểm tra khả năng giữ cả châu lục sau đó.
- **Level 2 — Bất cẩn (hành vi hiện tại)**: thiếu đúng 1 ô, giáp biên → đánh luôn.
- **Level 1 — Mù mờ**: bỏ qua, không màng hoàn tất châu lục lượt này.

Đối sách:
- **Response B — Dốc lực giữ đất**: sau khi chiếm, fortify kéo TOÀN BỘ quân thừa (kể cả
  rút từ mặt trận khác) về củng cố biên châu lục mới.
- **Response A — Có tính toán**: fortify chỉ kéo đủ mức tối thiểu để biên yếu nhất an
  toàn, phần còn lại vẫn phục vụ intent khác.

Personality lean: turtle → Level 4/Response A; rusher → Level 2/Response B; balanced →
Level 3/Response A.

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

Personality lean: opportunist → Level 4/Response B (khớp `killBonusMult:1.8` sẵn có);
turtle → Level 2/Response A; balanced → Level 3/Response A.

### `defend`

Khác `stay_survival`: đây là "1 biên đang hơi yếu, nên củng cố" — chưa phải nguy cơ bị
loại. Nếu `stay_survival` đã trigger thì `defend` coi như vô nghĩa lượt đó.

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

## Giả định còn treo, cần user xác nhận trước khi code

1. Thứ tự ưu tiên mới: `stay_survival` (nếu trigger) > `finish_continent` > `kill_weak`
   > `defend` > `expand`.
2. Cơ chế personality+mood: roll **1 lần mood chung mỗi lượt** (không phải roll riêng
   từng intent) — áp dụng lệch ±1 level lên baseline của TẤT CẢ intent trong lượt đó.
3. Công thức "bên thứ 3" ở `stay_survival` Level 4 — đang đoán, chưa chắc đúng ý user.
4. Số lượng level của thang trigger vs thang đối sách không nhất thiết bằng nhau (ví dụ
   stay_survival có 4 trigger level nhưng chỉ 2 response level) — cần user xác nhận quy
   tắc ánh xạ trigger-level → response-level cho từng intent, hiện đang đoán theo kiểu
   "level nào nghiêm trọng hơn cũng có xu hướng dùng response nặng hơn", không có công
   thức chung cứng.
