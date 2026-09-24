import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Square } from 'chess.js';
import { ArrowLayer } from './ArrowLayer';
import { EvalChart } from './EvalChart';
import { MoveList } from './MoveList';
import { AnalysisControls } from './AnalysisControls';
import { LessonPanel, type ExplanationSections } from './LessonPanel';
import SandboxBoard from './SandboxBoard';
import type { AnalyzedMove, BoardArrow } from './types';
import { detectCognitiveBiases } from '../../core/analysis/CognitiveBiasDetector';
import { buildCognitiveBiasExplanation, buildFallbackExplanation, detectRootCause } from '../../core/pedagogy/lessonTemplates';
import type { ExplanationResponse } from '../../core/pedagogy/PromptBuilder';
import { db } from '../../data/db';
import { useAnalysisStore, useAnalysisActions } from '../../state/useAnalysisStore';
import { useSandboxStore, useSandboxActions } from '../../state/useSandboxStore';
import type { MoveLogRecord } from '../../shared/types/schema';

export interface AnalysisScreenProps {
  readonly gameId: string;
}

type AnalysisTab = 'eval' | 'moves' | 'accuracy';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function splitUci(uci: string): readonly [Square, Square] {
  return [uci.slice(0, 2) as Square, uci.slice(2, 4) as Square];
}

function buildArrowsForMove(move: AnalyzedMove | null): readonly BoardArrow[] {
  if (!move) return [];
  const arrows: BoardArrow[] = [];

  if (move.bestMoveUci) {
    const [from, to] = splitUci(move.bestMoveUci);
    arrows.push({ id: 'best', from, to, kind: 'best' });
  }

  if (move.classification === 'mistake' || move.classification === 'blunder') {
    const [from, to] = splitUci(move.uci);
    arrows.push({
      id: 'played',
      from,
      to,
      kind: move.classification === 'blunder' ? 'played-blunder' : 'played-mistake',
    });
  }

  return arrows;
}

function toLessonSections(response: ExplanationResponse | null): ExplanationSections | null {
  if (!response) return null;
  return {
    whatHappened: response.whatHappened,
    whyYouPlayedThatWay: response.whyYouPlayedThatMove,
    whyOpponentPlayedThatWay: response.whyOpponentPlayedThatMove,
    whatToPlayInstead: response.correctMove,
    principleLearned: response.lessonPrinciple,
  };
}

function getBiasLabelTh(primaryBias: string | null): string {
  switch (primaryBias) {
    case 'SPATIAL_TUNNELING':
      return 'ภาวะมองแคบเฉพาะหน้า (Spatial Tunneling)';
    case 'REACTIVE_BAND_AID':
      return 'การแก้ปัญหาเฉพาะหน้าแบบดับเพลิง';
    case 'PANIC_INSTA_MOVE':
      return 'การเดินสวนทันทีเพราะตกใจ';
    case 'TIME_ASYMMETRY_COLLAPSE':
      return 'ภาวะใช้เวลาและสติหลุดร่วงลงพร้อมกัน';
    case 'TARGET_BLINDNESS':
      return 'ภาวะตาบอดต่อเป้าหมายใหญ่';
    default:
      return 'พฤติกรรมผิดปกติ';
  }
}

