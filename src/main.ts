/**
 * main.ts
 * ---------------------------------------------------------------------------
 * จุดเข้าเดียวของ widget ทั้งก้อน (ตาม vite.config.ts: build.lib.entry) —
 * ประกาศ custom element `<chess-coach>` ที่ encapsulate ทุกอย่างไว้ใน
 * Shadow DOM (mode: 'open') เพื่อไม่ให้ CSS ของเว็บปลายทางรั่วเข้ามา และ
 * ไม่ให้ style ของเราหลุดออกไปกระทบเว็บปลายทางเช่นกัน
 *
 * ไฟล์นี้เป็น `.ts` ธรรมดา (ไม่ใช่ `.tsx`) โดยตั้งใจ — ไม่มี JSX syntax เลย
 * ใช้ `createElement()` ตรงๆ เพราะเป็นจุดที่ React "เริ่มทำงาน" ไม่ใช่จุดที่
 * เขียน UI (UI อยู่ใน PlayScreen.tsx และ component ย่อยทั้งหมด)
 *
 * งานของ custom element นี้มีแค่ 3 อย่าง: (1) แนบ Shadow Root (2) ฉีด CSS
 * เข้า Shadow Root โดยตรงผ่าน `<style>` element (3) mount/unmount React root
 * ตาม lifecycle ของ custom element (connectedCallback/disconnectedCallback)
 * — logic ของเกมทั้งหมดอยู่ใน useGameStore/useEngineStore ซึ่งเป็น
 * module-scope singleton อยู่แล้ว ดังนั้นแม้ React root จะถูก unmount/remount
 * ตอน element ถูกย้ายตำแหน่งใน DOM สถานะเกมก็ไม่หายไปไหน
 * ---------------------------------------------------------------------------
 */

import { createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import inlineStyles from './index.css?inline';
import { App } from './App';
import type { EngineBuildUrls } from './core/engine/EnginePool';

// ============================================================================
// Constants
// ============================================================================

const ELEMENT_TAG_NAME = 'chess-coach';

/**
 * URLs ของ Stockfish บน static hosting (เช่น GitHub Pages) ต้องใช้เส้นทางแบบ relative
 * เพื่อให้หน้า app ทำงานได้ทั้งตอน host ที่ root และตอน host ที่ subpath เช่น
 * /username/repo/ — สิ่งนี้สำคัญมากสำหรับการ deploy ไปยัง GitHub Pages
 */
const DEFAULT_ENGINE_BUILD_URLS: EngineBuildUrls = {
  multiThread: './engine/sf16-mt.js',
  singleThread: './engine/sf16-single.js',
};

/** ชื่อ HTML attribute ที่ผู้ฝัง widget ใช้ override ที่อยู่ไฟล์ engine ได้ (เผื่อวางไฟล์ engine ไว้คนละ path บนเว็บปลายทาง) */
const ATTR_MT_ENGINE_URL = 'mt-engine-url';
const ATTR_ST_ENGINE_URL = 'st-engine-url';

// ============================================================================
// Custom element
// ============================================================================

/**
 * `<chess-coach mt-engine-url="/custom/path/sf16-mt.js" st-engine-url="/custom/path/sf16-single.js">`
 * ทั้งสอง attribute เป็น optional — ถ้าไม่ใส่จะใช้ path เริ่มต้นตาม DEFAULT_ENGINE_BUILD_URLS
 */
class ChessCoachElement extends HTMLElement {
  private reactRoot: Root | null = null;
  private mountPoint: HTMLDivElement | null = null;

  public static get observedAttributes(): readonly string[] {
    return [ATTR_MT_ENGINE_URL, ATTR_ST_ENGINE_URL];
  }

  public connectedCallback(): void {
    // ป้องกัน mount ซ้ำถ้า connectedCallback ถูกเรียกซ้อน (เช่น browser บางตัวเรียกซ้ำตอน element ถูกย้าย DOM เร็วๆ)
    if (this.reactRoot) return;

    const shadowRoot = this.shadowRoot ?? this.attachShadow({ mode: 'open' });

    // ฉีด CSS เข้า Shadow Root โดยตรง — ต้องทำแบบนี้เพราะ <link>/<style> ปกติที่ Vite
    // inject เข้า document.head จะ "มองไม่เห็น" จาก Shadow DOM (นั่นคือจุดประสงค์ของ
    // encapsulation) ถ้าไม่มี <style> อยู่ข้างในเอง widget จะไม่มีสไตล์อะไรเลย
    if (shadowRoot.querySelector('style[data-chess-coach-styles]') === null) {
      const styleElement = document.createElement('style');
      styleElement.setAttribute('data-chess-coach-styles', '');
      styleElement.textContent = inlineStyles;
      shadowRoot.appendChild(styleElement);
    }

    let mountPoint = shadowRoot.querySelector<HTMLDivElement>('div.chess-coach-root');
    if (!mountPoint) {
      mountPoint = document.createElement('div');
      mountPoint.className = 'chess-coach-root';
      shadowRoot.appendChild(mountPoint);
    }
    this.mountPoint = mountPoint;

    this.reactRoot = createRoot(mountPoint);
    this.renderReactTree();
  }

  public disconnectedCallback(): void {
    // unmount React tree ตอน element ถูกถอดออกจาก DOM ทั้งหมด (ไม่ใช่แค่ถูกซ่อน)
    // — สถานะเกมจริงไม่ได้หายไปด้วย เพราะอยู่ใน module-scope singleton ของ useGameStore
    this.reactRoot?.unmount();
    this.reactRoot = null;
    // จงใจ "ไม่" ลบ mountPoint/style ออกจาก shadowRoot เพื่อให้ reconnectedCallback
    // (ผ่าน connectedCallback ที่ถูกเรียกซ้ำ) ใช้ DOM เดิมต่อได้เลยโดยไม่ต้องสร้างใหม่
  }

  public attributeChangedCallback(): void {
    // engine URL override เปลี่ยนหลังจาก mount ไปแล้ว — re-render ด้วย props ใหม่
    // (EnginePool เองจะยังคง instance เดิมถ้า initialize ไปแล้วครั้งหนึ่ง — การเปลี่ยน
    // attribute หลัง engine เริ่มทำงานแล้วจะมีผลก็ต่อเมื่อ engine ยังไม่เคย initialize)
    if (this.reactRoot) {
      this.renderReactTree();
    }
  }

  private getEngineBuildUrls(): EngineBuildUrls {
    return {
      multiThread: this.getAttribute(ATTR_MT_ENGINE_URL) ?? DEFAULT_ENGINE_BUILD_URLS.multiThread,
      singleThread: this.getAttribute(ATTR_ST_ENGINE_URL) ?? DEFAULT_ENGINE_BUILD_URLS.singleThread,
    };
  }

  private renderReactTree(): void {
    if (!this.reactRoot) return;

    const engineBuildUrls = this.getEngineBuildUrls();

    this.reactRoot.render(
      createElement(StrictMode, null, createElement(App, { engineBuildUrls })),
    );
  }
}

// ============================================================================
// Registration
// ============================================================================

// กัน error "already defined" ถ้า script ถูกโหลดซ้ำสองครั้งโดยไม่ตั้งใจบนเว็บปลายทาง
// (เช่น host site เผลอแปะ <script> ซ้ำ) — ถือว่า instance แรกที่ define ไปแล้วใช้ต่อได้เลย
if (customElements.get(ELEMENT_TAG_NAME) === undefined) {
  customElements.define(ELEMENT_TAG_NAME, ChessCoachElement);
}
