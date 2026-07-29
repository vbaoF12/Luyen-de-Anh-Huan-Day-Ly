# Nâng cấp đăng nhập học sinh trước khi chọn đề

Bản này được xây trên phiên bản `exam_library_upgrade` và thêm luồng:

1. Học sinh mở website.
2. Đăng nhập hoặc tạo tài khoản.
3. Hệ thống tải hồ sơ gồm họ tên và lớp.
4. Học sinh mới được vào kho đề.
5. Khi nộp bài, kết quả được gắn với đúng tài khoản học sinh.
6. Giáo viên vẫn đăng nhập bằng khu vực riêng và xem toàn bộ bảng điểm.

## File cần dùng

- `index.html`: giao diện đăng nhập/đăng ký học sinh và kho đề sau đăng nhập.
- `styles.css`: giao diện responsive cho máy tính và điện thoại.
- `app.js`: Supabase Auth, phân biệt học sinh/giáo viên, chọn đề và lưu điểm.
- `student_auth_upgrade.sql`: migration cần chạy thêm trên Supabase.
- `supabase_exam_library.sql`: file cũ để tham khảo; không cần chạy lại nếu đã chạy trước đó.

Giữ nguyên các file hiện tại của bạn:

- `data.js`
- `supabase-config.js`

## Bước 1: Chạy SQL

Vào Supabase:

`SQL Editor → New query`

Mở file `student_auth_upgrade.sql`, dán toàn bộ nội dung và nhấn `Run`.

SQL sẽ:

- Tạo bảng `student_profiles`.
- Tạo hồ sơ tự động khi học sinh đăng ký.
- Chỉ cho người đã đăng nhập xem kho đề.
- Gắn `student_user_id` vào từng kết quả.
- Cho học sinh nộp điểm bằng tài khoản của chính mình.
- Cho học sinh chỉ đọc lịch sử của mình; giáo viên đọc toàn bộ.

## Bước 2: Cấu hình Supabase Auth

Vào:

`Authentication → Providers → Email`

Đảm bảo email/password đang được bật và cho phép người dùng mới đăng ký.

Vào:

`Authentication → URL Configuration`

Điền:

- Site URL: địa chỉ website Vercel chính thức.
- Redirect URLs: thêm địa chỉ website Vercel, ví dụ `https://ten-web.vercel.app/**`.

### Chế độ xác nhận email

- Muốn học sinh tạo xong và vào web ngay: tắt `Confirm email` trong giai đoạn thử nghiệm.
- Muốn an toàn hơn: bật `Confirm email`; học sinh phải mở email xác nhận rồi mới đăng nhập.

## Bước 3: Thay file trong dự án

Thay ba file:

- `index.html`
- `styles.css`
- `app.js`

Giữ nguyên:

- `data.js`
- `supabase-config.js`

Cấu trúc cuối:

```text
website/
├── index.html
├── styles.css
├── app.js
├── data.js
└── supabase-config.js
```

## Bước 4: Tải lên GitHub

Tải ba file đã thay lên repository GitHub và commit:

`Thêm đăng nhập học sinh trước kho đề`

Chờ Vercel deploy thành `Ready`, sau đó mở website và nhấn `Ctrl + F5`.

## Bước 5: Kiểm tra

### Học sinh

1. Mở website bằng cửa sổ ẩn danh.
2. Chọn `Tạo tài khoản`.
3. Nhập họ tên, lớp, email và mật khẩu.
4. Đăng nhập.
5. Kiểm tra chỉ sau đăng nhập mới nhìn thấy kho đề.
6. Chọn đề, làm bài và nộp.
7. Vào Supabase → Table Editor → `exam_attempts`.
8. Kiểm tra cột `student_user_id` đã có giá trị.

### Giáo viên

1. Ở màn hình đầu, nhấn `Tôi là giáo viên`.
2. Đăng nhập tài khoản giáo viên.
3. Kiểm tra bảng điểm và quản lý đề vẫn hoạt động.
4. Tài khoản học sinh đăng nhập vào form giáo viên phải bị từ chối quyền.

## Lưu ý

- Supabase chỉ duy trì một phiên đăng nhập trên cùng một trình duyệt. Khi chuyển từ học sinh sang giáo viên, website sẽ đăng xuất tài khoản học sinh trước.
- Các kết quả cũ chưa có `student_user_id` vẫn được giáo viên nhìn thấy, nhưng học sinh sẽ không thấy các kết quả cũ đó trong lịch sử cá nhân.
- Đáp án đề vẫn được tải về trình duyệt để chấm bài. Bản này phù hợp cho luyện tập; bài kiểm tra chính thức nên chấm ở phía máy chủ.
