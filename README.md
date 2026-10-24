# Ôn thi trắc nghiệm – GitHub Pages + Google Sheets

Ứng dụng ôn thi trắc nghiệm dạng SPA:

- **Frontend** (`index.html`, `js/`) chạy miễn phí trên **GitHub Pages** – Vue 3 + Tailwind CSS.
- **Backend** (`apps-script/Code.gs`) là **REST API trên Google Apps Script**, dùng Google Sheets làm cơ sở dữ liệu.
- Đáp án chỉ nằm ở server: chế độ *Thi thật* chấm điểm hoàn toàn trên Apps Script.

```
.
├── index.html              # Giao diện (GitHub Pages phục vụ file này)
├── js/
│   ├── config.js           # ← DÁN URL WEB APP VÀO ĐÂY
│   ├── api.js              # Gọi API bằng fetch()
│   └── app.js              # Logic Vue 3
├── apps-script/
│   ├── Code.gs             # Backend – dán vào Google Apps Script
│   └── appsscript.json     # Manifest (tùy chọn)
└── .nojekyll
```

## Bước 1 – Backend (Google Sheets + Apps Script)

1. Tạo một Google Sheet mới → **Extensions → Apps Script**.
2. Xóa nội dung mặc định, dán toàn bộ `apps-script/Code.gs` → **Save**.
3. Chọn hàm `setupSheets` → **Run** → cấp quyền (*Advanced → Go to … (unsafe) → Allow*).
4. Quay lại Sheet, mở tab **Questions** → **File → Import → Upload** file `Questions_TrietHoc.csv` (gửi kèm riêng, **không** đưa lên repo vì có đáp án)
   → chọn **Replace current sheet**. Nếu tên tab bị đổi, đổi lại thành `Questions`.
5. **Deploy → New deployment → ⚙ Web app**
   - *Execute as*: **Me**
   - *Who has access*: **Anyone** (bắt buộc – nếu không trình duyệt sẽ nhận trang đăng nhập thay vì JSON)
6. Bấm **Deploy** → copy **Web app URL** (dạng `https://script.google.com/macros/s/AKfy.../exec`).
7. Kiểm tra nhanh: mở `URL?action=init` trên trình duyệt → phải thấy JSON `{"success":true,...}`.

> Sửa `Code.gs` sau này: **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy**.
> Làm vậy URL giữ nguyên, không phải sửa frontend.

## Bước 2 – Frontend (GitHub)

1. Mở `js/config.js`, thay `PASTE_YOUR_WEB_APP_URL_HERE` bằng URL ở bước 1.6.
2. Tạo repository mới trên GitHub (Public – GitHub Pages miễn phí cho repo public).
3. Đẩy code lên:

   **Cách A – bằng Git**
   ```bash
   cd quiz-github
   git init
   git add .
   git commit -m "Initial commit: quiz app"
   git branch -M main
   git remote add origin https://github.com/<username>/<repo>.git
   git push -u origin main
   ```

   **Cách B – không cần Git**: trong repo mới bấm **uploading an existing file**, kéo thả *toàn bộ nội dung*
   thư mục (index.html, js/, apps-script/, README.md) → **Commit changes**.
   (File `.nojekyll` bị ẩn trên một số máy – không có cũng chạy được.)

4. Repo → **Settings → Pages** → *Source*: **Deploy from a branch** → Branch **main** / **(root)** → **Save**.
5. Sau 1–2 phút, trang chạy tại `https://<username>.github.io/<repo>/`.

## Cập nhật

| Muốn thay đổi | Làm gì |
|---|---|
| Câu hỏi / giải thích | Sửa trực tiếp tab **Questions** (cache tự xóa khi sửa, hoặc chạy `clearQuestionCache`) |
| Giao diện | Sửa `index.html` / `js/app.js` → commit → GitHub Pages tự cập nhật |
| Logic chấm điểm | Sửa `Code.gs` → deploy **New version** |
| Tham số (thời gian dung sai, số câu tối đa, trộn đáp án…) | Khối `CONFIG` đầu `Code.gs` |

## API

| Method | Body / Query | Trả về |
|---|---|---|
| `GET` | `?action=init` | Danh sách chủ đề, tổng số câu |
| `POST` | `{"action":"start","payload":{topics,count,minutes,mode,ids?}}` | Đề thi (Thi thật: không kèm đáp án) |
| `POST` | `{"action":"submit","payload":{sessionId,answers,user}}` | Điểm + chi tiết từng câu |
| `POST` | `{"action":"history","payload":{user}}` | 20 lần làm gần nhất |

POST gửi với `Content-Type: text/plain` để tránh preflight CORS (Apps Script không hỗ trợ `OPTIONS`).
Mọi phản hồi có dạng `{ success, data, error }`.

## Lỗi thường gặp

- **"Không kết nối được API"** → URL trong `config.js` sai, hoặc Web App chưa để *Anyone*.
- **"Máy chủ trả về dữ liệu không phải JSON"** → Web App đang yêu cầu đăng nhập; deploy lại với *Who has access: Anyone*.
- **Sửa code Apps Script nhưng không thấy thay đổi** → chưa deploy *New version*.
- **Trang GitHub 404** → kiểm tra Settings → Pages đã chọn nhánh `main` / `(root)` và `index.html` nằm ở thư mục gốc repo.

## Lưu ý bảo mật

- Người làm bài tự nhập email/họ tên (trang GitHub không có phiên đăng nhập Google), nên ai biết email của người khác
  cũng xem được lịch sử của người đó. Không dùng cho kỳ thi cần xác thực danh tính.
- URL Web App là công khai – điều này bình thường, vì đáp án và chấm điểm nằm ở server.
- **Không commit file câu hỏi có đáp án (CSV/XLSX) lên repo public** – ai cũng tải được và chế độ Thi thật mất ý nghĩa.
  `.gitignore` đã chặn sẵn `*.csv` và `*.xlsx`.
