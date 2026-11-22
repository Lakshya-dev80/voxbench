import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  GitCompare,
  Moon,
  Play,
  SlidersHorizontal,
  Sun,
  Waves,
  X,
} from 'lucide-react';
import {
  AudioSourceType,
  CallExecutionResult,
  ChaosConfig,
  DspProcessingResult,
  ExecutionMode,
  FaultInjectionConfig,
  LiveEndpointConfig,
  Scenario,
  SuiteRunSnapshot,
  WorkbenchTab,
} from './types';
import { DEFAULT_SCENARIOS } from './engine/scenarios';
import {
  generateSyntheticVoicePcm,
  LiveAudioController,
  processChaosAudio,
} from './engine/dspEngine';
import {
  executeLiveEndpointCall,
  executeSandboxCall,
  summarizeSuiteRun,
} from './engine/runnerEngine';
import { StressRunnerPanel } from './components/StressRunnerPanel';
import { ChaosLabPanel } from './components/ChaosLabPanel';
import { ScenariosPanel } from './components/ScenariosPanel';
import { DiffAndCiPanel } from './components/DiffAndCiPanel';

const INITIAL_FAULTS: FaultInjectionConfig = {
  slowLlmBottleneck: false,
  brokenBargeInHandler: false,
  noiseInducedHallucination: false,
  webhookTimeout: false,
};

const INITIAL_LIVE_CONFIG: LiveEndpointConfig = {
  protocol: 'http',
  url: 'https://httpbin.org/post',
  method: 'POST',
  authBearer: '',
  headersJson: JSON.stringify(
    {
      'X-VoxBench-Client': 'web-chaos-runner',
    },
    null,
    2
  ),
  payloadTemplate: JSON.stringify(
    {
      scenario_id: '{{scenario_id}}',
      caller_utterance: '{{utterance}}',
      acoustic_profile: {
        snr_db: '{{snr_db}}',
        packet_loss_pct: '{{packet_loss_pct}}',
        codec: 'g711_ulaw_8khz',
      },
    },
    null,
    2
  ),
  timeoutMs: 12000,
};

const NAV_TABS: Array<{ id: WorkbenchTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'runner', label: 'Stress Test Runner', icon: Activity },
  { id: 'chaos-lab', label: 'Audio Chaos Lab', icon: Waves },
  { id: 'scenarios', label: 'Test Scenarios & Bugs', icon: SlidersHorizontal },
  { id: 'diff-ci', label: 'Compare & Export', icon: GitCompare },
];

