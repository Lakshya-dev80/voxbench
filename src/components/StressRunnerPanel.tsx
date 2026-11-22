import React, { useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  Play,
  Save,
  XCircle,
} from 'lucide-react';
import {
  CallExecutionResult,
  DspProcessingResult,
  ExecutionMode,
  LiveEndpointConfig,
  Scenario,
  SuiteRunSnapshot,
} from '../types';
import { LiveAudioController } from '../engine/dspEngine';
import { CallWaterfall } from './CallWaterfall';
import { LiveTargetPanel } from './LiveTargetPanel';

interface StressRunnerPanelProps {
  scenarios: Scenario[];
  activeScenario: Scenario;
  onSelectScenario: (id: string) => void;
  executionMode: ExecutionMode;
  onExecutionModeChange: (mode: ExecutionMode) => void;
  armedFaultsCount: number;
  onOpenBugsTab: () => void;
  liveConfig: LiveEndpointConfig;
  onLiveConfigChange: (next: LiveEndpointConfig) => void;
  onLiveResult: (res: CallExecutionResult) => void;
  currentRun: SuiteRunSnapshot | null;
  selectedCall: CallExecutionResult | null;
  onSelectCall: (call: CallExecutionResult) => void;
  dspResult: DspProcessingResult | null;
  audioController: LiveAudioController;
  isRunning: boolean;
  progressDone: number;
  progressTotal: number;
  concurrency: 1 | 5 | 10 | 25;
  onConcurrencyChange: (c: 1 | 5 | 10 | 25) => void;
  onRunSingleScenario: () => void;
  onRunParallelSuite: (concurrency: 1 | 5 | 10 | 25) => void;
  onQuickSaveSnapshot: () => void;
  onExportReport?: () => void;
  qaScore?: number | null;
  highlightWaterfall?: boolean;
  highlightScorecard?: boolean;
}

