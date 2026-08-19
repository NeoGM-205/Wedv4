# GiaTộc ┊Name Hub v1.5.0

## Sau khi deploy Railway

1. Giữ Volume mount tại `/app/storage`.
2. Thêm `NODE_ENV=production` và `SESSION_SECRET` cố định.
3. Nên thêm `PUBLIC_ORIGIN=https://domain-cua-ban` và `VAPID_SUBJECT=https://domain-cua-ban`.
4. Có thể thêm `AUTO_BACKUP_HOURS=6` và `BACKUP_KEEP=30`.
5. Redeploy.
6. Mở `/api/health` và kiểm tra `version` là `1.5.0`.
7. Đăng nhập, vào **Thông báo** → bấm **Bật thông báo đẩy**.
8. Vào **Bạn bè & DM** để kết bạn và nhắn riêng.
9. Boss/Kì Cựu vào **Quản trị** để xem Báo cáo, Timeout và Backup/Restore.
10. Vào **Đồng bộ** để xem hàng đợi offline và xử lý conflict.

### Lưu ý Push Notification

- VAPID key được tự tạo một lần và lưu trong `/app/storage/vapid-keys.json` nếu bạn không đặt key qua biến môi trường.
- Không xóa Volume nếu muốn giữ VAPID key, dữ liệu và backup.
- Người dùng phải tự bấm bật thông báo trên thiết bị của họ.
