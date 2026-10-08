# Hướng dẫn cài đặt (chạy thật)

Các bước dưới đây cần đăng nhập tài khoản của công ty, nên phải do người quản trị tự làm.
Thứ tự: **1 Supabase → 2 Google OAuth → 3 Resend → 4 GitHub**. Mất khoảng 60–90 phút.

> Không bao giờ dán **service_role key** hay **Resend API key** vào code, file `.env` trong repo, hoặc GitHub Variables.

---

## 1. Supabase

1. https://supabase.com → **New project**
   - Name: `kinryu-ops` ・ Region: **Northeast Asia (Tokyo)** ・ đặt Database password mạnh và lưu vào trình quản lý mật khẩu.
2. Đưa database lên (chạy trong thư mục dự án):
   ```bash
   npx supabase login
   npx supabase link --project-ref <PROJECT_REF>     # PROJECT_REF nằm trong URL của dashboard
   npx supabase db push                              # chạy 3 file trong supabase/migrations
   ```
   Hoặc: Dashboard → **SQL Editor** → dán lần lượt nội dung 3 file `supabase/migrations/*.sql` (theo thứ tự tên file) → Run.
3. **Project Settings → API**: ghi lại `Project URL` và `anon public` key (2 giá trị này công khai, an toàn).
4. **Authentication → URL Configuration**
   - Site URL: `https://<github-user>.github.io/<repo>/`
   - Redirect URLs: thêm `https://<github-user>.github.io/<repo>/` và `http://localhost:5173/`
5. **Authentication → Sign In / Providers → Email**: bật *Confirm email*.
   (Nếu Resend chưa xác minh xong domain, có thể tạm tắt để test; manager vẫn phải duyệt từng người.)

## 2. Google OAuth

1. https://console.cloud.google.com → tạo project `kinryu-ops`.
2. **APIs & Services → OAuth consent screen**: User type *External*, app name `金龍 朝礼・巡回`, support email = email của công ty → **Publish app** (để không bị giới hạn 100 người test).
3. **Credentials → Create credentials → OAuth client ID** → *Web application*
   - Authorized JavaScript origins: `https://<github-user>.github.io`, `http://localhost:5173`
   - Authorized redirect URIs: `https://<PROJECT_REF>.supabase.co/auth/v1/callback`
4. Copy Client ID / Client secret → Supabase **Authentication → Providers → Google** → bật và dán vào.

## 3. Resend (email xác nhận / quên mật khẩu)

1. https://resend.com → **Domains → Add domain** → `avecvous-evolve.com`, region Tokyo.
2. Thêm các bản ghi DNS (SPF / DKIM / MX cho `send.`) mà Resend hiển thị vào nơi quản lý DNS của domain → chờ trạng thái **Verified**.
3. **API Keys → Create** (quyền *Sending access*). Không lưu key vào repo.
4. Supabase **Project Settings → Authentication → SMTP Settings** → Enable custom SMTP:
   - Host `smtp.resend.com` ・ Port `465` ・ Username `resend` ・ Password = API key
   - Sender email `support@avecvous-evolve.com` ・ Sender name `金龍 朝礼・巡回`
5. (Tuỳ chọn) Authentication → Email Templates: sửa tiêu đề/nội dung sang tiếng Nhật.

## 4. GitHub Pages

1. Tạo repo **public**, ví dụ `kinryu-ops` (tài khoản `evolveosaka-dev`).
2. **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables** → thêm:
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon public key
4. Push lên nhánh `main` → workflow *Deploy to GitHub Pages* tự build và đăng.
   Địa chỉ: `https://evolveosaka-dev.github.io/kinryu-ops/`

> `.gitignore` đã loại trừ PDF, Excel (`.xlsm`), thư mục `MAIN*` và `KE_HOACH_DU_AN.md` — các file này không bao giờ lên GitHub.

## 5. Tài khoản quản lý đầu tiên

1. Trước lần đăng nhập đầu, chạy trong **SQL Editor** (thay bằng email của người quản lý):
   ```sql
   insert into public.bootstrap_accounts (email, role) values ('email-quan-ly@example.com', 'manager');
   ```
2. Mở app → **Google で続ける** bằng email đó. Tài khoản tự động là **管理者 (manager)**, trạng thái **利用中** — không cần ai duyệt.
3. Đồng ý thông báo quyền riêng tư → vào **管理** để duyệt nhân viên đăng ký sau:
   chọn cửa hàng → **承認**; với thành viên tuần tra bật **巡回メンバー**; với quản lý chọn **管理者**.

## Chạy trên máy (phát triển)

```bash
cp .env.example .env.local   # điền URL và anon key
npm run dev                   # http://localhost:5173
```
