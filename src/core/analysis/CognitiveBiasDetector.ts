/**
 * src/core/analysis/CognitiveBiasDetector.ts
 * ---------------------------------------------------------------------------
 * โมดูลตรวจจับ Cognitive Bias / Amygdala Hijack / Tunnel Vision ในเกมหมากรุก
 * โดยวิเคราะห์จาก Pure Telemetry Data (เวลาคิด, พฤติกรรมเมาส์, พื้นที่บนกระดาน)
 *
 * Pure TypeScript 100% — ห้าม import React, DOM, Zustand หรือ Dexie
 *
 * ดัชนีที่ตรวจจับ:
 * 1. Time Spike & Panic Insta-move (เวลาแกว่งสุดขั้ว หรือรีบสะดุ้งเดินสวน)
 * 2. Spatial Tunneling (สายตาและเมาส์จดจ่ออยู่ปีกเดียว > 80%)
 * 3. Reactive Band-aid (การผลักเบี้ยไล่แก้ขัด สร้างจุดอ่อนถาวร)
 * 4. Time Asymmetry Collapse (ค้างนานจัด แล้วเดินรัวจนพัง)
 *
 * Entry point ตามสัญญา: `detectCognitiveBiases(moveLogs, currentPly)`
 * ---------------------------------------------------------------------------
 */

import type { MoveLogRecord } from '../../shared/types/schema';

// ============================================================================
// Types (EXACT CONTRACTS ตามที่กำหนด)
// ============================================================================

export type CognitiveBiasType =
  | 'SPATIAL_TUNNELING'       // จ้องอยู่ปีกเดียว ลืมมองอีกฝั่ง
  | 'REACTIVE_BAND_AID'       // แก้ปัญหาเฉพาะหน้าแบบดับเพลิง
  | 'PANIC_INSTA_MOVE'        // สติหลุดรีบเดินสวนทันที < 1.5s
  | 'TIME_ASYMMETRY_COLLAPSE' // นั่งค้างนานจัด แล้วเดินรัวจนพัง
  | 'TARGET_BLINDNESS';       // จ้องกินหมากตัวเดียวจนโดนรุกฆาต

export interface CognitiveDiagnosis {
  readonly isTriggered: boolean;
  readonly primaryBias: CognitiveBiasType | null;
  readonly tunnelVisionIndex: number; // 0 - 100
  readonly spatialFocusRatio: number; // สัดส่วนการจดจ่อปีกเดียว (0.5 - 1.0)
  readonly focusFlank: 'kingside' | 'queenside' | 'center' | null;
  readonly behavioralEvidence: readonly string[]; // เช่น "เวลาคิด 1.1s หลังโดนรุก", "คลิกยกเลิก 4 ครั้ง"
  readonly systemicLesson: {
    readonly problemPattern: string;    // สิ่งที่ผู้เล่นมองเห็น (ปัญหาเฉพาะหน้า)
    readonly overlookedReality: string;  // สิ่งที่กระดานเป็นจริง (ภาพรวมที่มองข้าม)
    readonly flowPrinciple: string;      // หลักการคิดการไหลเพื่อไม่ให้เกิดซ้ำ
  } | null;
}

// ============================================================================
// Helpers
// ============================================================================

function getFlank(square: string): 'queenside' | 'center' | 'kingside' {
  const file = square.charAt(0).toLowerCase();
  if (file === 'a' || file === 'b' || file === 'c') return 'queenside';
  if (file === 'd' || file === 'e') return 'center';
  return 'kingside'; // f, g, h
}

function isReactivePawnPush(uci: string): boolean {
  // ตรวจการผลักเบี้ยแก้ขัดริมกระดาน เช่น h3, h6, a3, a6, f3, f6
  const reactivePawnMoves = new Set([
    'h2h3', 'h7h6', 'a2a3', 'a7a6',
    'f2f3', 'f7f6', 'c2c3', 'c7c6',
  ]);
  return reactivePawnMoves.has(uci);
}

function emptyDiagnosis(): CognitiveDiagnosis {
  return {
    isTriggered: false,
    primaryBias: null,
    tunnelVisionIndex: 0,
    spatialFocusRatio: 0.5,
    focusFlank: null,
    behavioralEvidence: [],
    systemicLesson: null,
  };
}

