# PAGES · แดชบอร์ดความคืบหน้า

**หัวข้อ:** Chess Analytics & Coaching Hub (ระบบวิเคราะห์และคลังข้อมูลหมากรุกอัจฉริยะ)
**data.json เก็บอะไร:** รายการประวัติเกมหมากรุก ได้แก่ id, game_id, date, white, black, opening, eco, result, accuracy, blunders, notes
**คัดลอก data.json → data.sample.json แล้ว:** [x]

## team — หน้าทีม
- [x] กรอก `team.json` ครบทุกคน (ชื่อ, รหัส, บทบาท, งานที่รับผิดชอบ)
- [x] เปิด /team เห็นชื่อทุกคน

## page1 — ผู้รับผิดชอบ: ศุภวิชญ์ / ทีม AI Arena
- [x] คัดลอกจาก catalog แล้วเปลี่ยน TITLE
- [x] ใช้ field ของ data.json ของกลุ่ม
- [x] เปิด /page1 ได้ ไม่มี TODO
- [x] check_project.py → /page1 ✓

## page2 — ผู้รับผิดชอบ: ธนกฤต / Backend & Data Engineer
- [x] คัดลอกจาก catalog แล้วเปลี่ยน TITLE
- [x] ใช้ field ของ data.json ของกลุ่ม
- [x] เปิด /page2 ได้ ไม่มี TODO
- [x] page2 มี `handle(form)` และ `storage.save()`

## page3 — ผู้รับผิดชอบ: กิตติศักดิ์ / Frontend & Systems Thinking
- [x] คัดลอกจาก catalog แล้วเปลี่ยน TITLE
- [x] ใช้ field ของ data.json ของกลุ่ม
- [x] เปิด /page3 ได้ ไม่มี TODO
- [x] แสดงสารานุกรมรูปเปิดและหลักคิดเชิงระบบ

## models.py — ผู้รับผิดชอบ: ธนกฤต
- [x] เปลี่ยนชื่อ class ให้ตรงหัวข้อ, field ตรง data.json
- [x] method 1 ตัวที่มีประโยชน์ (ไม่เหลือ TODO)
- [x] มีหน้าใดหน้าหนึ่งใช้ class นี้
- [x] `python check_project.py` → class ✓ 9/9

## ส่งงาน
- [x] check_project.py → 60/60
- [x] pytest test_pages.py → 4 passed
- [x] ทุกคนอยู่ใน `team.json` และสามารถอธิบายหน้าแต่ละหน้าได้