export function AnalysisScreen({ gameId }: AnalysisScreenProps): JSX.Element {
  const analysisStatus = useAnalysisStore((s) => s.state.status);
  const analysisProgress = useAnalysisStore((s) => s.state.progress);
  const analyzedMoves = useAnalysisStore((s) => s.state.moves);
  const accuracy = useAnalysisStore((s) => s.state.accuracy);
  const analysisActions = useAnalysisActions();

  const sandboxActive = useSandboxStore((s) => s.state.active);
  const sandboxState = useSandboxStore((s) => s.state);
  const sandboxActions = useSandboxActions();

  const [activeTab, setActiveTab] = useState<AnalysisTab>('eval');
  const [selectedPly, setSelectedPly] = useState<number | null>(null);
  const [sandboxMode, setSandboxMode] = useState(false);
  const [lessonState, setLessonState] = useState<{
    status: 'idle' | 'loading' | 'success' | 'error';
    explanation: ExplanationSections | null;
    fallbackExplanation: ExplanationSections | null;
    biasBadgeText: string | null;
  }>({
    status: 'idle',
    explanation: null,
    fallbackExplanation: null,
    biasBadgeText: null,
  });

  // เริ่มวิเคราะห์เกมทันที
  useEffect(() => {
    if (analysisStatus === 'idle') {
      void analysisActions.startAnalysis(gameId);
    }
  }, [gameId, analysisStatus, analysisActions]);

  useEffect(() => {
    return () => {
      sandboxActions.exit();
      analysisActions.cancelAnalysis();
    };
  }, [analysisActions, sandboxActions]);

  // ซิงค์ตำแหน่งหมากบนกระดานให้ตรงกับตาที่เลือก
  const syncBoard = useCallback(
    (ply: number | null) => {
      if (ply === null || ply <= 0) {
        sandboxActions.enterAt(gameId, 0, STARTING_FEN);
        return;
      }
      const move = analyzedMoves.find((candidate) => candidate.ply === ply);
      if (move) {
        sandboxActions.enterAt(gameId, ply, move.fenAfter);
      }
    },
    [analyzedMoves, gameId, sandboxActions],
  );

  useEffect(() => {
    if (selectedPly === null && analyzedMoves.length > 0) {
      const firstPly = analyzedMoves[0].ply;
      setSelectedPly(firstPly);
      syncBoard(firstPly);
    }
  }, [analyzedMoves, selectedPly, syncBoard]);

  // ฟังก์ชันเวลากดเปลี่ยนตาเดิน (จากปุ่ม หรือจาก Auto-Play)
  const handleSelectPly = useCallback(
    (ply: number) => {
      setSelectedPly(ply);
      syncBoard(ply);
    },
    [syncBoard],
  );

  const toggleSandboxMode = useCallback(() => {
    setSandboxMode((prev) => {
      const next = !prev;
      if (next && selectedPly !== null) {
        const move = analyzedMoves.find((candidate) => candidate.ply === selectedPly);
        if (move) sandboxActions.enterAt(gameId, selectedPly, move.fenBefore);
      } else {
        syncBoard(selectedPly);
      }
      return next;
    });
  }, [selectedPly, analyzedMoves, gameId, sandboxActions, syncBoard]);

  const handleResetBranch = useCallback(() => {
    sandboxActions.resetBranch();
  }, [sandboxActions]);

  const selectedMove = useMemo(
    () => analyzedMoves.find((m) => m.ply === selectedPly) ?? null,
    [analyzedMoves, selectedPly],
  );
  const arrows = useMemo(() => buildArrowsForMove(selectedMove), [selectedMove]);

  useEffect(() => {
    if (!gameId || selectedPly === null) {
      setLessonState({ status: 'idle', explanation: null, fallbackExplanation: null, biasBadgeText: null });
      return;
    }

    let cancelled = false;
    setLessonState((prev) => ({ ...prev, status: 'loading' }));

    void db.moveLogs
      .where('gameId')
      .equals(gameId)
      .sortBy('ply')
      .then((moveLogs: MoveLogRecord[]) => {
        if (cancelled) return;

        const diagnosis = detectCognitiveBiases(moveLogs, selectedPly);
        const biasBadgeText = diagnosis.isTriggered && diagnosis.primaryBias
          ? `🧠 สัญญาณ: ${getBiasLabelTh(diagnosis.primaryBias)}`
          : null;

        const selectedLog = moveLogs.find((log) => log.ply === selectedPly) ?? null;
        const selectedMove = analyzedMoves.find((move) => move.ply === selectedPly) ?? null;

        const rootCauseSignals = {
          wasPawnCapture: false,
          openedOpponentLines: false,
          kingNeverCastled: false,
          backRankOpen: false,
          clockPressureRatio: selectedLog?.timing.timePressureRatio ?? 0,
          hungPieceValue: null,
          missedForkOrPin:
            selectedMove?.classification === 'mistake' || selectedMove?.classification === 'blunder' || selectedLog?.engine?.classification === 'mistake' || selectedLog?.engine?.classification === 'blunder',
        };

        const fallbackResponse = selectedLog || selectedMove
          ? buildFallbackExplanation(detectRootCause(rootCauseSignals), {
              sanPlayed: selectedLog?.position.san ?? selectedMove?.san ?? 'ตานี้',
              bestMoveSan: selectedLog?.engine?.bestMove ?? selectedMove?.bestMoveUci ?? selectedLog?.position.san ?? selectedMove?.san ?? 'ตานี้',
              centipawnLoss: selectedLog?.engine?.centipawnLoss ?? selectedMove?.centipawnLoss ?? 0,
              winProbDrop: Math.max(
                0,
                (selectedLog?.engine?.winProbBefore ?? 0.5) - (selectedLog?.engine?.winProbAfter ?? 0.5),
              ),
              panicScore: selectedLog?.psych.panicScore ?? 0,
              thinkTimeMs: selectedLog?.timing.thinkTimeMs ?? 1000,
              averageThinkTimeMs: Math.max(selectedLog?.timing.thinkTimeMs ?? 1000, 1000),
              clockRemainingMs: selectedLog?.timing.clockRemainingMs ?? 0,
              openingName: selectedLog?.context.openingName ?? null,
              hungPieceValue: undefined,
            })
          : null;

        const biasResponse = diagnosis.isTriggered ? buildCognitiveBiasExplanation(diagnosis) : null;
        const explanationResponse = biasResponse ?? fallbackResponse;

        setLessonState({
          status: 'success',
          explanation: toLessonSections(explanationResponse),
          fallbackExplanation: toLessonSections(fallbackResponse ?? biasResponse ?? explanationResponse),
          biasBadgeText,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setLessonState({
            status: 'error',
            explanation: null,
            fallbackExplanation: {
              whatHappened: 'ไม่สามารถโหลดคำอธิบายได้ในขณะนี้',
              whyYouPlayedThatWay: 'ระบบยังไม่สามารถประมวลผลบทเรียนสำหรับตานี้ได้ชั่วคราว',
              whyOpponentPlayedThatWay: 'กรุณาเลือกตาเดินอีกรอบหนึ่ง',
              whatToPlayInstead: 'ลองย้ายกลับไปดูตาเดินก่อนหน้าและวิเคราะห์ใหม่อีกครั้ง',
              principleLearned: 'ให้ใส่ใจเรื่องเวลาและสภาพจิตใจก่อนตัดสินใจเดิน',
            },
            biasBadgeText: null,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [gameId, selectedPly]);

  const boardWrapperRef = useRef<HTMLDivElement>(null);
  const [boardWidthPx, setBoardWidthPx] = useState(480);

  useEffect(() => {
    const el = boardWrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setBoardWidthPx(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const isAnalyzing = analysisStatus === 'analyzing';

  return (
    <div className="grid h-full grid-cols-1 gap-4 p-4 lg:grid-cols-2">
      {/* ฝั่งซ้าย: กระดาน + เครื่องเล่น YouTube Replay */}
      <div className="flex flex-col gap-3">
        <div ref={boardWrapperRef} className="relative mx-auto w-full max-w-[560px]">
          <SandboxBoard width={boardWidthPx} />
          <ArrowLayer arrows={arrows} boardWidthPx={boardWidthPx} orientation="white" />
        </div>

        {sandboxMode && (
          <div className="mx-auto w-full max-w-[560px] rounded-lg border border-blue-700/50 bg-blue-950/40 p-3 text-sm text-slate-200">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-semibold text-blue-100">กำลังจำลองสายแยก (What-If Simulation)</span>
              {sandboxState.isEngineThinking && <span className="text-xs text-amber-200">🤖 คอมกำลังแก้ลำ…</span>}
            </div>
            {sandboxState.branchEval && sandboxState.evalDeltaVsMainline !== null && (
              <div className="text-xs text-slate-300">
                Eval: {sandboxState.branchEval.value >= 0 ? '+' : '-'}
                {Math.abs(Math.round(sandboxState.branchEval.value))} {sandboxState.branchEval.type === 'mate' ? 'mate' : 'cp'}
                {' • '}
                {sandboxState.evalDeltaVsMainline >= 0 ? 'ดีกว่าตาจริง' : 'แย่กว่าตาจริง'}
                {' '}
                {Math.abs(Math.round(sandboxState.evalDeltaVsMainline))} แต้ม
              </div>
            )}
            {sandboxState.branchExplanation && (
              <p className="mt-2 text-sm leading-relaxed text-slate-200">{sandboxState.branchExplanation}</p>
            )}
          </div>
        )}

        <div className="mx-auto flex w-full max-w-[560px] items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleSandboxMode}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                sandboxMode
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {sandboxMode ? 'ปิด Sandbox' : 'ลองเดินสายอื่น'}
            </button>
            {sandboxMode && (
              <button
                type="button"
                onClick={handleResetBranch}
                className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700"
              >
                ย้อนกลับไปจุดเริ่มต้นลองใหม่
              </button>
            )}
          </div>
          {selectedMove && (
            <span className="text-sm font-medium text-gray-600">
              ตาที่ {selectedMove.ply}: {selectedMove.san}
            </span>
          )}
        </div>

        {/* 🎬 แถบเครื่องเล่น YouTube Replay ตัวใหม่ (แทนที่แถบสีขาวเดิม 100%) */}
        <AnalysisControls
          moves={analyzedMoves}
          currentPly={selectedPly}
          onSelectPly={handleSelectPly}
        />

        {isAnalyzing && (
          <div className="mx-auto w-full max-w-[560px]">
            <div className="mb-1 flex justify-between text-xs text-gray-500">
              <span>กำลังวิเคราะห์เกม…</span>
              <span>
                {analysisProgress.done}/{analysisProgress.total}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-300"
                style={{
                  width: `${analysisProgress.total > 0 ? (analysisProgress.done / analysisProgress.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ฝั่งขวา: Tabs */}
      <div className="flex flex-col overflow-hidden rounded-lg border border-gray-200">
        <div className="flex border-b border-gray-200 text-sm">
          {(
            [
              { key: 'eval', label: 'กราฟ Eval' },
              { key: 'moves', label: 'รายการตาเดิน' },
              { key: 'accuracy', label: 'ความแม่นยำ' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 px-3 py-2 font-medium transition-colors ${
                activeTab === tab.key
                  ? 'border-b-2 border-blue-600 text-blue-700'
                  : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {activeTab === 'eval' && (
            <EvalChart moves={analyzedMoves} currentPly={selectedPly ?? undefined} onSelectPly={handleSelectPly} />
          )}

          {activeTab === 'moves' && (
            <MoveList moves={analyzedMoves} currentPly={selectedPly ?? undefined} onSelectPly={handleSelectPly} />
          )}

          {activeTab === 'accuracy' && (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="ความแม่นยำ" value={accuracy ? `${accuracy.playerAccuracyPct.toFixed(1)}%` : '—'} />
              <StatCard label="Avg. Centipawn Loss" value={accuracy ? `${accuracy.avgCentipawnLoss.toFixed(0)}` : '—'} />
              {accuracy &&
                (Object.entries(accuracy.counts) as [string, number][])
                  .filter(([, count]) => count > 0)
                  .map(([classification, count]) => (
                    <StatCard key={classification} label={classification} value={String(count)} small />
                  ))}
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 bg-slate-900/30 p-3">
          <LessonPanel
            status={lessonState.status}
            explanation={lessonState.explanation}
            fallbackExplanation={lessonState.fallbackExplanation ?? {
              whatHappened: 'ไม่พบคำอธิบายพื้นฐานสำหรับตานี้',
              whyYouPlayedThatWay: 'กรุณาเลือกตาเดินอีกครั้ง',
              whyOpponentPlayedThatWay: 'ยังไม่มีข้อมูลที่เพียงพอ',
              whatToPlayInstead: 'ให้รีเฟรชหรือเลือกตาเดินอื่น',
              principleLearned: 'สร้างสติสัมปชัญญะก่อนตัดสินใจ',
            }}
            gameId={gameId}
            ply={selectedPly ?? 0}
            sandboxFen={selectedMove?.fenBefore ?? null}
            biasBadgeText={lessonState.biasBadgeText}
            onTryThisMove={() => setSandboxMode(true)}
          />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, small = false }: { readonly label: string; readonly value: string; readonly small?: boolean }): JSX.Element {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className={small ? 'text-base font-semibold text-gray-700' : 'text-xl font-bold text-gray-800'}>{value}</div>
    </div>
  );
}

export default AnalysisScreen;