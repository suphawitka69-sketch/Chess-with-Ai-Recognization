/**
 * vite-env.d.ts
 * ---------------------------------------------------------------------------
 * ประกาศ type สำหรับ import แบบพิเศษที่ Vite รองรับแต่ TypeScript ไม่รู้จักเอง
 * โดยเฉพาะ `?inline` ที่ main.ts ใช้ดึงเนื้อหา CSS มาเป็น string ธรรมดา
 * (แทนที่จะให้ Vite inject เข้า <head> ของ document อัตโนมัติ ซึ่งใช้ไม่ได้
 * กับ Shadow DOM — สไตล์ต้องถูกฉีดเข้า shadow root เองแทน)
 * ---------------------------------------------------------------------------
 */

declare module '*.css?inline' {
  const cssText: string;
  export default cssText;
}
