import React, { useMemo, useState } from 'react';
import { AlertTriangle, Play, Square, Terminal } from 'lucide-react';
import { CallExecutionResult, DspProcessingResult } from '../types';
import { LiveAudioController } from '../engine/dspEngine';

interface CallWaterfallProps {
  call: CallExecutionResult | null;
  dspResult: DspProcessingResult | null;
  audioController: LiveAudioController;
}

export const CallWaterfall: React.FC<CallWaterfallProps> = ({
  call,
  dspResult,
  audioController,
}) => {
  const [hoverTimeMs, setHoverTimeMs] = useState<number | null>(null);
  const [hoveredDetail, setHoveredDetail] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const ticks = useMemo(() => {
    if (!call) return [];
    const total = Math.max(1000, call.metrics.totalDurationMs);
    const step = total > 8000 ? 2000 : 1000;
    const arr: number[] = [];
    for (let t = 0; t <= total; t += step) {
      arr.push(t);
    }
    return arr;
  }, [call]);

  if (!call) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm p-10 text-center text-sm text-slate-500 dark:text-slate-400">
        Select a scenario and run a test suite to inspect the synchronized 3-track call timeline.
      </div>
    );
  }

  const totalMs = Math.max(1000, call.metrics.totalDurationMs);
  const toPct = (ms: number) => `${Math.max(0, Math.min(100, (ms / totalMs) * 100))}%`;
  const toWidthPct = (startMs: number, endMs: number) =>
    `${Math.max(0.6, Math.min(100, ((endMs - startMs) / totalMs) * 100))}%`;

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverTimeMs(Math.round(relX * totalMs));
  };

  const handleAuditionCaller = () => {
    if (!dspResult) return;
    if (isPlaying) {
      audioController.stop();
      setIsPlaying(false);
      return;
    }
    setIsPlaying(true);
    audioController.play(
      dspResult.cleanPcm,
      dspResult.degradedPcm,
      dspResult.sampleRate,
      'degraded',
      false,
      () => setIsPlaying(false)
    );
  };

  return (
    <section className="rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm overflow-hidden">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-slate-200 dark:border-[#1E2536]">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Multi-Track Call Timeline
            </h3>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                call.status === 'passed'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
                  : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30'
              }`}
            >
              {call.status === 'passed' ? 'Passed' : 'Failed'}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            Caller #{call.virtualCallerIndex} · {call.scenarioName}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs shrink-0">
          <div className="hidden sm:flex items-center gap-3 text-[11px] font-medium text-slate-600 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#2563EB]" /> Caller
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#D97706]" /> Chaos / Barge-In
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#10B981]" /> Agent Voice
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#E11D48]" /> Dead Air / Talk-Over
            </span>
          </div>

          {dspResult && (
            <button
              type="button"
              onClick={handleAuditionCaller}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                isPlaying
                  ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:border-amber-500/40 dark:text-amber-300'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 dark:bg-[#090B10] dark:border-[#1E2536] dark:text-slate-200 dark:hover:border-indigo-500/50'
              }`}
            >
              {isPlaying ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />}
              {isPlaying ? 'Stop Audio' : 'Listen to Caller'}
            </button>
          )}
        </div>
      </div>

      {/* Interactive Timeline Grid */}
      <div className="grid grid-cols-[164px_1fr] bg-[#F8FAFC] dark:bg-[#090B10]">
        {/* Time Ruler Row */}
        <div className="px-4 py-2 border-b border-r border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#0D1017] text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between">
          <span>Timeline</span>
          <span className="font-mono tabular-nums font-semibold text-indigo-600 dark:text-indigo-400">
            {hoverTimeMs !== null ? `${(hoverTimeMs / 1000).toFixed(2)}s` : `${(totalMs / 1000).toFixed(1)}s`}
          </span>
        </div>
        <div
          className="relative h-8 border-b border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#0D1017] select-none cursor-crosshair overflow-hidden"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => {
            setHoverTimeMs(null);
            setHoveredDetail(null);
          }}
        >
          {ticks.map((t) => (
            <div
              key={t}
              style={{ left: toPct(t) }}
              className="absolute top-0 bottom-0 border-l border-slate-200 dark:border-[#1E2536] pl-1.5 text-[10px] font-mono tabular-nums text-slate-400 dark:text-slate-500 flex items-center"
            >
              {(t / 1000).toFixed(1)}s
            </div>
          ))}
          {hoverTimeMs !== null && (
            <div
              style={{ left: toPct(hoverTimeMs) }}
              className="absolute top-0 bottom-0 w-px bg-indigo-500 pointer-events-none"
            />
          )}
        </div>

        {/* TRACK 1: Caller Track (Royal Blue #2563EB waveform + Amber/Rose chaos overlays) */}
        <div className="px-4 py-3 border-b border-r border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] flex flex-col justify-center">
          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">1. Caller Audio</div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">
            SNR {call.metrics.measuredSnrDb}dB · Loss {call.metrics.packetLossPct}%
          </div>
        </div>
        <div
          className="relative h-22 border-b border-slate-200 dark:border-[#1E2536] overflow-hidden cursor-crosshair bg-[#F8FAFC] dark:bg-[#090B10]"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => {
            setHoverTimeMs(null);
            setHoveredDetail(null);
          }}
        >
          {ticks.map((t) => (
            <div
              key={t}
              style={{ left: toPct(t) }}
              className="absolute top-0 bottom-0 border-l border-slate-200/80 dark:border-[#151B28] pointer-events-none"
            />
          ))}

          {/* Caller Waveform Bars (#2563EB Royal Blue) */}
          <div className="absolute inset-0 flex items-center px-0.5 gap-px pointer-events-none">
            {call.callerEnvelope.map((amp, i) => (
              <div
                key={i}
                className="flex-1 bg-[#2563EB]/85 dark:bg-blue-500/85 rounded-full"
                style={{ height: `${Math.max(4, amp * 80)}%` }}
              />
            ))}
          </div>

          {/* Chaos Markers Overlay */}
          {call.chaosMarkers.map((mk) => {
            const isBarge = mk.type === 'barge_in';
            const isLoss = mk.type === 'packet_loss';
            return (
              <div
                key={mk.id}
                onMouseEnter={() =>
                  setHoveredDetail(
                    `${mk.label} (${(mk.startMs / 1000).toFixed(2)}s – ${(mk.endMs / 1000).toFixed(2)}s)`
                  )
                }
                style={{
                  left: toPct(mk.startMs),
                  width: toWidthPct(mk.startMs, mk.endMs),
                }}
                className={`absolute top-0 bottom-0 border-x ${
                  isBarge
                    ? 'bg-amber-500/20 border-amber-500'
                    : isLoss
                      ? 'bg-rose-500/18 border-rose-500/60'
                      : 'bg-amber-500/12 border-amber-500/40'
                }`}
              >
                {isBarge && (
                  <span className="absolute top-1.5 left-1 px-1.5 py-0.5 rounded bg-amber-600 text-white text-[10px] font-medium whitespace-nowrap leading-none shadow-xs">
                    {mk.label}
                  </span>
                )}
              </div>
            );
          })}

          {hoverTimeMs !== null && (
            <div
              style={{ left: toPct(hoverTimeMs) }}
              className="absolute top-0 bottom-0 w-px bg-indigo-500/80 pointer-events-none"
            />
          )}
        </div>

        {/* TRACK 2: Agent Track (Emerald #10B981 speech + Rose #E11D48 Dead Air / Talk-Over blocks) */}
        <div className="px-4 py-3 border-b border-r border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] flex flex-col justify-center">
          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">2. AI Agent</div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">
            TTFB {call.metrics.ttfbMs}ms · Halt {call.metrics.bargeInHaltMs}ms
          </div>
        </div>
        <div
          className="relative h-22 border-b border-slate-200 dark:border-[#1E2536] overflow-hidden cursor-crosshair bg-white dark:bg-[#0B0E15]"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => {
            setHoverTimeMs(null);
            setHoveredDetail(null);
          }}
        >
          {ticks.map((t) => (
            <div
              key={t}
              style={{ left: toPct(t) }}
              className="absolute top-0 bottom-0 border-l border-slate-200/80 dark:border-[#151B28] pointer-events-none"
            />
          ))}

          {/* Agent Waveform Bars (#10B981 Emerald) */}
          <div className="absolute inset-0 flex items-center px-0.5 gap-px pointer-events-none">
            {call.agentEnvelope.map((amp, i) => (
              <div
                key={i}
                className="flex-1 bg-[#10B981]/75 rounded-full"
                style={{ height: `${amp > 0.01 ? Math.max(4, amp * 74) : 0}%` }}
              />
            ))}
          </div>

          {/* Agent Spans */}
          {call.agentSpans.map((sp) => {
            const isDeadAir = sp.type === 'dead_air';
            const isTalkOver = sp.type === 'talk_over';
            return (
              <div
                key={sp.id}
                onMouseEnter={() =>
                  setHoveredDetail(
                    `${sp.label} (${(sp.startMs / 1000).toFixed(2)}s – ${(sp.endMs / 1000).toFixed(2)}s)`
                  )
                }
                style={{
                  left: toPct(sp.startMs),
                  width: toWidthPct(sp.startMs, sp.endMs),
                }}
                className={`absolute top-2 bottom-2 px-2 rounded-md flex items-start pt-1 overflow-hidden border ${
                  isDeadAir
                    ? 'bg-rose-50/95 border-rose-300 text-rose-700 dark:bg-rose-500/20 dark:border-rose-500 dark:text-rose-200'
                    : isTalkOver
                      ? 'bg-rose-100/95 border-rose-400 text-rose-800 dark:bg-rose-600/35 dark:border-rose-400 dark:text-rose-100 z-10'
                      : 'bg-emerald-50/70 border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/40 dark:text-emerald-200'
                }`}
              >
                <span className="text-[10px] font-medium whitespace-nowrap truncate flex items-center gap-1">
                  {(isDeadAir || isTalkOver) && (
                    <AlertTriangle className="w-3 h-3 text-[#E11D48] dark:text-rose-400 shrink-0" />
                  )}
                  {sp.label}
                </span>
              </div>
            );
          })}

          {hoverTimeMs !== null && (
            <div
              style={{ left: toPct(hoverTimeMs) }}
              className="absolute top-0 bottom-0 w-px bg-indigo-500/80 pointer-events-none"
            />
          )}
        </div>

        {/* TRACK 3: Tool & Telemetry Track */}
        <div className="px-4 py-3 border-r border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] flex flex-col justify-center">
          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">3. Backend Tools</div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">
            {call.toolSpans.length} webhook{call.toolSpans.length === 1 ? '' : 's'}
          </div>
        </div>
        <div
          className="relative h-16 overflow-hidden cursor-crosshair bg-[#F8FAFC] dark:bg-[#090B10]"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => {
            setHoverTimeMs(null);
            setHoveredDetail(null);
          }}
        >
          {ticks.map((t) => (
            <div
              key={t}
              style={{ left: toPct(t) }}
              className="absolute top-0 bottom-0 border-l border-slate-200/80 dark:border-[#151B28] pointer-events-none"
            />
          ))}

          {call.toolSpans.length === 0 && (
            <div className="h-full flex items-center px-4 text-xs text-slate-400 dark:text-slate-500">
              No backend tool calls recorded during this turn
            </div>
          )}

          {call.toolSpans.map((tool, idx) => {
            const isOk = tool.status === 'ok';
            const topClass = idx % 2 === 0 ? 'top-2' : 'bottom-2';
            return (
              <div
                key={tool.id}
                onMouseEnter={() =>
                  setHoveredDetail(
                    `${tool.toolName}() · ${tool.durationMs}ms · ${tool.payloadPreview}`
                  )
                }
                style={{
                  left: toPct(tool.startMs),
                  width: toWidthPct(tool.startMs, tool.startMs + Math.max(260, tool.durationMs)),
                }}
                className={`absolute ${topClass} h-5 px-2 rounded flex items-center gap-1 border text-[10px] font-mono whitespace-nowrap overflow-hidden ${
                  isOk
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/15 dark:border-emerald-500/50 dark:text-emerald-300'
                    : 'bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-500/20 dark:border-rose-500 dark:text-rose-300'
                }`}
              >
                <Terminal className="w-2.5 h-2.5 shrink-0" />
                <span className="truncate">
                  {tool.toolName}() {isOk ? `${tool.durationMs}ms` : 'TIMEOUT'}
                </span>
              </div>
            );
          })}

          {hoverTimeMs !== null && (
            <div
              style={{ left: toPct(hoverTimeMs) }}
              className="absolute top-0 bottom-0 w-px bg-indigo-500/80 pointer-events-none"
            />
          )}
        </div>
      </div>

      {/* Footer Inspection Strip */}
      <div className="px-5 py-2.5 border-t border-slate-200 dark:border-[#1E2536] bg-slate-50/70 dark:bg-[#0D1017] flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span className="truncate font-mono text-[11px]">
          {hoveredDetail ?? 'Hover across any track to inspect exact millisecond events, noise spikes, and webhook timing.'}
        </span>
        <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400 shrink-0 ml-4">
          Max Dead Air: {call.metrics.maxDeadAirMs}ms · Violations: {call.metrics.deadAirViolations}
        </span>
      </div>
    </section>
  );
};
