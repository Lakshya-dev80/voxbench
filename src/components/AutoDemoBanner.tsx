import React from 'react';
import { CheckCircle2, Play, Radio, Square, X } from 'lucide-react';

export interface AutoDemoState {
  active: boolean;
  completed: boolean;
  step: 1 | 2 | 3 | 4;
  headline: string;
  detail: string;
  progressPct: number; // 0 to 100 across the 20s guided benchmark
  elapsedSec: number;
  totalSec: number;
  finalScore: number | null;
}

interface AutoDemoBannerProps {
  demo: AutoDemoState;
  onStop: () => void;
  onReplay: () => void;
  onDismiss: () => void;
}

const STEP_LABELS = [
  '1. Weak 4G Chaos',
  '2. Full-Duplex Run',
  '3. Barge-In Collision',
  '4. QA Scorecard',
];

export const AutoDemoBanner: React.FC<AutoDemoBannerProps> = ({
  demo,
  onStop,
  onReplay,
  onDismiss,
}) => {
  if (!demo.active && !demo.completed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 inset-x-4 z-50 flex justify-center pointer-events-none"
    >
      <div className="pointer-events-auto w-full max-w-3xl rounded-2xl border border-indigo-200 dark:border-indigo-500/40 bg-white/95 dark:bg-[#11151E]/95 backdrop-blur-md shadow-xl shadow-slate-900/10 dark:shadow-black/50 overflow-hidden">
        {/* Smooth 20s Top Progress Bar */}
        <div className="h-1 w-full bg-slate-100 dark:bg-[#1E2536]">
          <div
            className={`h-full transition-all duration-200 ${
              demo.completed ? 'bg-emerald-500' : 'bg-[#4F46E5]'
            }`}
            style={{ width: `${Math.max(2, Math.min(100, demo.progressPct))}%` }}
          />
        </div>

        <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
          {/* Left: Step Badge + Plain-English Narration */}
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`mt-0.5 p-2 rounded-xl shrink-0 ${
                demo.completed
                  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
                  : 'bg-indigo-50 text-[#4F46E5] dark:bg-indigo-500/15 dark:text-indigo-400'
              }`}
            >
              {demo.completed ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Radio className="w-4 h-4 animate-pulse" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                    demo.completed
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
                      : 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30'
                  }`}
                >
                  {demo.completed
                    ? 'Live Auto-Demo Walkthrough · Complete'
                    : `Live Auto-Demo Walkthrough · Step ${demo.step}/4`}
                </span>
                <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {demo.elapsedSec}s / {demo.totalSec}s
                </span>
              </div>

              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-1 leading-snug">
                {demo.headline}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {demo.detail}
              </p>
            </div>
          </div>

          {/* Right: Stop Demo / Replay Controls */}
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
            {demo.active ? (
              <button
                type="button"
                onClick={onStop}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-300 dark:hover:bg-rose-500/25 transition-colors whitespace-nowrap"
              >
                <Square className="w-3.5 h-3.5" />
                Stop Demo
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onReplay}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-[#4F46E5] text-white hover:bg-[#4338CA] transition-colors whitespace-nowrap"
                >
                  <Play className="w-3.5 h-3.5" />
                  Replay Demo
                </button>
                <button
                  type="button"
                  onClick={onDismiss}
                  aria-label="Close walkthrough banner"
                  className="p-2 rounded-lg border border-slate-200 dark:border-[#1E2536] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-[#151B28]"
                >
                  <X className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* 4-Step Visual Progress Strip */}
        <div className="grid grid-cols-4 border-t border-slate-100 dark:border-[#1E2536] bg-slate-50/70 dark:bg-[#0D1017] text-[11px] font-medium">
          {STEP_LABELS.map((label, idx) => {
            const stepNum = (idx + 1) as 1 | 2 | 3 | 4;
            const isCurrent = demo.active && demo.step === stepNum;
            const isDone = demo.completed || demo.step > stepNum;
            return (
              <div
                key={label}
                className={`px-3 py-1.5 text-center truncate border-r last:border-r-0 border-slate-100 dark:border-[#1E2536] ${
                  isCurrent
                    ? 'text-[#4F46E5] dark:text-indigo-300 bg-indigo-50/70 dark:bg-indigo-500/15 font-semibold'
                    : isDone
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-400 dark:text-slate-500'
                }`}
              >
                {label}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
