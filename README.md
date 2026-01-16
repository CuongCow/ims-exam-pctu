# IMS EXAM PCTU - Trình duyệt thi an toàn

IMS EXAM PCTU là phần mềm trình duyệt thi an toàn cho hệ thống quản lý học tập PCTU. Phần mềm khóa các tính năng hệ thống để đảm bảo môi trường thi an toàn.

## Tính năng

- **Chế độ Kiosk**: Mở trình duyệt ở chế độ toàn màn hình, ẩn thanh địa chỉ và menu
- **Khóa hệ thống**: Vô hiệu hóa Task Manager, Alt+Tab, Windows key, Start Menu
- **Khóa bàn phím**: Chặn các phím tắt như F12, Ctrl+Shift+I, Ctrl+U
- **Chặn menu chuột phải**: Vô hiệu hóa menu chuột phải
- **Phát hiện máy ảo**: Cảnh báo khi chạy trong môi trường ảo
- **Portable**: Không cần cài đặt, chỉ cần tải về và chạy
- **Health Check Server**: Chạy local HTTP server trên port 8765 để hệ thống kiểm tra

## Cách sử dụng

### Cho sinh viên

1. Tải file `IMS-EXAM-PCTU-x.x.x-x64.exe` (hoặc x32 cho máy 32-bit)
2. Chạy file .exe (không cần cài đặt)
3. Phần mềm sẽ tự động mở trình duyệt
4. Đăng nhập vào hệ thống và bắt đầu thi

### Cho quản trị viên

1. Bật tính năng "Sử dụng hệ thống an toàn IMS EXAM PCTU" trong phần tạo/chỉnh sửa kỳ thi
2. Cung cấp link tải phần mềm cho sinh viên
3. Hướng dẫn sinh viên tải và mở phần mềm trước khi thi

## Phát triển

### Yêu cầu

- Node.js 16+ 
- npm hoặc yarn

### Cài đặt

```bash
cd ims-exam-pctu
npm install
```

### Chạy ở chế độ phát triển

```bash
npm start
```

### Build ứng dụng portable

```bash
# Build cho Windows 64-bit
npm run build:win64

# Build cho Windows 32-bit
npm run build:win32

# Build cả hai
npm run build:win
```

File portable sẽ được tạo trong thư mục `dist/`.

## Kiến trúc

- **main.js**: Process chính, quản lý cửa sổ và khóa hệ thống
- **preload.js**: Script chạy trong renderer process, chặn các hành động trong trình duyệt
- **HTTP Server**: Chạy trên port 8765 để health check

## Bảo mật

- Chặn Task Manager (Ctrl+Alt+Del)
- Chặn Alt+Tab và Windows+Tab
- Chặn Windows key
- Chặn Print Screen
- Chặn DevTools (F12, Ctrl+Shift+I)
- Chặn View Source (Ctrl+U)
- Vô hiệu hóa menu chuột phải
- Chặn mở cửa sổ mới
- Chặn điều hướng đến trang web khác

## Ghi chú

- Phần mềm chỉ cho phép thoát sau khi hoàn thành bài thi
- Sinh viên không thể đóng phần mềm bằng Alt+F4 hoặc các phím tắt khác
- Phần mềm phát hiện môi trường máy ảo nhưng vẫn cho phép chạy (có thể tùy chỉnh)

## Giấy phép

MIT License
















