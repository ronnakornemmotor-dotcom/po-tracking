# ระบบติดตามการสั่งซื้อ (po-tracking)

หน้าเว็บติดตาม PR/PO ของอะไหล่ ข้อมูลเก็บใน Google Sheet และอ่าน/เขียนผ่าน Google Apps Script

- **หน้าเว็บ:** https://ronnakornemmotor-dotcom.github.io/po-tracking/
- **API:** Apps Script Web app (URL `/exec` อยู่ใน `config.js`)

```
index.html            หน้าเว็บ
config.js             API_URL และ timeout (แก้ที่นี่ที่เดียว)
assets/css/app.css    สไตล์ (สีหลักอยู่ที่ :root)
assets/js/api.js      เรียก API ด้วย fetch (timeout, ข้อความ error ภาษาไทย, PIN ถ้าเปิดใช้)
assets/js/app.js      โค้ดหน้าเว็บ
assets/img/logo.jpg   โลโก้
apps-script/Code.gs   สำเนาโค้ด Apps Script (ของจริงอยู่ในโปรเจกต์ Apps Script ของชีต)
apps-script/Index.html  หน้าเว็บเดิมแบบ HtmlService (ทางสำรอง — เปิด URL /exec ตรง ๆ)
```

## การทำงาน

| หน้าเว็บเรียก | วิธี | หมายเหตุ |
|---|---|---|
| `getData` | `GET /exec?action=getData` | โหลดอะไหล่ + รายการ PR ทั้งหมด |
| `saveOrder`, `deleteOrder`, `bulkAddOrders`, `bulkUpdateOrders`, `importOrders`, `savePrBatch`, `undoPrBatch` | `POST /exec` body `{"action":..,"args":[..]}` | ส่งเป็น `Content-Type: text/plain` เพื่อเลี่ยง CORS preflight |

ตอบกลับเป็น JSON เสมอ: `{ "ok": true, "data": ... }` หรือ `{ "ok": false, "message": "..." }`
เปิด URL `/exec` โดยไม่มี `?action=` จะได้หน้าเว็บเดิม (HtmlService) ไว้ใช้สำรอง

## ความปลอดภัย

- repo นี้เป็น **public** — ห้ามใส่ไฟล์ข้อมูล (CSV/Excel), Sheet ID, รหัสผ่าน หรือข้อมูลลูกค้า (`.gitignore` กันไฟล์ CSV/Excel ไว้แล้ว)
- URL `/exec` อยู่ในโค้ดที่ใครก็เห็นได้ และ **ตอนนี้ไม่ได้เปิดใช้ PIN** → ใครมี URL ก็เพิ่ม/แก้/ลบข้อมูลได้
- **เปิดใช้ PIN ได้โดยไม่ต้องแก้โค้ด:** Apps Script → ⚙ Project Settings → Script properties →
  เพิ่ม `WRITE_PIN` = รหัสที่ต้องการ → Save (มีผลทันที ไม่ต้อง deploy ใหม่)
  หน้าเว็บจะถาม PIN ตอนบันทึกครั้งแรก (จำไว้จนปิดแท็บ) — ลบ property ออก = ปิด PIN
- แนะนำสำรองชีตเป็นระยะ (File → Make a copy) และกู้ได้จาก File → Version history

## วิธีอัปเดต

**แก้หน้าเว็บ** (index.html, assets/, config.js)
1. แก้ไฟล์ → ทดสอบในเครื่อง (ด้านล่าง)
2. ถ้าแก้ css/js ให้เพิ่มเลข `?v=` ใน `index.html` (เช่น `app.js?v=2`) กันมือถือจำไฟล์เก่า
3. `git add -A && git commit -m "..." && git push` → GitHub Pages อัปเดตภายในไม่กี่นาที

**แก้ Code.gs**
1. แก้ `apps-script/Code.gs` แล้ววางทับในโปรเจกต์ Apps Script → Save
2. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**
   (แก้ deployment เดิม URL `/exec` จะไม่เปลี่ยน — ห้ามกด New deployment)
3. ตั้งค่า deployment ต้องเป็น **Execute as: Me** และ **Who has access: Anyone**
   (ไม่ใช่ "Anyone with Google account" — จะเปิดไม่ได้เมื่อเบราว์เซอร์ล็อกอิน Google หลายบัญชี)
4. commit สำเนา `apps-script/Code.gs` ขึ้น repo ด้วย

## ทดสอบในเครื่อง

```powershell
py -m http.server 8000
```
เปิด http://localhost:8000 (ห้ามเปิดจาก `file://`) → DevTools → Console/Network ต้องไม่มี error สีแดง

## Rollback

- **หน้าเว็บ:** `git revert <commit>` แล้ว `git push`
- **Apps Script:** Deploy → Manage deployments → ✏️ → Version: เลือกเวอร์ชันก่อนหน้า → Deploy
