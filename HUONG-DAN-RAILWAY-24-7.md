# GiaTộc ┊Name Hub v1.2.2 — Railway 24/7

## 1. Không xóa Volume hiện tại
Giữ nguyên Volume `wedandroid-volume` đang gắn với service `WedAndroid`.

## 2. Đổi Mount Path
Trong Railway:

`wedandroid-volume` → Settings → Mount Path

Đổi thành:

```text
/app/storage
```

Sau đó Apply/Deploy thay đổi.

> Nếu trước đó Volume mount ở `/app/data` và đã có `db.json`, bản v1.2.2 sẽ tự nhận file `db.json` ở root Volume và copy sang `/app/storage/data/db.json` trong lần chạy đầu tiên. Không cần xóa dữ liệu cũ.

## 3. Đưa source v1.2.2 lên GitHub
Thay source cũ bằng source trong ZIP này rồi commit/push.

Không commit:

```text
.env
storage/
node_modules/
*.keystore
```

## 4. Railway Variables
Trong service `WedAndroid` → Variables, thêm tối thiểu:

```text
NODE_ENV=production
SESSION_SECRET=<một chuỗi ngẫu nhiên dài, giữ cố định>
```

Không cần tự đặt `PORT`; Railway cấp tự động.

## 5. Deploy
Deploy service `WedAndroid`.

Log thành công sẽ có dạng:

```text
GiaToc Name Hub v1.2.2 running on port ...
[Storage] /app/storage
```

## 6. Kiểm tra health
Mở:

```text
https://TEN-DOMAIN-CUA-BAN/api/health
```

Cần thấy:

```json
{
  "ok": true,
  "version": "1.2.2",
  "storage": {
    "root": "/app/storage"
  }
}
```

## 7. Dữ liệu được giữ trong Volume

```text
/app/storage/
├── data/db.json          # tài khoản, role, chat, thành tích, nhạc, ban, admin log
├── uploads/              # avatar/ảnh upload
├── backups/              # backup thủ công
├── sessions/sessions.json# phiên đăng nhập
└── .session-secret       # fallback secret nếu chưa đặt SESSION_SECRET
```

## 8. Test không mất dữ liệu
1. Tạo một tài khoản thử.
2. Upload avatar.
3. Gửi một tin chat.
4. Vào Railway → service → Restart/Deploy.
5. Mở web lại và kiểm tra tài khoản/avatar/chat còn nguyên.

## 9. Lưu ý
- Không xóa Volume nếu chưa có backup.
- `storage/` không nên đẩy lên GitHub vì có dữ liệu thật.
- Khi cộng đồng lớn, nên chuyển database JSON sang PostgreSQL/MySQL.
