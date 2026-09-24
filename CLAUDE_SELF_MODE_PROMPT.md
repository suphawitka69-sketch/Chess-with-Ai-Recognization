# Prompt สำหรับ Claude AI Web

## วัตถุประสงค์
เราต้องปรับระบบ “เล่นกับตัวเอง” (self mode / ghost mode) ให้ใช้พฤติกรรมจริงของผู้เล่นจากประวัติการเล่นทั้งหมด ไม่ใช่แค่ snapshot ล่าสุดหรือ snapshot ที่ stale จาก profile เดิม

สิ่งที่ต้องทำ:
1. จดจำ snapshot ของประวัติการเล่นทุกเกม
2. อัปเดต snapshot ทุกครั้งที่จบเกมหรือทุกครั้งที่เริ่มเล่นเกมใหม่
3. ให้ Ghost mode / Self mode ดึงข้อมูลจากประวัติที่อัปเดตล่าสุดเสมอ
4. ให้ habit signal, pattern, และพฤติกรรมที่ซ้ำซากถูกคำนวณจาก all-history ที่มีอยู่จริง
5. ป้องกัน bug ที่ self mode ใช้ profile snapshot ที่เก่าหรือไม่ตรงกับประวัติล่าสุด

---

## เทมเพลตคำสั่งให้ Claude

ฉันต้องการให้ Claude แก้ไขโค้ดในโปรเจกต์นี้โดยอ้างอิงจากสถานะจริงของ repo และต้องทำให้ self mode รู้จัก “พฤติกรรมของเรา” จากประวัติการเล่นทั้งหมดทุกเกม

### ภาระงานหลัก
- เพิ่ม snapshot/history mechanism สำหรับการเล่นแต่ละเกม
- ให้แต่ละเกมที่จบหรือเริ่มเล่นใหม่ มี snapshot ของข้อมูลประวัติการเล่นที่ถูกบันทึกไว้
- ให้ Ghost mode ใช้ snapshot ล่าสุดที่รวมประวัติทั้งหมด ไม่ใช่ profile เก่าหรือค่า cache ที่ stale
- คำนวณ habit pattern จาก database ของ move logs ทั้งหมด และไม่พึ่งพาแค่ลำดับสุดท้าย
- ยันว่าทุกครั้งที่เกมจบ ระบบต้อง rebuild profile จาก all move logs ก่อนเริ่มเกม self mode ใหม่

### หลักการของระบบที่ต้องใช้
- Source of truth คือ `db.games` + `db.moveLogs` + `db.profile`
- `ProfileRepository.syncProfileFromGames()` ต้อง rebuild จาก all history ทุกครั้ง
- `GhostEngine` ต้องใช้ `habitPatterns` / `habitSignals` ที่มาจาก profile ล่าสุด และต้องรวมประวัติทั้งหมด
- `self mode` ต้องอ่าน snapshot จาก profile ล่าสุดทันทีหลังเกมจบหรือหลัง sync profile
- หากไม่มีข้อมูลประวัติ ให้ fallback แบบ safe default ไม่ให้ crash

### ข้อจำกัดที่สำคัญ
- อย่าใช้ข้อมูล mock หรือสมมติฐานจากไฟล์ที่ไม่ได้มีอยู่จริง
- อย่าฟันธงจาก sample เล็กเกินไป
- อย่าประเมิน “ตาที่ควรเล่นแทน” ถ้าไม่มี engine จริงหรือ move log ที่ verified
- ต้องเก็บงบประมาณคำนวณแบบสิ้นเชิงจาก move logs จริง
- ทุกการบันทึก snapshot ต้องเป็น JSON-safe / Dexie-safe

---

## ไฟล์/โมดูลที่ต้องเปิดอ่านก่อนแก้ไข

1. `src/state/useGameStore.ts`
   - flow ของ `initGame`, `finishGame`, `triggerEngineMove`
   - ต้องตรวจว่า self mode เรียก engine/ghost แบบไหน

2. `src/core/profiling/GhostEngine.ts`
   - `selectMove()`
   - `GhostEngineProfileSnapshot`
   - `EngineMoveProvider`
   - ต้องทำให้ใช้ habit จาก all history

3. `src/core/profiling/HabitMiner.ts`
   - `mineHabits()`, `mineHabitsFromMoveLogs()`
   - ต้องยืนยันว่า mining ใช้ all move logs และไม่เป็นแค่ข้อมูลล่าสุด

4. `src/data/repositories/ProfileRepository.ts`
   - `syncProfileFromGames()`
   - `updateAfterGame()`
   - ต้อง rebuild profile จาก real DB snapshot ทุกครั้ง

5. `src/shared/types/schema.ts`
   - `PlayerProfileRecord`, `HabitPattern`, `GameSummaryRecord`, `OpponentConfigRecord`
   - ตรวจว่า snapshot model และ profile schema ครบ

