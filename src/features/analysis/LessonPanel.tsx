/**
 * LessonPanel.tsx
 * ---------------------------------------------------------------------------
 * พาเนลแสดงคำอธิบายจากโค้ชภาษาไทย — 5 หัวข้อตามพิมพ์เขียว Phase 0
 * (เกิดอะไรขึ้น / ทำไมคุณเดินแบบนั้น / ทำไมคู่ต่อสู้เดินแบบนั้น / ควรเดินอะไร
 * แทน / หลักการที่ได้เรียนรู้) พร้อมสถานะ loading skeleton, ปุ่มโหลดสายนี้ลง
 * sandbox, และการสลับไปแสดงเนื้อหา fallback อัตโนมัติเมื่อ error/offline
 *
 * ⚠️ หมายเหตุสำคัญเรื่องขอบเขตและข้อสมมติ (อ่านก่อนเอาไปต่อสาย):
 *
 * 1. คอมโพเนนต์นี้ **ไม่ได้เรียก** `PromptBuilder.buildExplanationPrompt()`
 *    หรือ `fetch('/api/explain')` เอง — รับผลลัพธ์ทั้งหมดมาเป็น prop
 *    (`status`, `explanation`, `fallbackExplanation`) เพราะยังไม่มี hook
 *    orchestration layer (เช่น `useLesson.ts`) อยู่ในลิสต์ไฟล์ของโปรเจกต์นี้
 *    การ fetch เองในนี้จะขัด dependency rule (features ควรพึ่ง hooks/state
 *    ไม่ใช่เรียก core/pedagogy ตรงๆ) และเสี่ยงเรียก PromptBuilder.ts ผิด
 *    signature เพราะไม่เห็นเนื้อไฟล์จริงของมันในเซสชันนี้
 * 2. `ExplanationSections` เป็น type ที่ไฟล์นี้นิยามขึ้นเอง โดยตั้งชื่อ field
 *    ตาม 5 หัวข้อในพิมพ์เขียว Phase 0 ตรงๆ — **ไม่ได้ import type
 *    `ExplanationResponse` จาก `PromptBuilder.ts`** แม้ไฟล์นั้นจะมีอยู่จริง
 *    เพราะไม่เห็น field name จริงที่มันประกาศไว้ ถ้า `ExplanationResponse`
 *    ใช้ชื่อ field ต่างจากนี้ ต้อง map ระหว่างสอง type นี้ที่ชั้น hook ที่จะ
 *    สร้างขึ้นมาต่อสาย ไม่ใช่แก้ในไฟล์นี้ตรงๆ
 * 3. "สลับไปใช้ lessonTemplates อัตโนมัติเมื่อ Network Error หรือ Offline"
 *    ทำได้ 2 ทาง: (ก) ตรวจ `navigator.onLine`/event `online`/`offline` เอง
 *    ในคอมโพเนนต์นี้โดยตรง (ทำในนี้ได้จริงเพราะเป็น browser API ไม่ต้องพึ่ง
 *    fetch ของตัวเอง) และ (ข) พึ่ง `status==='error'` ที่ parent ส่งมาบอกว่า
 *    เรียก AI ไม่สำเร็จ — ไฟล์นี้ทำทั้งสองทางรวมกัน: `fallbackExplanation`
 *    เป็น prop ที่ parent คำนวณจาก `lessonTemplates.ts` ไว้ล่วงหน้าเสมอ
 *    (เป็นฟังก์ชัน rule-based ที่รันได้ทันทีโดยไม่ต้องรอ network อยู่แล้ว)
 *    แล้วคอมโพเนนต์นี้เลือกแสดง fallback แทนอัตโนมัติเมื่อ offline หรือ
 *    status เป็น error โดยไม่ต้องให้ parent ตัดสินใจเอง
 * 4. ไอคอนทั้งหมดเป็น inline SVG เขียนเอง ไม่พึ่ง icon library ภายนอก (เช่น
 *    lucide-react) เพราะไม่มีการยืนยันว่าโปรเจกต์นี้ติดตั้งแพ็กเกจไอคอนใดไว้
 * 5. ใช้ class สีของ Tailwind default palette ล้วนๆ (slate/amber/emerald)
 *    ไม่ได้อ้างอิง custom theme token ใดๆ เพราะไม่เห็น tailwind.config.js
 *    ของโปรเจกต์นี้ว่ามีการ extend สีไว้หรือไม่
 * 6. ปุ่ม "ลองเดินตานี้" เรียก `useSandboxStore` โดยสมมติว่า
 *    `actions.enterAt(gameId, ply)` มี signature ตรงตามพิมพ์เขียว Phase 0
 *    §4.2 เป๊ะ (รับแค่ gameId กับ ply ไม่มี fen parameter เพิ่ม) — ถ้า
 *    `useSandboxStore.ts` จริงของโปรเจกต์นี้ต้องการ parameter อื่นเพิ่ม
 *    ต้องปรับ handleTryThisMove() ในไฟล์นี้ให้ตรง
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState, type ReactNode, type SVGProps } from 'react';
import { useSandboxStore } from '../../state/useSandboxStore';

// ============================================================================
// Public types
// ============================================================================

export type LessonPanelStatus = 'idle' | 'loading' | 'success' | 'error';

/** ดูหมายเหตุข้อ 2 บนสุดของไฟล์ — type นี้นิยามขึ้นเองตาม 5 หัวข้อในพิมพ์เขียว ไม่ได้ import จาก PromptBuilder.ts */
export interface ExplanationSections {
  readonly whatHappened: string;
  readonly whyYouPlayedThatWay: string;
  readonly whyOpponentPlayedThatWay: string;
  readonly whatToPlayInstead: string;
  readonly principleLearned: string;
}