export const StressRunnerPanel: React.FC<StressRunnerPanelProps> = ({
  scenarios,
  activeScenario,
  onSelectScenario,
  executionMode,
  onExecutionModeChange,
  armedFaultsCount,
  onOpenBugsTab,
  liveConfig,
  onLiveConfigChange,
  onLiveResult,
  currentRun,
  selectedCall,
  onSelectCall,
  dspResult,
  audioController,
  isRunning,
  progressDone,
  progressTotal,
  concurrency,
  onConcurrencyChange,
  onRunSingleScenario,
  onRunParallelSuite,
  onQuickSaveSnapshot,
  onExportReport,
  qaScore = null,
  highlightWaterfall = false,
  highlightScorecard = false,
}) => {
  const histogram = useMemo(() => {
    const calls = currentRun?.calls ?? [];
    if (calls.length === 0) return { buckets: [], maxCount: 1, minMs: 0, maxMs: 2000 };
    const latencies = calls.map((c) => c.metrics.ttfbMs);
    const minVal = Math.min(200, ...latencies);
    const maxVal = Math.max(1200, ...latencies) + 100;
    const binCount = 12;
    const step = Math.max(50, Math.ceil((maxVal - minVal) / binCount));
    const buckets = Array.from({ length: binCount }, (_, idx) => {
      const lo = Math.floor(minVal / 50) * 50 + idx * step;
      const hi = lo + step;
      const inBin = calls.filter(
        (c) => c.metrics.ttfbMs >= lo && (idx === binCount - 1 ? c.metrics.ttfbMs <= hi : c.metrics.ttfbMs < hi)
      );
      return {
        lo,
        hi,
        count: inBin.length,
        failedCount: inBin.filter((c) => c.status === 'failed').length,
      };
    });
    const maxCount = Math.max(1, ...buckets.map((b) => b.count));
    return { buckets, maxCount, minMs: buckets[0].lo, maxMs: buckets[buckets.length - 1].hi };
  }, [currentRun]);

  const progressPct = progressTotal > 0 ? Math.round((progressDone / progressTotal) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Executive Workspace Header & Prominent Primary Runner Controls */}
      <section className="rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                Stress Test Runner
              </h1>
              {executionMode === 'sandbox' && armedFaultsCount > 0 && (
                <button
                  type="button"
                  onClick={onOpenBugsTab}
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30 transition-colors"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {armedFaultsCount} Simulated Bug{armedFaultsCount === 1 ? '' : 's'} Active
                </button>
              )}
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Run concurrent virtual callers against your voice agent to measure response latency, barge-in handling, and policy compliance.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={!currentRun || isRunning}
              onClick={onQuickSaveSnapshot}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#151B28] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:border-indigo-500/50 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              Save Snapshot
            </button>

            <button
              type="button"
              disabled={isRunning}
              onClick={onRunSingleScenario}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#151B28] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:border-indigo-500/50 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              Run Single Scenario
            </button>

            <button
              type="button"
              disabled={isRunning}
              onClick={() => onRunParallelSuite(concurrency)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold bg-[#4F46E5] text-white hover:bg-[#4338CA] disabled:opacity-60 shadow-sm transition-colors whitespace-nowrap"
            >
              {isRunning ? (
                <Activity className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              {isRunning
                ? `Running ${progressDone}/${progressTotal}...`
                : `Run Test Suite (${concurrency === 1 ? '6 Scenarios' : `${concurrency}x Callers`})`}
            </button>
          </div>
        </div>

        {/* Calm Control Toolbar: Target Switch + Scenario Picker + Virtual Callers */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-100 dark:border-[#1E2536]">
          <div className="flex flex-wrap items-center gap-3">
            {/* Execution Target Segmented Control */}
            <div className="inline-flex rounded-lg bg-slate-100 dark:bg-[#090B10] p-1 border border-slate-200/70 dark:border-[#1E2536]">
              <button
                type="button"
                onClick={() => onExecutionModeChange('sandbox')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                  executionMode === 'sandbox'
                    ? 'bg-white dark:bg-[#151B28] text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Built-in Sandbox Agent
              </button>
              <button
                type="button"
                onClick={() => onExecutionModeChange('live')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                  executionMode === 'live'
                    ? 'bg-white dark:bg-[#151B28] text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Live Custom Endpoint
              </button>
            </div>

            {/* Active Scenario Dropdown */}
            <select
              aria-label="Inspect scenario"
              value={activeScenario.id}
              onChange={(e) => onSelectScenario(e.target.value)}
              className="max-w-xs sm:max-w-sm rounded-lg border border-slate-200 dark:border-[#1E2536] bg-[#F8FAFC] dark:bg-[#090B10] px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            >
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Parallel Concurrency Picker */}
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
              Concurrency
            </span>
            <div className="inline-flex rounded-lg bg-slate-100 dark:bg-[#090B10] p-1 border border-slate-200/70 dark:border-[#1E2536]">
              {([1, 5, 10, 25] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onConcurrencyChange(c)}
                  className={`px-2.5 py-1 rounded-md text-xs font-mono tabular-nums font-medium transition-all whitespace-nowrap ${
                    concurrency === c
                      ? 'bg-white dark:bg-[#151B28] text-indigo-600 dark:text-indigo-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {c}x
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Live Progress Bar */}
        {isRunning && (
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between text-xs text-indigo-600 dark:text-indigo-400 font-medium">
              <span>Running acoustic DSP simulation and assertion checks...</span>
              <span className="font-mono tabular-nums">
                {progressDone} / {progressTotal} calls ({progressPct}%)
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-[#090B10] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#4F46E5] transition-transform duration-150 origin-left"
                style={{ transform: `scaleX(${progressPct / 100})` }}
              />
            </div>
          </div>
        )}
      </section>

      {/* Inline Live Custom Endpoint Panel when Live Mode is active */}
      {executionMode === 'live' && (
        <LiveTargetPanel
          scenario={activeScenario}
          config={liveConfig}
          onConfigChange={onLiveConfigChange}
          onLiveResult={onLiveResult}
        />
      )}

      {/* 4 Clean Executive KPI Summary Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        <div className="rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Suite Pass Rate
            </span>
            {currentRun && (
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                  currentRun.passRatePct >= 95
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
                    : currentRun.passRatePct >= 70
                      ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30'
                      : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30'
                }`}
              >
                {currentRun.passedCalls}/{currentRun.totalCalls} Passed
              </span>
            )}
          </div>
          <div className="mt-3 text-3xl font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {currentRun ? `${currentRun.passRatePct}%` : '--'}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
            Percentage of calls passing all SLA & guardrail rules
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              P95 Response Latency
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-mono tabular-nums font-medium border ${
                (currentRun?.p95LatencyMs ?? 0) > 850
                  ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
              }`}
            >
              P50 {currentRun ? `${currentRun.p50LatencyMs}ms` : '--'}
            </span>
          </div>
          <div className="mt-3 text-3xl font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {currentRun ? `${currentRun.p95LatencyMs}ms` : '--'}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
            Time to first spoken byte (target ≤ 850ms)
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Mean Barge-In Halt
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                (currentRun?.meanBargeInHaltMs ?? 0) > 350
                  ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
              }`}
            >
              {(currentRun?.meanBargeInHaltMs ?? 0) > 350 ? 'Talk-Over Risk' : 'Healthy ≤ 350ms'}
            </span>
          </div>
          <div className="mt-3 text-3xl font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {currentRun ? `${currentRun.meanBargeInHaltMs}ms` : '--'}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
            How quickly the AI stops speaking when interrupted
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Dead-Air Violations
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-mono tabular-nums font-medium border ${
                (currentRun?.deadAirViolationsTotal ?? 0) > 0
                  ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30'
                  : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
              }`}
            >
              {selectedCall ? `SNR ${selectedCall.metrics.measuredSnrDb}dB` : 'Idle'}
            </span>
          </div>
          <div className="mt-3 text-3xl font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {currentRun ? currentRun.deadAirViolationsTotal : 0}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
            Awkward silence gaps exceeding 1,500ms
          </p>
        </div>
      </section>

      {/* Multi-Track Call Timeline Underneath KPI Cards */}
      <div
        id="call-waterfall-section"
        className={`rounded-2xl transition-all duration-500 ${
          highlightWaterfall
            ? 'ring-2 ring-rose-500 ring-offset-4 ring-offset-[#F8FAFC] dark:ring-offset-[#090B10]'
            : ''
        }`}
      >
        <CallWaterfall
          call={selectedCall}
          dspResult={dspResult}
          audioController={audioController}
        />
      </div>

      {/* Assertion Diagnostics & Final QA Scorecard */}
      {selectedCall && (
        <section
          id="qa-scorecard-section"
          className={`grid grid-cols-1 xl:grid-cols-12 gap-6 scroll-mt-24 rounded-2xl transition-all duration-500 ${
            highlightScorecard
              ? 'ring-2 ring-[#4F46E5] ring-offset-4 ring-offset-[#F8FAFC] dark:ring-offset-[#090B10]'
              : ''
          }`}
        >
          <div className="xl:col-span-8 rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-[#1E2536] flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Final QA Scorecard & Deterministic Assertions
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Automated pass/fail verification for latency, barge-in halt, webhooks, and policy safety.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {qaScore !== null && (
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-mono tabular-nums font-semibold border whitespace-nowrap ${
                      qaScore >= 85
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
                        : qaScore >= 70
                          ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30'
                          : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30'
                    }`}
                  >
                    QA Score: {qaScore}/100
                  </span>
                )}
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${
                    selectedCall.status === 'passed'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
                      : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30'
                  }`}
                >
                  {selectedCall.status === 'passed' ? 'All Checks Passed' : 'Failures Detected'}
                </span>
                {onExportReport && (
                  <button
                    type="button"
                    onClick={onExportReport}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                      highlightScorecard
                        ? 'bg-[#4F46E5] text-white hover:bg-[#4338CA] shadow-sm'
                        : 'border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#151B28] text-slate-700 dark:text-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export QA Report
                  </button>
                )}
              </div>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-[#1E2536]">
              {selectedCall.assertions.map((a) => (
                <div
                  key={a.ruleId}
                  className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    {a.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                            a.passed
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
                              : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30'
                          }`}
                        >
                          {a.passed ? 'PASS' : 'FAIL'}
                        </span>
                        <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                          {a.type}
                        </span>
                        <span className="text-slate-400 font-mono">expected {a.expected}</span>
                      </div>
                      <p
                        className={`mt-1 text-xs ${
                          a.passed ? 'text-slate-500 dark:text-slate-400' : 'text-rose-700 dark:text-rose-300 font-medium'
                        }`}
                      >
                        {a.diagnostic}
                      </p>
                    </div>
                  </div>
                  <div className="font-mono tabular-nums font-semibold text-xs text-slate-700 dark:text-slate-200 shrink-0 sm:text-right pl-7 sm:pl-0">
                    {a.actual}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="xl:col-span-4 rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-[#1E2536] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Observed Agent Output
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 dark:bg-[#090B10] text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-[#1E2536] capitalize">
                {selectedCall.mode}
              </span>
            </div>
            <div className="p-5 space-y-4 flex-1 text-xs">
              <div>
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                  Spoken Transcript
                </div>
                <div className="rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] p-3.5 text-slate-800 dark:text-slate-200 leading-relaxed break-words">
                  {selectedCall.agentTranscript}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                  Verified Tool Calls
                </div>
                {selectedCall.calledTools.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedCall.calledTools.map((t) => (
                      <span
                        key={t}
                        className="px-2.5 py-1 rounded-md font-mono text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30"
                      >
                        {t}()
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-slate-400 italic">No backend webhooks triggered</span>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Virtual Caller Matrix & Latency Distribution Histogram */}
      {currentRun && currentRun.calls.length > 0 && (
        <section className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* Per-Call Execution Matrix */}
          <div className="xl:col-span-7 rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-[#1E2536] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Virtual Caller Results ({currentRun.totalCalls} calls)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Click any call row to inspect its exact audio timeline and assertion diagnostics above.
                </p>
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-[#0D1017] text-[11px] font-medium text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-[#1E2536]">
                  <tr>
                    <th className="py-2.5 px-4">Call</th>
                    <th className="py-2.5 px-3">Scenario</th>
                    <th className="py-2.5 px-3 text-right">TTFB</th>
                    <th className="py-2.5 px-3 text-right">Halt</th>
                    <th className="py-2.5 px-3 text-right">SNR</th>
                    <th className="py-2.5 px-4 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#1E2536]">
                  {currentRun.calls.map((c) => {
                    const isSelected = selectedCall?.callId === c.callId;
                    return (
                      <tr
                        key={c.callId}
                        onClick={() => onSelectCall(c)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-indigo-50/70 dark:bg-indigo-500/15'
                            : 'hover:bg-slate-50 dark:hover:bg-[#151B28]'
                        }`}
                      >
                        <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          #{c.virtualCallerIndex}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-800 dark:text-slate-200 max-w-[220px] truncate">
                          {c.scenarioName}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono tabular-nums ${
                            c.metrics.ttfbMs > 850
                              ? 'text-rose-600 dark:text-rose-400 font-semibold'
                              : 'text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {c.metrics.ttfbMs}ms
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono tabular-nums ${
                            c.metrics.bargeInHaltMs > 350
                              ? 'text-rose-600 dark:text-rose-400 font-semibold'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {c.metrics.bargeInHaltMs > 0 ? `${c.metrics.bargeInHaltMs}ms` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {c.metrics.measuredSnrDb}dB
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                              c.status === 'passed'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
                                : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30'
                            }`}
                          >
                            {c.status === 'passed' ? 'PASS' : 'FAIL'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* TTFB Latency Distribution Histogram */}
          <div className="xl:col-span-5 rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-[#1E2536] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Response Latency Distribution
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  TTFB spread across virtual calls
                </p>
              </div>
              <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                P50 {currentRun.p50LatencyMs}ms · P95 {currentRun.p95LatencyMs}ms
              </span>
            </div>

            <div className="p-5 flex-1 flex flex-col justify-between">
              <div className="relative h-48 flex items-end gap-2 pt-6 pb-2 border-b border-slate-200 dark:border-[#1E2536]">
                {histogram.buckets.map((b, idx) => {
                  const totalH = (b.count / histogram.maxCount) * 100;
                  const failRatio = b.count > 0 ? b.failedCount / b.count : 0;
                  return (
                    <div
                      key={idx}
                      title={`${b.lo}ms – ${b.hi}ms: ${b.count} call(s) (${b.failedCount} failed)`}
                      className="flex-1 h-full flex flex-col justify-end"
                    >
                      <div className="text-[10px] font-mono tabular-nums text-center text-slate-500 mb-1">
                        {b.count > 0 ? b.count : ''}
                      </div>
                      <div
                        className="w-full rounded-t-md transition-all"
                        style={{
                          height: `${b.count > 0 ? Math.max(10, totalH) : 3}%`,
                          backgroundColor:
                            b.count === 0
                              ? 'rgba(148, 163, 184, 0.2)'
                              : failRatio > 0.5
                                ? '#E11D48'
                                : failRatio > 0
                                  ? '#D97706'
                                  : '#2563EB',
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-2.5 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                <span>{histogram.minMs}ms</span>
                <span className="text-[#2563EB] dark:text-blue-400 font-medium">
                  P50: {currentRun.p50LatencyMs}ms
                </span>
                <span
                  className={
                    currentRun.p95LatencyMs > 850
                      ? 'text-[#E11D48] dark:text-rose-400 font-semibold'
                      : 'text-[#D97706] dark:text-amber-400 font-medium'
                  }
                >
                  P95: {currentRun.p95LatencyMs}ms
                </span>
                <span>{histogram.maxMs}ms</span>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
