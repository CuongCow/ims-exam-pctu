# Hướng dẫn xử lý lỗi khi build IMS EXAM PCTU

## Lỗi: Cannot create symbolic link - A required privilege is not held by the client

Lỗi này xảy ra khi electron-builder cố gắng tạo symbolic links nhưng không có quyền.

### Giải pháp 1: Vô hiệu hóa Code Signing (Đã được áp dụng)

Đã cập nhật `package.json` để vô hiệu hóa code signing. Thử build lại:

```bash
npm run build:win64
```

### Giải pháp 2: Chạy với quyền Administrator

1. Mở PowerShell hoặc Command Prompt với quyền **Administrator**
2. Điều hướng đến thư mục dự án:
   ```powershell
   cd C:\xampp\htdocs\PCTU\ims-exam-pctu
   ```
3. Chạy build:
   ```powershell
   npm run build:win64
   ```

### Giải pháp 3: Bật Developer Mode trên Windows

1. Mở **Settings** > **Update & Security** > **For developers**
2. Bật **Developer Mode**
3. Khởi động lại máy tính
4. Chạy build lại

### Giải pháp 4: Xóa cache và build lại

```bash
# Xóa cache electron-builder
rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache"

# Build lại
npm run build:win64
```

### Giải pháp 5: Build mà không cần portable (tạo installer)

Nếu vẫn gặp vấn đề với portable, có thể build dạng NSIS installer:

1. Cập nhật `package.json`:
```json
"win": {
  "target": ["nsis"],
  "icon": "assets/icon.ico",
  "sign": null
}
```

2. Build:
```bash
npm run build:win64
```

## Lưu ý

- Code signing chỉ cần thiết nếu bạn muốn phân phối ứng dụng công khai
- Đối với ứng dụng nội bộ trong trường học, không cần code signing
- File portable (.exe) sẽ hoạt động bình thường dù không được ký số
