export interface LessonPanelProps {
  readonly status: LessonPanelStatus;
  /** มีค่าเฉพาะตอน status === 'success' */
  readonly explanation: ExplanationSections | null;
  /** ผลลัพธ์จาก lessonTemplates.ts (rule-based) — parent ควรคำนวณค่านี้ไว้เสมอโดยไม่ต้องรอ network เพราะเป็นฟังก์ชัน synchronous อยู่แล้ว */
  readonly fallbackExplanation: ExplanationSections;
  readonly errorMessage?: string | null;
  /** เกมและตาที่บทเรียนนี้อธิบายถึง — ใช้เป็น argument ให้ปุ่ม "ลองเดินสายแยกใน Sandbox" */
  readonly gameId: string;
  readonly ply: number;
  /** FEN ตำแหน่งเริ่มต้นก่อนตานี้ เพื่อเปิด Sandbox ให้ตรงกับสถานการณ์ที่เลือก */
  readonly sandboxFen?: string | null;
  /** แสดง badge สัญญาณพฤติกรรมพิเศษด้านบนเมื่อ detector trigger */
  readonly biasBadgeText?: string | null;
  /** เรียกหลังกด "ลองเดินสายแยกใน Sandbox" สำเร็จ (เช่น ให้ parent สลับ tab ไปโชว์กระดาน sandbox) — ไม่บังคับ เพราะการเข้า sandbox เองก็ทำงานสมบูรณ์โดยไม่ต้องพึ่ง callback นี้ */
  readonly onTryThisMove?: () => void;
}

// ============================================================================
// Section definitions
// ============================================================================

interface SectionDef {
  readonly key: keyof ExplanationSections;
  readonly label: string;
  readonly Icon: (props: SVGProps<SVGSVGElement>) => ReactNode;
}

function IconBase(props: SVGProps<SVGSVGElement>): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    />
  );
}

function WhatHappenedIcon(props: SVGProps<SVGSVGElement>): ReactNode {
  return (
    <IconBase {...props}>
      <circle cx="10" cy="10" r="6" />
      <line x1="14.5" y1="14.5" x2="20" y2="20" />
    </IconBase>
  );
}

function WhyYouIcon(props: SVGProps<SVGSVGElement>): ReactNode {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M6 20c0-3.5 2.7-6 6-6s6 2.5 6 6" />
    </IconBase>
  );
}

function WhyOpponentIcon(props: SVGProps<SVGSVGElement>): ReactNode {
  return (
    <IconBase {...props}>
      <path d="M4 8h9M13 8l-3-3M13 8l-3 3" />
      <path d="M20 16h-9M11 16l3-3M11 16l3 3" />
    </IconBase>
  );
}

function WhatToPlayIcon(props: SVGProps<SVGSVGElement>): ReactNode {
  return (
    <IconBase {...props}>
      <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3 11.2c.5.4.8 1 .8 1.6v.2h4.4v-.2c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3Z" />
    </IconBase>
  );
}

function PrincipleIcon(props: SVGProps<SVGSVGElement>): ReactNode {
  return (
    <IconBase {...props}>
      <path d="M6 3h12v18l-6-4-6 4V3Z" />
    </IconBase>
  );
}

const SECTION_DEFS: readonly SectionDef[] = [
  { key: 'whatHappened', label: 'เกิดอะไรขึ้น', Icon: WhatHappenedIcon },
  { key: 'whyYouPlayedThatWay', label: 'ทำไมคุณถึงเดินแบบนั้น', Icon: WhyYouIcon },
  { key: 'whyOpponentPlayedThatWay', label: 'ทำไมคู่ต่อสู้ถึงเดินแบบนั้น', Icon: WhyOpponentIcon },
  { key: 'whatToPlayInstead', label: 'ควรเดินอะไรแทน', Icon: WhatToPlayIcon },
  { key: 'principleLearned', label: 'หลักการที่ได้เรียนรู้', Icon: PrincipleIcon },
];

// ============================================================================
// Offline detection — ดูหมายเหตุข้อ 3 บนสุดของไฟล์
// ============================================================================

