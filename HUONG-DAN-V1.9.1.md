# GiaTộc ┊Name Hub v1.9.1 — Sửa lỗi phòng Voice không nghe tiếng

## Đã sửa
- Thêm nút **🔊 Bật nghe** khi Chrome/Android chặn autoplay âm thanh từ WebRTC.
- Tự phát lại tất cả audio remote sau khi người dùng bấm nút.
- Hiển thị trạng thái kết nối âm thanh: đang nối / đã kết nối / mất kết nối / cần TURN.
- API voice trả về trạng thái TURN để giao diện chẩn đoán đúng.
- Giữ nguyên mic, mute/deafen, tự nối lại và tối ưu chạy nền.

## Nếu hai người vào phòng nhưng vẫn không nghe
Nếu giao diện báo **Không nối được P2P • cần TURN**, đây không còn là lỗi micro hay nút phát tiếng. Hai mạng đang chặn kết nối WebRTC trực tiếp. Cấu hình Coturn/TURN trên Railway bằng các biến `WEBRTC_TURN_URL` và credential theo `.env.example`.

## Kiểm tra nhanh
1. Hai tài khoản khác nhau vào cùng một phòng.
2. Cho phép Microphone trên cả hai máy.
3. Nếu hiện **🔊 Bật nghe**, bấm một lần.
4. Trạng thái nên chuyển sang **🟢 Âm thanh đã kết nối**.
5. Nếu báo cần TURN, cấu hình TURN rồi redeploy.
