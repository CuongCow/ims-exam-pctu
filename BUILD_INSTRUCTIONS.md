# Hướng dẫn Build IMS EXAM PCTU

## Vấn đề: Lỗi "Cannot create symbolic link - A required privilege is not held by the client"

Lỗi này xảy ra vì Windows yêu cầu quyền đặc biệt để tạo symbolic links. Có 2 cách giải quyết:

## Giải pháp 1: Chạy PowerShell với quyền Administrator (Khuyến nghị)

1. **Đóng PowerShell hiện tại** (nếu đang mở)

2. **Mở PowerShell với quyền Administrator:**
   - Nhấn `Windows + X`
   - Chọn "Windows PowerShell (Admin)" hoặc "Terminal (Admin)"
   - Hoặc click chuột phải vào PowerShell và chọn "Run as administrator"

3. **Điều hướng đến thư mục dự án:**
   ```powershell
   cd C:\xampp\htdocs\PCTU\ims-exam-pctu
   ```

4. **Chạy build:**
   ```powershell
   npm run build:win64
   ```

## Giải pháp 2: Bật Developer Mode trên Windows

1. Mở **Settings** (Cài đặt)
2. Vào **Update & Security** (Cập nhật & Bảo mật)
3. Vào **For developers** (Dành cho nhà phát triển)
4. Bật **Developer Mode**
5. Khởi động lại máy tính
6. Chạy build lại:

   ```powershell
   cd C:\xampp\htdocs\PCTU\ims-exam-pctu
   npm run build:win64
   ```

## Sau khi build thành công

File portable sẽ được tạo trong thư mục `dist/`:
- `IMS-EXAM-PCTU-1.0.0-x64.exe` (cho Windows 64-bit)
- `IMS-EXAM-PCTU-1.0.0-ia32.exe` (cho Windows 32-bit)

## Ghi chú

- Code signing đã được vô hiệu hóa, vì vậy file .exe sẽ không được ký số
- Đối với ứng dụng nội bộ trong trường học, không cần code signing
- Windows có thể hiển thị cảnh báo "Unknown publisher" khi chạy file .exe - đây là bình thường và có thể bỏ qua

## Troubleshooting

### Nếu vẫn gặp lỗi sau khi chạy với quyền admin:

1. Xóa cache electron-builder:
   ```powershell
   Remove-Item -Path "$env:LOCALAPPDATA\electron-builder\Cache" -Recurse -Force -ErrorAction SilentlyContinue
   ```

2. Chạy build lại:
   ```powershell
   npm run build:win64
   ```

### Nếu muốn build cho cả 32-bit và 64-bit:

```powershell
# Build 64-bit
npm run build:win64

# Build 32-bit (sau khi hoàn thành 64-bit)
npm run build:win32
```
















