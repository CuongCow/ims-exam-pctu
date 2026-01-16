# DANH SÁCH CÁC PHÍM TẮT WINDOWS ĐÃ ĐƯỢC KHÓA TRONG IMS EXAM PCTU

Tài liệu này liệt kê tất cả các phím tắt Windows hệ thống đã được tích hợp vào hệ thống khóa phím tắt của IMS EXAM PCTU (khóa ở mức hệ thống qua Electron globalShortcut).

**Tổng số phím tắt Windows đã khóa: 12 phím tắt**

---

## 📋 DANH SÁCH CHI TIẾT

### 1. CHUYỂN ĐỔI CỬA SỔ & ỨNG DỤNG - 3 phím tắt

1. **Alt+Tab** - Chuyển đổi giữa các ứng dụng đang mở
2. **Alt+Esc** - Chuyển đổi giữa các cửa sổ theo thứ tự mở
3. **Ctrl+Tab** - Chuyển tab (đã khóa ở cả browser level và system level)

### 2. QUẢN LÝ CỬA SỔ - 4 phím tắt

4. **Alt+F4** - Đóng cửa sổ hiện tại
5. **Alt+Space** - Mở menu hệ thống của cửa sổ (menu điều khiển cửa sổ)
6. **Alt+Enter** - Phóng to/thu nhỏ hoặc mở thuộc tính
7. **Shift+F10** - Mở menu ngữ cảnh (context menu, tương đương click chuột phải)

### 3. TASK MANAGER & HỆ THỐNG - 2 phím tắt

8. **Ctrl+Alt+Del** - Mở màn hình bảo mật Windows (Security screen)
9. **Ctrl+Shift+Esc** - Mở Task Manager trực tiếp

### 4. ỨNG DỤNG & THOÁT - 1 phím tắt

10. **Ctrl+Q** - Thoát ứng dụng (trong một số ứng dụng)

### 5. CHỤP MÀN HÌNH - 1 phím tắt

11. **PrintScreen** - Chụp ảnh màn hình

### 6. TẠO MỚI - 1 phím tắt

12. **Ctrl+Shift+N** - Tạo thư mục mới / Cửa sổ ẩn danh (đã khóa ở cả browser level và system level)

---

## ⚠️ LƯU Ý QUAN TRỌNG

### Phím tắt Windows Key (Super Key) KHÔNG THỂ KHÓA

Do hạn chế của Electron và Windows, các phím tắt sử dụng phím **Windows (Win)** không thể bị khóa thông qua `globalShortcut`:

- **Win+D** - Hiển thị/ẩn Desktop
- **Win+R** - Mở hộp thoại Run
- **Win+E** - Mở File Explorer
- **Win+L** - Khóa màn hình
- **Win+M** - Thu nhỏ tất cả cửa sổ
- **Win+Tab** - Mở Task View
- **Win+I** - Mở Settings
- **Win+X** - Mở Quick Link menu
- **Win+A** - Mở Action Center
- **Win+S** - Mở Search
- **Win+PrtScn** - Chụp ảnh màn hình và lưu vào thư mục Screenshots

**Giải pháp:** Để ngăn chặn sử dụng Windows key, hệ thống sử dụng:
- Chế độ **kiosk mode** hoặc **fullscreen** để giảm thiểu khả năng truy cập
- Giám sát các ứng dụng đang chạy để phát hiện các phần mềm không an toàn
- Khóa các phím tắt khác có thể sử dụng Windows key

---

## 🔒 CÁCH HOẠT ĐỘNG

1. **Khi bắt đầu thi:**
   - Hàm `lockSystemFeatures()` được gọi tự động
   - Tất cả các phím tắt trên được đăng ký qua Electron `globalShortcut.register()`
   - Phím tắt bị chặn ở mức hệ thống, không chỉ trong trình duyệt

2. **Trong quá trình thi:**
   - Các phím tắt bị chặn hoàn toàn, không thể sử dụng
   - Ngay cả khi chuyển sang ứng dụng khác, các phím tắt vẫn bị chặn

3. **Khi kết thúc thi:**
   - Hàm `unlockSystemFeatures()` được gọi
   - Tất cả các phím tắt được mở khóa (trừ kill switch)

---

## 🛡️ BẢO MẬT BỔ SUNG

Ngoài việc khóa phím tắt Windows, hệ thống còn có:
- **Browser shortcut blocking:** Khóa 70+ phím tắt trình duyệt (xem `DANH_SACH_PHIM_TAT_BLOCKED.md`)
- **Process monitoring:** Giám sát các phần mềm không an toàn đang chạy
- **Developer Tools Detection:** Tự động phát hiện và cảnh báo khi DevTools được mở
- **Safety checks:** Kiểm tra VM, Remote Desktop, Voice/Chat software, Multiple displays

---

**Cập nhật lần cuối:** 2025-12-15
**Phiên bản:** 1.0.0

