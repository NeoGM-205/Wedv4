# GiaTộc ┊Name Hub v1.8.0 – Professional System

## Tính năng mới
- Permission Matrix: Boss cấu hình quyền chi tiết cho Kì Cựu/Member.
- Audit Log: lọc theo nhóm và tìm kiếm thao tác quản trị.
- Account Center: tổng quan tài khoản, 2FA, thiết bị, quyền và xuất dữ liệu cá nhân.
- Notification Preferences: chọn loại Push và Quiet Hours.
- Moderation Workflow: Open → In Review → Resolved/Dismissed, có người phụ trách và ghi chú nội bộ.
- System Status: Backend, Database, Storage, Push, Backup, uptime và phiên bản.
- Version & Cache Manager: kiểm tra/cập nhật Service Worker và xóa cache ứng dụng.

## Railway
Giữ Volume mount: `/app/storage`.
Biến nên có: `NODE_ENV=production`, `SESSION_SECRET`, `PUBLIC_ORIGIN`, `VAPID_SUBJECT`, `AUTO_BACKUP_HOURS=6`, `BACKUP_KEEP=30`.

## Kiểm tra
Mở `/api/health` và xác nhận `version` là `1.8.0`.