6. `src/App.tsx`
   - `startGhostGame()`
   - ตรวจว่าเริ่มเกม self mode จาก profile ใด และมี stale snapshot หรือไม่

7. `src/features/profile/ProfileScreen.tsx`
   - load profile และ sync จาก games
   - ใช้ในการ confirm snapshot ใหม่ถูกใช้งาน

8. `src/features/ghost/GhostMatchSetup.tsx`
   - UI ที่ให้เลือก snapshot เดิม/ประวัติเกมเก่า

---

## ความคาดหวังจากการแก้ไข

### A. Snapshot mechanism
เพิ่ม mechanism สำหรับเก็บ snapshot ของประวัติการเล่นทั้งหมดแบบ repeatable เช่น:
- `historySnapshots` หรือ `gameSnapshots`
- เก็บข้อมูลสำคัญต่อเกม: `gameId`, `startedAt`, `endedAt`, `playerColor`, `opponent`, `moveCount`, `result`, `habitFingerprint`, `profileSnapshotHash`, `moveLogIds`, `profileVersion`
- snapshot ต้องอัปเดตทุกครั้งเมื่อเกมจบ

### B. Rebuild profile from all game history
- ตอนจบเกม ให้เรียก profile sync ที่ rebuild จากทุก `db.games` + `db.moveLogs`
- บันทึกผลลง `db.profile`
- `db.profile` ต้องเป็น source สำหรับ Ghost mode

### C. Self mode uses all-history habit
- self mode ไม่ใช่เป้าหมายที่จะใช้แค่เกมล่าสุด
- ควรใช้ habit signal จากผลรวมของ all-games สำหรับการเลือก move
- ถ้าค่า habit ขาดหรือไม่มี ให้ fallback ไป engine strength เท่านั้น

### D. Safety / crash-proofing
- หาก move log หรือ profile snapshot มี missing fields ให้ default กลับมา
- หลีกเลี่ยง `undefined` access
- ใช้ optional chaining และ safe defaults

---

## Deliverables ที่ต้องส่งกลับ
1. Patch code ที่แก้ไข logic จริง
2. อธิบายว่า snapshot ถูกอัปเดตตรงไหน
3. อธิบายว่า self mode ดึง profile จากไหน
4. อธิบายว่า habit mining ใช้ประวัติทั้งหมดจาก `db.moveLogs` อย่างไร
5. หากมีการเพิ่ม table/schema ให้ระบุชื่อ field ที่เพิ่มและเหตุผล

---

## Prompt สั้นสำหรับ Claude Web

ช่วยแก้ปัญหา self mode / ghost mode ในโปรเจกต์นี้ให้ใช้ประวัติการเล่นจริงของผู้เล่นจากทุกเกม ไม่ใช่ snapshot เก่าหรือ profile ที่ stale

ตรงนี้เป็น root cause:
- self mode ใช้ profile หรือ habit snapshot ที่ไม่ได้ refresh ทุกครั้ง
- `GameStore` และ `GhostEngine` ไม่ได้ rebuild จาก all history
- `HabitMiner` ถูกคำนวณจาก move logs ที่อาจเป็นการเล่นล่าสุดหรือไม่ครบ

กรุณาทำต่อไปนี้:
1. เพิ่ม snapshot/history mechanism สำหรับเกมและ profile
2. บันทึก snapshot ทุกครั้งที่เกมจบและทุกครั้งที่ผู้เล่นเริ่มเกมใหม่
3. `syncProfileFromGames()` ต้อง rebuild จาก `db.games` + `db.moveLogs` ทุกรอบ
4. `startGhostGame()` และ self mode ต้องอ่าน profile ล่าสุดที่ sync แล้ว
5. `GhostEngine` ต้องใช้ habit pattern จากประวัติทั้งหมดเพื่อจำลอง “ผู้เล่นของเรา”
6. ป้องกัน crash เมื่อ data หลาย field missing
7. ให้ code สะอาดและมี TypeScript correctness
8. อธิบายไฟล์และ patch ที่เปลี่ยนด้วยเหตุผลชัดเจน

---

## ข้อสั่งสุดท้ายสำหรับ AI
อย่าเริ่มจากการเดา “self mode ควรเล่นแบบไหน” โดยไม่อ่านโค้ดที่มีอยู่จริง ใช้ repository actual state เป็น source of truth และทำงานตามแนวทางนี้เท่านั้น

ต้องให้ self mode พัฒนาร่วมกับเรา: ทุกเกมที่เล่นใหม่ไป จะถูกบันทึกเป็น snapshot ใหม่ และ profile จะถูก rebuild ทางอัตโนมัติ จน ghost mode สามารถอ้างอิงพฤติกรรมจริงจากประวัติทั้งหมดได้อย่างต่อเนื่อง