function useIsOffline(): boolean {
  const [offline, setOffline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? !navigator.onLine : false));

  useEffect(() => {
    const handleOnline = (): void => setOffline(false);
    const handleOffline = (): void => setOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return offline;
}

// ============================================================================
// Loading skeleton
// ============================================================================

function SkeletonSection(): ReactNode {
  return (
    <div className="flex gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-slate-700" />
      <div className="flex-1 space-y-2 py-0.5">
        <div className="h-3 w-28 animate-pulse rounded bg-slate-700" />
        <div className="h-3 w-full animate-pulse rounded bg-slate-800" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-slate-800" />
      </div>
    </div>
  );
}

// ============================================================================
// Component
// ============================================================================

export function LessonPanel({
  status,
  explanation,
  fallbackExplanation,
  errorMessage,
  gameId,
  ply,
  sandboxFen,
  biasBadgeText,
  onTryThisMove,
}: LessonPanelProps): ReactNode {
  const isOffline = useIsOffline();
  const sandboxActions = useSandboxStore((s) => s.actions);
  const sandboxState = useSandboxStore((s) => s.state);

  const usingFallback = isOffline || status === 'error';
  const sections = usingFallback ? fallbackExplanation : explanation;
  const branchDelta = sandboxState.evalDeltaVsMainline;
  const branchDeltaLabel = branchDelta === null ? '—' : `${branchDelta >= 0 ? '+' : '-'}${Math.abs(Math.round(branchDelta))} แต้ม`;

  const handleTryThisMove = (): void => {
    const fen = sandboxFen ?? useSandboxStore.getState().state.fen;
    if (!fen) return;
    sandboxActions.enterAt(gameId, ply, fen);
    onTryThisMove?.();
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-100">คำอธิบายจากโค้ช</h2>
        <button
          type="button"
          onClick={handleTryThisMove}
          disabled={status === 'loading' || !sandboxFen}
          className="shrink-0 rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-slate-900 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ลองเดินสายแยกใน Sandbox
        </button>
      </div>

      {biasBadgeText && (
        <div className="rounded-md border border-violet-700/60 bg-violet-950/50 px-3 py-2 text-xs font-semibold text-violet-200">
          {biasBadgeText}
        </div>
      )}

      {usingFallback && (
        <div className="rounded-md border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
          {isOffline
            ? 'กำลังแสดงคำอธิบายแบบสำรอง (ไม่มีการเชื่อมต่ออินเทอร์เน็ต)'
            : `กำลังแสดงคำอธิบายแบบสำรอง เนื่องจากเรียก AI ไม่สำเร็จ${errorMessage ? `: ${errorMessage}` : ''}`}
        </div>
      )}

      {sandboxState.active && (
        <div className="rounded-lg border border-blue-700/50 bg-blue-950/40 p-3 text-sm text-slate-200">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-semibold text-blue-100">กำลังจำลองสายแยก (What-If Simulation)</span>
            {sandboxState.isEngineThinking && <span className="text-xs text-amber-200">🤖 คอมกำลังแก้ลำ…</span>}
          </div>
          <div className="grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
            <div className="rounded border border-slate-700 bg-slate-900/50 p-2">
              <div className="text-slate-400">Eval สายนี้</div>
              <div className="mt-1 text-sm font-semibold text-slate-100">
                {sandboxState.branchEval
                  ? `${sandboxState.branchEval.value >= 0 ? '+' : '-'}${Math.abs(sandboxState.branchEval.value)} ${sandboxState.branchEval.type === 'mate' ? 'mate' : 'cp'}`
                  : 'รอผลวิเคราะห์'}
              </div>
            </div>
            <div className="rounded border border-slate-700 bg-slate-900/50 p-2">
              <div className="text-slate-400">เทียบกับตาจริง</div>
              <div className="mt-1 text-sm font-semibold text-slate-100">{branchDeltaLabel}</div>
            </div>
          </div>
          {sandboxState.branchExplanation && (
            <p className="mt-2 text-sm leading-relaxed text-slate-200">{sandboxState.branchExplanation}</p>
          )}
        </div>
      )}

      {status === 'loading' && !usingFallback ? (
        <div className="space-y-3">
          {SECTION_DEFS.map((def) => (
            <SkeletonSection key={def.key} />
          ))}
        </div>
      ) : status === 'idle' && !usingFallback ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">เลือกตาที่ต้องการให้โค้ชอธิบาย</div>
      ) : sections ? (
        <div className="space-y-3">
          {SECTION_DEFS.map((def) => (
            <section key={def.key} className="flex gap-3 rounded-lg border border-slate-800 bg-slate-800/40 p-3">
              <def.Icon className="h-6 w-6 shrink-0 text-amber-400" />
              <div>
                <h3 className="text-sm font-semibold text-slate-200">{def.label}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-300">{sections[def.key]}</p>
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
