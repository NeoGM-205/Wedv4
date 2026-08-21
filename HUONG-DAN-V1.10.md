# GiaTộc ┊Name Hub v1.10.0 — Android Native Voice nền

Bản này giữ toàn bộ web/PWA v1.9.3 và thêm thư mục `android-native/` để dùng Voice khi chuyển sang game khác.

## Kiến trúc Voice Native
- Activity native chứa WebView của Hub để đăng nhập và dùng toàn bộ chức năng web.
- Nút `🎙️ Voice nền` mở danh sách phòng Voice hiện có hoặc tạo phòng mới.
- `VoiceForegroundService` chạy với loại `microphone`, giữ kết nối khi Activity xuống nền.
- Micro dùng `AudioRecord` 16 kHz PCM16 mono và gửi qua Relay WebSocket hiện có của server.
- Âm thanh nhận về dùng `AudioTrack` với `USAGE_VOICE_COMMUNICATION`.
- Bật NoiseSuppressor, AcousticEchoCanceler và AutomaticGainControl khi thiết bị hỗ trợ.
- Bong bóng nổi dùng `TYPE_APPLICATION_OVERLAY`, có Tắt/Bật mic, Tắt/Bật nghe, Mở Hub và Rời phòng.
- Có Partial WakeLock trong lúc Voice để giảm nguy cơ CPU ngủ làm đứt âm thanh.

## Quyền Android cần cấp
1. Microphone.
2. Thông báo (khuyến nghị để thấy điều khiển Foreground Service).
3. `Hiển thị trên ứng dụng khác` để có bong bóng nổi.

Foreground Service phải được bắt đầu khi Hub đang hiển thị; sau đó mới chuyển sang game.

## Cách dùng
1. Mở ứng dụng Android Native và đăng nhập Hub.
2. Bấm `🎙️ Voice nền`.
3. Cấp Microphone và quyền bong bóng nổi khi được hỏi.
4. Chọn phòng hoặc tạo phòng mới.
5. Khi thấy `🟢 ... Mic nền đang hoạt động`, bấm Home/mở game khác.
6. Bong bóng `🎙️` vẫn nổi. Chạm bong bóng để mở điều khiển.

## Nếu game cũng sử dụng microphone
Hai ứng dụng Android thông thường không được đảm bảo cùng nhận một microphone đồng thời. Nếu game bật voice/mic của chính game, Android có thể ưu tiên game và Voice Hub nhận im lặng. Nên tắt mic/voice trong game nếu muốn dùng mic của GiaTộc ┊Name Hub.

## Build APK không cần Android Studio
### Cách dễ nhất — GitHub Actions
Workflow `.github/workflows/android-native-build.yml` đã có sẵn. Push source lên GitHub, mở Actions → `Build Android Native Voice` → Run workflow. Sau khi xong, tải artifact `GiaToc-Name-Hub-Native-Voice-debug`.

### Build trên Windows bằng dòng lệnh
Cần JDK 17, Android SDK Command-line Tools + API 36, Build Tools 35.0.0 và Gradle 8.13.

```powershell
cd android-native
.\build-apk.ps1
```

APK debug sẽ nằm tại:
`android-native/app/build/outputs/apk/debug/app-debug.apk`

## Railway
Backend vẫn chạy ở root repo như trước; thư mục `android-native/` không ảnh hưởng `npm start` của Railway.
Voice Native sử dụng chính endpoint `/api/voice/token` và `/voice-signal` hiện có. Không đặt `VOICE_RELAY_FALLBACK=false` vì client web cần Relay để nói chuyện với client Android Native.

## Lưu ý
- Nếu hệ thống của hãng điện thoại đóng Foreground Service do tiết kiệm pin, vào Cài đặt pin của Android và cho phép app hoạt động không bị hạn chế theo chính sách của thiết bị.
- Không cần giữ WebView ở trước màn hình sau khi Foreground Service đã vào phòng.
- Khi rời phòng, app giải phóng mic, AudioTrack, hiệu ứng audio, WebSocket và WakeLock.