export default function App() {
  // Light Mode is the default theme
  const [isDark, setIsDark] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkbenchTab>('runner');
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('sandbox');
  const [scenarios, setScenarios] = useState<Scenario[]>(DEFAULT_SCENARIOS);
  const [activeScenarioId, setActiveScenarioId] = useState<string>(DEFAULT_SCENARIOS[0].id);
  const [faults, setFaults] = useState<FaultInjectionConfig>(INITIAL_FAULTS);
  const [liveConfig, setLiveConfig] = useState<LiveEndpointConfig>(INITIAL_LIVE_CONFIG);
  const [concurrency, setConcurrency] = useState<1 | 5 | 10 | 25>(10);

  // Audio source & real Web Audio DSP state
  const [audioSourceType, setAudioSourceType] = useState<AudioSourceType>('synthetic');
  const [customPcm, setCustomPcm] = useState<{ pcm: Float32Array; sampleRate: number; label: string } | null>(null);
  const [dspResult, setDspResult] = useState<DspProcessingResult | null>(null);
  const audioControllerRef = useRef<LiveAudioController>(new LiveAudioController());

  // Execution results & version snapshots
  const [currentRun, setCurrentRun] = useState<SuiteRunSnapshot | null>(null);
  const [selectedCall, setSelectedCall] = useState<CallExecutionResult | null>(null);
  const [snapshots, setSnapshots] = useState<SuiteRunSnapshot[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progressDone, setProgressDone] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Sync Tailwind v4 class-based dark variant with React theme state
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const activeScenario = useMemo(
    () => scenarios.find((s) => s.id === activeScenarioId) ?? scenarios[0],
    [scenarios, activeScenarioId]
  );

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3400);
  }, []);

  // Recompute real Web Audio DSP whenever active scenario chaos parameters, utterance, or custom PCM change
  useEffect(() => {
    let cancelled = false;
    const runDsp = async () => {
      const useCustom = audioSourceType !== 'synthetic' && customPcm !== null;
      const sampleRate = useCustom ? customPcm.sampleRate : 16000;
      const pcm = useCustom
        ? customPcm.pcm
        : generateSyntheticVoicePcm(activeScenario.utteranceText, sampleRate, activeScenario.seed);

      const res = await processChaosAudio(pcm, sampleRate, activeScenario.chaos, activeScenario.seed);
      if (!cancelled) {
        setDspResult(res);
      }
    };
    void runDsp();
    return () => {
      cancelled = true;
    };
  }, [activeScenario, audioSourceType, customPcm]);

  // Boot directly into a real baseline suite run (v1.2-prod) with 0 faults
  useEffect(() => {
    let cancelled = false;
    const bootstrapBaseline = async () => {
      const initialCalls: CallExecutionResult[] = [];
      for (let i = 0; i < DEFAULT_SCENARIOS.length; i++) {
        const res = await executeSandboxCall(DEFAULT_SCENARIOS[i], INITIAL_FAULTS, i + 1, 1);
        initialCalls.push(res);
      }
      if (cancelled) return;
      const baseline = summarizeSuiteRun('v1.2-prod', initialCalls, 'sandbox', 1, INITIAL_FAULTS);
      setSnapshots([baseline]);
      setCurrentRun(baseline);
      setSelectedCall(initialCalls[0]);
    };
    void bootstrapBaseline();
    return () => {
      cancelled = true;
    };
  }, []);

  // Run Single Active Scenario
  const runSingleScenario = useCallback(
    async (overrideFaults?: FaultInjectionConfig, targetScenario?: Scenario) => {
      const scn = targetScenario ?? activeScenario;
      const activeFaults = overrideFaults ?? faults;
      setIsRunning(true);
      setProgressDone(0);
      setProgressTotal(1);

      try {
        const result =
          executionMode === 'sandbox'
            ? await executeSandboxCall(
                scn,
                activeFaults,
                1,
                1,
                audioSourceType !== 'synthetic' && customPcm ? customPcm : null
              )
            : await executeLiveEndpointCall(scn, liveConfig, 1);

        setProgressDone(1);

        setCurrentRun((prev) => {
          const prevOthers = prev ? prev.calls.filter((c) => c.scenarioId !== scn.id) : [];
          const nextCalls = [result, ...prevOthers];
          return summarizeSuiteRun(
            `run-${new Date().toLocaleTimeString([], { hour12: false })}`,
            nextCalls,
            executionMode,
            1,
            activeFaults
          );
        });
        setSelectedCall(result);
      } finally {
        setIsRunning(false);
      }
    },
    [activeScenario, audioSourceType, customPcm, executionMode, faults, liveConfig]
  );

  // Launch Parallel Chaos Suite (6 scenarios or 5/10/25 concurrent virtual callers)
  const runParallelChaosSuite = useCallback(
    async (virtualCallCount: number) => {
      setIsRunning(true);
      setActiveTab('runner');
      const totalCalls = Math.max(scenarios.length, virtualCallCount);
      setProgressDone(0);
      setProgressTotal(totalCalls);

      const collected: CallExecutionResult[] = [];
      const batchSize = executionMode === 'live' ? 2 : 5;

      try {
        for (let offset = 0; offset < totalCalls; offset += batchSize) {
          const sliceIndices: number[] = [];
          for (let j = 0; j < batchSize && offset + j < totalCalls; j++) {
            sliceIndices.push(offset + j);
          }

          const batchResults = await Promise.all(
            sliceIndices.map(async (idx) => {
              const scn = scenarios[idx % scenarios.length];
              if (executionMode === 'sandbox') {
                return executeSandboxCall(
                  scn,
                  faults,
                  idx + 1,
                  virtualCallCount,
                  scn.id === activeScenario.id && audioSourceType !== 'synthetic' && customPcm
                    ? customPcm
                    : null
                );
              }
              return executeLiveEndpointCall(scn, liveConfig, idx + 1);
            })
          );

          collected.push(...batchResults);
          setProgressDone(collected.length);

          const partialSnap = summarizeSuiteRun(
            'live-wave',
            [...collected],
            executionMode,
            virtualCallCount,
            faults
          );
          setCurrentRun(partialSnap);
          if (offset === 0 && batchResults[0]) {
            const activeMatch =
              batchResults.find((r) => r.scenarioId === activeScenario.id) ?? batchResults[0];
            setSelectedCall(activeMatch);
          }

          await new Promise((r) => window.setTimeout(r, 45));
        }

        const finalSnap = summarizeSuiteRun(
          `suite-${virtualCallCount}x-${new Date().toLocaleTimeString([], { hour12: false })}`,
          collected,
          executionMode,
          virtualCallCount,
          faults
        );
        setCurrentRun(finalSnap);
        const preferred =
          collected.find((c) => c.scenarioId === activeScenario.id) ?? collected[0] ?? null;
        if (preferred) setSelectedCall(preferred);

        showToast(
          `Test suite finished · ${finalSnap.passRatePct}% pass rate · P95 latency ${finalSnap.p95LatencyMs}ms`
        );
      } finally {
        setIsRunning(false);
      }
    },
    [
      activeScenario.id,
      audioSourceType,
      customPcm,
      executionMode,
      faults,
      liveConfig,
      scenarios,
      showToast,
    ]
  );

  // Toggling a simulated bug immediately re-evaluates all scenarios in Sandbox mode
  const handleToggleFault = async (key: keyof FaultInjectionConfig) => {
    const nextFaults: FaultInjectionConfig = { ...faults, [key]: !faults[key] };
    setFaults(nextFaults);

    if (executionMode === 'sandbox' && !isRunning) {
      const calls: CallExecutionResult[] = [];
      for (let i = 0; i < scenarios.length; i++) {
        const res = await executeSandboxCall(
          scenarios[i],
          nextFaults,
          i + 1,
          Math.max(1, currentRun?.concurrency ?? 1)
        );
        calls.push(res);
      }
      const nextSnap = summarizeSuiteRun(
        'sandbox-fault-eval',
        calls,
        'sandbox',
        Math.max(1, currentRun?.concurrency ?? 1),
        nextFaults
      );
      setCurrentRun(nextSnap);
      const match = calls.find((c) => c.scenarioId === activeScenario.id) ?? calls[0];
      if (match) setSelectedCall(match);
    }
  };

  const handleSelectScenario = (id: string) => {
    setActiveScenarioId(id);
    if (currentRun) {
      const match = currentRun.calls.find((c) => c.scenarioId === id);
      if (match) setSelectedCall(match);
    }
  };

  const handleUpdateScenario = (updated: Scenario) => {
    setScenarios((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleChaosChange = (nextChaos: ChaosConfig) => {
    handleUpdateScenario({ ...activeScenario, chaos: nextChaos });
  };

  const handleUtteranceChange = (nextUtterance: string) => {
    handleUpdateScenario({ ...activeScenario, utteranceText: nextUtterance });
  };

  const handleAddScenario = (created: Scenario) => {
    setScenarios((prev) => [...prev, created]);
    setActiveScenarioId(created.id);
    showToast(`Added new test scenario "${created.name}"`);
  };

  const handleDeleteScenario = (id: string) => {
    setScenarios((prev) => {
      const remaining = prev.filter((s) => s.id !== id);
      if (activeScenarioId === id && remaining[0]) {
        setActiveScenarioId(remaining[0].id);
      }
      return remaining;
    });
  };

  const handleSaveSnapshot = (label: string) => {
    if (!currentRun) return;
    const saved: SuiteRunSnapshot = {
      ...currentRun,
      id: `snap-${Date.now().toString(36)}`,
      label,
      createdAt: new Date().toISOString(),
    };
    setSnapshots((prev) => [...prev, saved]);
    showToast(`Saved release snapshot "${label}" (${saved.passRatePct}% pass · P95 ${saved.p95LatencyMs}ms)`);
  };

  const armedFaultsCount = Object.values(faults).filter(Boolean).length;

  const scenarioStatusMap = useMemo(() => {
    const map = new Map<string, 'passed' | 'failed'>();
    currentRun?.calls.forEach((c) => {
      const prev = map.get(c.scenarioId);
      if (prev === 'failed') return;
      map.set(c.scenarioId, c.status);
    });
    return map;
  }, [currentRun]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#090B10] text-[#0F172A] dark:text-slate-100 flex flex-col transition-colors">
      {/* Spacious Stripe/Vercel-Inspired Top Navigation Header */}
      <header className="sticky top-0 z-30 h-16 bg-white/95 dark:bg-[#0D1017]/95 backdrop-blur border-b border-slate-200 dark:border-[#1E2536]">
        <div className="max-w-[1400px] mx-auto h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-6">
          {/* Brand Wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('runner');
            }}
            className="inline-flex items-center gap-2.5 text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="2" y="9.5" width="2.8" height="5" rx="1.4" fill="#4F46E5" />
              <rect x="6.5" y="5.5" width="2.8" height="13" rx="1.4" fill="#2563EB" />
              <rect x="11" y="3" width="2.8" height="18" rx="1.4" fill="#4F46E5" />
              <rect x="15.5" y="6.5" width="2.8" height="11" rx="1.4" fill="#10B981" />
              <rect x="20" y="9" width="2.8" height="6" rx="1.4" fill="#2563EB" />
            </svg>
            <span>VoxBench</span>
          </a>

          {/* 4 Spacious Workflow Navigation Tabs */}
          <nav className="hidden lg:flex items-center gap-1.5 h-full">
            {NAV_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#151B28] dark:hover:text-slate-100'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${active ? 'text-[#4F46E5] dark:text-indigo-400' : 'text-slate-400'}`} />
                  {tab.label}
                  {tab.id === 'scenarios' && armedFaultsCount > 0 && (
                    <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                      {armedFaultsCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right Header Controls: Subtle Light/Dark Theme Toggle + Primary CTA */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsDark((d) => !d)}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-lg border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#151B28] transition-colors shrink-0"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              disabled={isRunning}
              onClick={() => void runParallelChaosSuite(concurrency)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#4F46E5] text-white hover:bg-[#4338CA] disabled:opacity-60 shadow-xs transition-colors whitespace-nowrap shrink-0"
            >
              {isRunning ? (
                <Activity className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              {isRunning ? `Running ${progressDone}/${progressTotal}` : 'Run Test Suite'}
            </button>
          </div>
        </div>
      </header>

      {/* Responsive Mobile / Tablet Tab Bar */}
      <div className="lg:hidden flex items-center gap-1 overflow-x-auto border-b border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#0D1017] px-4 py-2">
        {NAV_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Main Centered Executive SaaS Viewport */}
      <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
        {toastMessage && (
          <div className="mb-6 rounded-xl border border-indigo-200 dark:border-indigo-500/40 bg-indigo-50 dark:bg-indigo-500/10 px-4 py-3 text-xs font-medium text-indigo-800 dark:text-indigo-200 flex items-center justify-between shadow-xs">
            <span>{toastMessage}</span>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-100 ml-4"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {activeTab === 'runner' && (
          <StressRunnerPanel
            scenarios={scenarios}
            activeScenario={activeScenario}
            onSelectScenario={handleSelectScenario}
            executionMode={executionMode}
            onExecutionModeChange={setExecutionMode}
            armedFaultsCount={armedFaultsCount}
            onOpenBugsTab={() => setActiveTab('scenarios')}
            liveConfig={liveConfig}
            onLiveConfigChange={setLiveConfig}
            onLiveResult={(res) => {
              setSelectedCall(res);
              setCurrentRun((prev) => {
                const prevOthers = prev ? prev.calls.filter((c) => c.scenarioId !== res.scenarioId) : [];
                return summarizeSuiteRun('live-probe', [res, ...prevOthers], 'live', 1, faults);
              });
            }}
            currentRun={currentRun}
            selectedCall={selectedCall}
            onSelectCall={(call) => {
              setSelectedCall(call);
              setActiveScenarioId(call.scenarioId);
            }}
            dspResult={dspResult}
            audioController={audioControllerRef.current}
            isRunning={isRunning}
            progressDone={progressDone}
            progressTotal={progressTotal}
            concurrency={concurrency}
            onConcurrencyChange={setConcurrency}
            onRunSingleScenario={() => void runSingleScenario()}
            onRunParallelSuite={(c) => void runParallelChaosSuite(c)}
            onQuickSaveSnapshot={() => {
              const tag = `v1.${snapshots.length + 2}-candidate`;
              handleSaveSnapshot(tag);
            }}
          />
        )}

        {activeTab === 'chaos-lab' && (
          <ChaosLabPanel
            scenarios={scenarios}
            scenario={activeScenario}
            onSelectScenario={handleSelectScenario}
            dspResult={dspResult}
            audioSourceType={audioSourceType}
            uploadedFileName={customPcm?.label ?? null}
            onAudioSourceTypeChange={(src) => {
              setAudioSourceType(src);
              if (src === 'synthetic') setCustomPcm(null);
            }}
            onCustomPcmCaptured={(pcm, sampleRate, label, srcType) => {
              setCustomPcm({ pcm, sampleRate, label });
              setAudioSourceType(srcType);
              showToast(`Loaded "${label}" (${(pcm.length / sampleRate).toFixed(2)}s @ ${sampleRate / 1000}kHz)`);
            }}
            onChaosChange={handleChaosChange}
            onUtteranceChange={handleUtteranceChange}
            audioController={audioControllerRef.current}
            isDark={isDark}
          />
        )}

        {activeTab === 'scenarios' && (
          <ScenariosPanel
            scenarios={scenarios}
            activeScenario={activeScenario}
            scenarioStatusMap={scenarioStatusMap}
            faults={faults}
            onToggleFault={(k) => void handleToggleFault(k)}
            onSelectScenario={handleSelectScenario}
            onUpdateScenario={handleUpdateScenario}
            onAddScenario={handleAddScenario}
            onDeleteScenario={handleDeleteScenario}
          />
        )}

        {activeTab === 'diff-ci' && (
          <DiffAndCiPanel
            snapshots={snapshots}
            currentRun={currentRun}
            onSaveSnapshot={handleSaveSnapshot}
          />
        )}
      </main>
    </div>
  );
}