// ============================================================================
// Core Detector — public entry point ตามสัญญา
// ============================================================================

/**
 * ตรวจจับความเอนเอียงทางความคิด (Tunnel Vision / Amygdala Hijack) ในตาเดินปัจจุบัน
 * โดยอิงจาก telemetry ล้วน (ไม่แตะ engine eval โดยตรง ยกเว้นใช้ classification
 * ที่คำนวณมาแล้วเป็น trigger ร่วม)
 */
export function detectCognitiveBiases(
  moveLogs: readonly MoveLogRecord[],
  currentPly: number,
): CognitiveDiagnosis {
  const currentIndex = moveLogs.findIndex((m) => m.ply === currentPly);
  if (currentIndex < 0) {
    return emptyDiagnosis();
  }

  const currentMove = moveLogs[currentIndex];
  if (!currentMove || currentMove.actor !== 'human') {
    return emptyDiagnosis();
  }

  const previousMove = currentIndex > 0 ? moveLogs[currentIndex - 1] : null;
  const evidence: string[] = [];
  let tunnelScore = 0;

  const thinkTimeMs = currentMove.timing.thinkTimeMs;
  const panicScore = currentMove.psych.panicScore;
  const isBlunderOrMistake =
    currentMove.engine?.classification === 'blunder' ||
    currentMove.engine?.classification === 'mistake';

  // ------------------------------------------------------------------------
  // 1. ตรวจจับ Panic Insta-move (< 1.5 วินาที หลังโดนรุก/โดนกิน)
  // ------------------------------------------------------------------------
  const isUnderAttack = previousMove?.position.isCheck || Boolean(previousMove?.position.captured);
  if (thinkTimeMs > 0 && thinkTimeMs < 1500 && isUnderAttack) {
    tunnelScore += 40;
    evidence.push(`เดินสวนกลับทันทีในเวลาเพียง ${(thinkTimeMs / 1000).toFixed(1)}s หลังถูกโจมตี (Amygdala Hijack)`);
    if (isBlunderOrMistake) {
      return {
        isTriggered: true,
        primaryBias: 'PANIC_INSTA_MOVE',
        tunnelVisionIndex: Math.min(100, tunnelScore + 30),
        spatialFocusRatio: 0.5,
        focusFlank: null,
        behavioralEvidence: evidence,
        systemicLesson: {
          problemPattern: 'รู้สึกตกใจและต้องการกำจัดความกดดันตรงหน้าออกไปให้เร็วที่สุด',
          overlookedReality: 'การเดินสวนทันทีโดยไม่ประเมินรอบกระดาน มักเปิดช่องให้คู่ต่อสู้ลงโทษหนักกว่าเดิม',
          flowPrinciple: 'เมื่อถูกรุกหรือถูกกิน ให้หายใจลึกๆ 2 วินาทีเสมอ การไม่มีเวลากดดันทางกายภาพแปลว่าคุณมีสิทธิ์หยุดคิด',
        },
      };
    }
  }

  // ------------------------------------------------------------------------
  // 2. ตรวจจับ Spatial Tunneling (หมกมุ่นอยู่ปีกเดียว)
  // ------------------------------------------------------------------------
  let kingsideHover = 0;
  let queensideHover = 0;
  let totalHoverMs = 0;

  for (const [sq, duration] of Object.entries(currentMove.behavior.hoverHeatmap)) {
    totalHoverMs += duration;
    const flank = getFlank(sq);
    if (flank === 'kingside') kingsideHover += duration;
    if (flank === 'queenside') queensideHover += duration;
  }

  let dominantFlank: 'kingside' | 'queenside' | null = null;
  let focusRatio = 0.5;

  if (totalHoverMs > 1000) {
    if (kingsideHover / totalHoverMs >= 0.8) {
      dominantFlank = 'kingside';
      focusRatio = kingsideHover / totalHoverMs;
    } else if (queensideHover / totalHoverMs >= 0.8) {
      dominantFlank = 'queenside';
      focusRatio = queensideHover / totalHoverMs;
    }
  }

  if (dominantFlank && isBlunderOrMistake) {
    tunnelScore += 35;
    evidence.push(`สายตาและเมาส์จดจ่ออยู่เฉพาะฝั่ง ${dominantFlank} ถึง ${(focusRatio * 100).toFixed(0)}%`);
    return {
      isTriggered: true,
      primaryBias: 'SPATIAL_TUNNELING',
      tunnelVisionIndex: Math.min(100, tunnelScore + 30),
      spatialFocusRatio: focusRatio,
      focusFlank: dominantFlank,
      behavioralEvidence: evidence,
      systemicLesson: {
        problemPattern: `จดจ่อแก้ปัญหาหรือหาทางบุกอยู่เฉพาะปีก ${dominantFlank}`,
        overlookedReality: 'หมากรุกเชื่อมโยงกันทั้งกระดาน การจ้องมองแค่จุดเดียวทำให้ตาบอดต่อภัยคุกคามในอีกปีกหนึ่ง',
        flowPrinciple: 'ก่อนตัดสินใจเดินหมาก ให้กวาดสายตามองมุมกระดานทั้ง 4 ทิศ เพื่อตรวจดูภัยคุกคามระยะไกลของ เรือ และ บิชอป เสมอ',
      },
    };
  }

  // ------------------------------------------------------------------------
  // 3. ตรวจจับ Reactive Band-aid (การผลักเบี้ยไล่แก้ขัด)
  // ------------------------------------------------------------------------
  const isPawnKneeJerk = isReactivePawnPush(currentMove.position.uci);
  if (isPawnKneeJerk && isBlunderOrMistake) {
    tunnelScore += 35;
    evidence.push(`ผลักเบี้ย ${currentMove.position.san} เพื่อไล่ตัวขู่เฉพาะหน้า แต่ทำให้โครงสร้างหมากอ่อนแอลง`);
    return {
      isTriggered: true,
      primaryBias: 'REACTIVE_BAND_AID',
      tunnelVisionIndex: Math.min(100, tunnelScore + 25),
      spatialFocusRatio: 0.6,
      focusFlank: getFlank(currentMove.position.uci.slice(2, 4)),
      behavioralEvidence: evidence,
      systemicLesson: {
        problemPattern: 'พยายามดับเพลิงตรงหน้าโดยการไล่ตัวบุกของคู่ต่อสู้ทันที',
        overlookedReality: 'เบี้ยเดินหน้าแล้วถอยหลังไม่ได้ การผลักเบี้ยแก้ขัดจะทิ้งช่องอ่อนแอถาวรที่คู่ต่อสู้จะกลับมาเจาะได้ตลอดเกม',
        flowPrinciple: 'คิดแบบ Prophylaxis: วางหมากให้ประสานงากันเพื่อไม่ให้คู่ต่อสู้กระโดดเข้ามาได้ตั้งแต่แรก แทนการผลักเบี้ยไล่ตามหลัง',
      },
    };
  }

  // ------------------------------------------------------------------------
  // 4. ตรวจจับ Time Asymmetry Collapse (ค้างนานจัด แล้วลน)
  // ------------------------------------------------------------------------
  if (currentMove.timing.deviationFromPersonalAvg > 2.0 && panicScore > 65) {
    tunnelScore += 30;
    evidence.push(`ใช้เวลาคิดนานกว่าค่าเฉลี่ยมากผิดปกติร่วมกับระดับ Panic พุ่งสูง (${panicScore})`);
    if (isBlunderOrMistake) {
      return {
        isTriggered: true,
        primaryBias: 'TIME_ASYMMETRY_COLLAPSE',
        tunnelVisionIndex: Math.min(100, tunnelScore + 20),
        spatialFocusRatio: 0.5,
        focusFlank: null,
        behavioralEvidence: evidence,
        systemicLesson: {
          problemPattern: 'คิดวนเวียนอยู่กับจุดที่ตัดสินใจไม่ได้จนเวลาหมด แล้วจบด้วยการเดินแบบรีบร้อน',
          overlookedReality: 'การใช้เวลามากเกินไปในตาเดียวทำลายการจัดการเวลาของทั้งเกมที่เหลือ',
          flowPrinciple: 'หากคิดเกิน 30 วินาทีแล้วยังหาตาเดินที่สมบูรณ์แบบไม่ได้ ให้เลือกตาเดินที่ปลอดภัยที่สุดแล้วส่งต่อตาเดินทันที',
        },
      };
    }
  }

  return emptyDiagnosis();
}