# Trạng thái UI polish (Tier 1/2/3) — cập nhật 2026-09

Ghi lại để lục lại sau, tránh mất ngữ cảnh khi conversation dài. Xem thảo luận gốc (danh sách
đầy đủ 15 hạng mục, xếp theo dễ/tác động cao → khó/tốn công) trong lịch sử chat — file này chỉ
tóm tắt tình trạng "đã làm / còn treo".

## Đã làm

**Tier 1 (5/5 mục)** — commit `be69638`:
- Badge số quân: gradient + đổ bóng thay vì đĩa phẳng.
- Lãnh thổ: radial gradient thay vì tô màu phẳng (`shadeColor()`, [06-render-game.js](src/js/06-render-game.js)).
- Xúc xắc: animation `pop` có sẵn, thêm stagger delay theo index để lăn tuần tự.
- Nút & player-card: transition mượt hơn, glow player-card đang tới lượt đổi từ tĩnh sang pulse.
- Chuyển màn hình: fade + slide nhẹ thay vì hiện/ẩn cứng.
- Bonus: modal (capture/đổi bài/kết quả trận đấu/game-over) có entrance animation (fade+pop).
- Có `prefers-reduced-motion` override tắt hết animation trên.

**Tier 2 (4/5 mục)** — commit `e410109`:
- Hiệu ứng chiếm đất: lãnh thổ fade màu sang chủ mới thay vì đổi tức thì.
- Số quân "chạy": badge tween từ giá trị cũ sang mới.
- Viền chọn (`selectedFrom`/`selectedTo`): pulse glow thay viền tĩnh.
- Player card: thêm progress bar % lãnh thổ đang giữ.
- **Bỏ qua mục 9 (bộ icon SVG riêng thay emoji)**: cần lặp nhìn-sửa nhiều lần để không xấu hơn
  emoji hiện tại, không làm mù quáng khi không xem trước được kết quả.

**Tier 3 (2/5 mục)** — commit `e410109`:
- Texture hạt nhiễu (grain noise) phủ nhẹ lên gradient mỗi lãnh thổ (`getNoisePattern()`,
  [01-utils.js](src/js/01-utils.js), cùng kỹ thuật offscreen-tile với `getStripePattern` có sẵn).
- Particle nổ nhẹ khi 1 lãnh thổ bị chiếm (`spawnCaptureParticles()`).

Cơ chế chung của Tier 2+3: `drawGameCanvas()` tự so sánh state hiện tại với frame trước
(`lastDrawnOwner`/`lastDrawnArmies`) để phát hiện thay đổi và animate, không cần sửa
`doBattle`/`aiFortifyStep`. Chỉ chạy `requestAnimationFrame` khi đang animate.

**Ngoài 3 tier gốc**: làm mượt biên giới lãnh thổ bằng Douglas-Peucker + Chaikin (giữ nguyên
điểm neo giữa các lãnh thổ kề nhau, tránh hở/chồng biên) — commit `f7ac908`. Xem comment đầu
[02-map-model.js](src/js/02-map-model.js) (`traceMaskBoundary`/`splitLoopIntoRuns`) để hiểu chi
tiết 3 lớp bug đã gặp và sửa (anchor không khớp, Chaikin bo lại điểm neo, tie-break không đối
xứng theo chiều duyệt).

## Còn treo — cần quyết định trước khi làm tiếp

1. **Âm thanh**: chưa làm gì. Cần chọn: (a) SFX tổng hợp bằng Web Audio API (không cần asset,
   chất lượng thấp hơn âm thật), hay (b) user tự cung cấp file âm thanh để wire vào.
2. **Bản đồ nghiêng/isometric**: chưa làm. Đây là viết lại lớn phần hình học canvas + click
   hit-testing (đã khá phức tạp/tinh chỉnh nhiều lần qua các commit trước) — rủi ro cao nếu làm
   ẩu, cần xác nhận hướng trước khi bắt tay vào.
3. **Splash/custom font riêng**: chưa làm. Load Google Fonts cần mạng, phá vỡ nguyên tắc "1 file
   HTML tự chứa, chạy offline" hiện tại của project (xem README.md) — cần user xác nhận có chấp
   nhận đánh đổi này không, hoặc tìm hướng khác (nhúng font trực tiếp base64, tăng size file).

## Test có sẵn để kiểm tra không phá vỡ AI/game logic khi tiếp tục polish UI
`npm run test:ai` ([test/ai-smoke-test.js](test/ai-smoke-test.js)) — headless, không cần
browser, chạy vài giây. Các thay đổi UI/canvas thuần không được test này bao phủ (nó stub
`renderGame` thành no-op) — muốn kiểm tra riêng phần canvas thì cần viết lại 1 script tạm
tương tự cách đã làm trong quá trình polish (dựng fake canvas 2D context, gọi thẳng
`drawGameCanvas()`), không có sẵn trong repo vì chỉ dùng tạm lúc debug.
