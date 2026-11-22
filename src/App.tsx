import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  GitCompare,
  Mail,
  Moon,
  Play,
  SlidersHorizontal,
  Sparkles,
  Square,
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
import { AutoDemoBanner, AutoDemoState } from './components/AutoDemoBanner';
import { ProUpgradeModal } from './components/ProUpgradeModal';
import { buildJsonReport, triggerFileDownload } from './engine/exporters';

const INITIAL_DEMO_STATE: AutoDemoState = {
  active: false,
  completed: false,
  step: 1,
  headline: '',
  detail: '',
  progressPct: 0,
  elapsedSec: 0,
  totalSec: 20,
  finalScore: null,
};

function computeQaScore(run: SuiteRunSnapshot | null): number | null {
  if (!run || run.totalCalls === 0) return null;
  const passComponent = run.passRatePct * 0.52;
  const latencyComponent = Math.max(0, Math.min(24, 24 - Math.max(0, run.p95LatencyMs - 600) * 0.025));
  const bargeComponent =
    run.meanBargeInHaltMs <= 350
      ? 24
      : Math.max(0, 24 - (run.meanBargeInHaltMs - 350) * 0.022);
  const deadAirPenalty = Math.min(12, run.deadAirViolationsTotal * 3);
  return Math.max(12, Math.min(100, Math.round(passComponent + latencyComponent + bargeComponent - deadAirPenalty)));
}

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

  // Hands-free 20-second Auto-Demo state & cancellation refs
  const [demoState, setDemoState] = useState<AutoDemoState>(INITIAL_DEMO_STATE);
  const [highlightWaterfall, setHighlightWaterfall] = useState(false);
  const [highlightScorecard, setHighlightScorecard] = useState(false);
  const [proModalOpen, setProModalOpen] = useState(false);
  const demoRunIdRef = useRef(0);
  const demoTimerRef = useRef<number | null>(null);
  const autoDemoUrlTriggeredRef = useRef(false);

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
  const qaScore = useMemo(() => computeQaScore(currentRun), [currentRun]);

  const stopAutoDemo = useCallback(
    (silent = false) => {
      demoRunIdRef.current += 1;
      if (demoTimerRef.current !== null) {
        window.clearInterval(demoTimerRef.current);
        demoTimerRef.current = null;
      }
      audioControllerRef.current.stop();
      setIsRunning(false);
      setHighlightWaterfall(false);
      setHighlightScorecard(false);
      setDemoState(INITIAL_DEMO_STATE);
      if (!silent) {
        showToast('Auto-Demo stopped — you have full manual control.');
      }
    },
    [showToast]
  );

  const startAutoDemo = useCallback(
    async (triggeredByUserClick = true) => {
      // Cancel any prior demo cleanly
      demoRunIdRef.current += 1;
      const runId = demoRunIdRef.current;
      if (demoTimerRef.current !== null) {
        window.clearInterval(demoTimerRef.current);
        demoTimerRef.current = null;
      }
      audioControllerRef.current.stop();
      setHighlightWaterfall(false);
      setHighlightScorecard(false);

      const isCanceled = () => demoRunIdRef.current !== runId;
      const waitMs = (ms: number) =>
        new Promise<boolean>((resolve) => {
          window.setTimeout(() => resolve(!isCanceled()), ms);
        });

      const totalDurationMs = 20000;
      const startedAt = performance.now();

      demoTimerRef.current = window.setInterval(() => {
        if (isCanceled()) return;
        const elapsedMs = performance.now() - startedAt;
        const pct = Math.min(99, (elapsedMs / totalDurationMs) * 100);
        const sec = Math.min(20, Math.floor(elapsedMs / 1000));
        setDemoState((prev) =>
          prev.active ? { ...prev, progressPct: pct, elapsedSec: sec } : prev
        );
      }, 150);

      const angryId = DEFAULT_SCENARIOS[0].id;
      const baseAngry = DEFAULT_SCENARIOS[0];

      // STEP 1 (0–5s): Load 'Angry Caller on Weak 4G' & animate chaos sliders/toggles into active state
      setExecutionMode('sandbox');
      setAudioSourceType('synthetic');
      setCustomPcm(null);
      setActiveScenarioId(angryId);
      setActiveTab('chaos-lab');
      window.scrollTo({ top: 0, behavior: 'smooth' });

      setDemoState({
        active: true,
        completed: false,
        step: 1,
        headline:
          "Step 1/4: Loading 'Angry Caller on Weak 4G' profile & injecting 340ms network jitter + cafe background noise...",
        detail:
          'Activating G.711 phone compression, ramping 4G jitter up to 340ms, dropping SNR to +3 dB cafe noise, and enabling 16% packet loss.',
        progressPct: 2,
        elapsedSec: 0,
        totalSec: 20,
        finalScore: null,
      });

      const rampStages: ChaosConfig[] = [
        {
          codecEnabled: true,
          noiseProfile: 'call_center',
          snrDb: 14,
          packetLossPct: 4,
          packetLossMode: 'repeat',
          jitterMs: 95,
          bargeInEnabled: true,
          bargeInOffsetMs: 400,
        },
        {
          codecEnabled: true,
          noiseProfile: 'call_center',
          snrDb: 8,
          packetLossPct: 10,
          packetLossMode: 'repeat',
          jitterMs: 220,
          bargeInEnabled: true,
          bargeInOffsetMs: 400,
        },
        {
          codecEnabled: true,
          noiseProfile: 'call_center',
          snrDb: 3,
          packetLossPct: 16,
          packetLossMode: 'repeat',
          jitterMs: 340,
          bargeInEnabled: true,
          bargeInOffsetMs: 400,
        },
      ];

      for (let i = 0; i < rampStages.length; i++) {
        if (isCanceled()) return;
        const cfg = rampStages[i];
        setScenarios((prev) => prev.map((s) => (s.id === angryId ? { ...s, chaos: cfg } : s)));
        if (i === rampStages.length - 1) {
          const demoCleanPcm = generateSyntheticVoicePcm(baseAngry.utteranceText, 16000, baseAngry.seed);
          const demoDsp = await processChaosAudio(demoCleanPcm, 16000, cfg, baseAngry.seed);
          if (isCanceled()) return;
          setDspResult(demoDsp);
          if (triggeredByUserClick) {
            try {
              audioControllerRef.current.play(
                demoDsp.cleanPcm,
                demoDsp.degradedPcm,
                demoDsp.sampleRate,
                'degraded',
                true
              );
            } catch {
              // Gracefully continue visual animation if audio output is restricted
            }
          }
        }
        if (!(await waitMs(i === rampStages.length - 1 ? 2200 : 1300))) return;
      }

      const finalWeak4gChaos = rampStages[rampStages.length - 1];
      const demoScenarios = DEFAULT_SCENARIOS.map((s) =>
        s.id === angryId ? { ...s, chaos: finalWeak4gChaos } : s
      );

      // STEP 2 (5–11s): Running full-duplex audio simulation & measuring turn-taking latency
      setDemoState((prev) => ({
        ...prev,
        step: 2,
        headline: 'Step 2/4: Running full-duplex audio simulation & measuring turn-taking latency...',
        detail:
          'Streaming live PCM waveforms and profiling 20ms RMS voice activity across concurrent virtual callers.',
      }));

      // Let viewer observe the live full-duplex waveform sweep for 2s, then switch to live Stress Runner metrics
      if (!(await waitMs(1800))) return;
      audioControllerRef.current.stop();
      setActiveTab('runner');
      setConcurrency(10);
      setIsRunning(true);
      setProgressDone(0);
      setProgressTotal(10);

      const healthyFaults: FaultInjectionConfig = {
        slowLlmBottleneck: false,
        brokenBargeInHandler: false,
        noiseInducedHallucination: false,
        webhookTimeout: false,
      };
      setFaults(healthyFaults);

      const collected: CallExecutionResult[] = [];
      for (let wave = 0; wave < 3; wave++) {
        if (isCanceled()) return;
        const pair = [wave * 2, wave * 2 + 1];
        const waveResults = await Promise.all(
          pair.map((idx) =>
            executeSandboxCall(demoScenarios[idx % demoScenarios.length], healthyFaults, idx + 1, 10)
          )
        );
        if (isCanceled()) return;
        collected.push(...waveResults);
        setProgressDone(collected.length);

        const waveSnap = summarizeSuiteRun('demo-live-wave', [...collected], 'sandbox', 10, healthyFaults);
        setCurrentRun(waveSnap);
        const angryMatch = collected.find((c) => c.scenarioId === angryId) ?? collected[0];
        if (angryMatch) setSelectedCall(angryMatch);

        if (!(await waitMs(1350))) return;
      }

      // STEP 3 (11–16s): Trigger mid-sentence caller barge-in interruption & highlight collision detector
      const bargeInFaults: FaultInjectionConfig = {
        slowLlmBottleneck: false,
        brokenBargeInHandler: true,
        noiseInducedHallucination: false,
        webhookTimeout: false,
      };
      setFaults(bargeInFaults);
      setHighlightWaterfall(true);

      setDemoState((prev) => ({
        ...prev,
        step: 3,
        headline:
          'Step 3/4: Triggering mid-sentence caller barge-in interruption to test agent overtalk recovery...',
        detail:
          'Injecting caller interruption at +400ms — highlighting live Talk-Over collision & latency spike on the 3-track timeline.',
      }));

      window.setTimeout(() => {
        const wf = document.getElementById('call-waterfall-section');
        wf?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);

      // Run final 2 waves (4 virtual callers) with Broken Barge-In Handler armed so collisions visibly spike
      const collisionCalls: CallExecutionResult[] = [];
      for (let wave = 3; wave < 5; wave++) {
        if (isCanceled()) return;
        const pair = [wave * 2, wave * 2 + 1];
        const waveResults = await Promise.all(
          pair.map((idx) =>
            executeSandboxCall(demoScenarios[idx % demoScenarios.length], bargeInFaults, idx + 1, 10)
          )
        );
        if (isCanceled()) return;
        collisionCalls.push(...waveResults);
        collected.push(...waveResults);
        setProgressDone(collected.length);

        const waveSnap = summarizeSuiteRun('demo-barge-collision', [...collected], 'sandbox', 10, bargeInFaults);
        setCurrentRun(waveSnap);
        const collidedAngry =
          collisionCalls.find((c) => c.scenarioId === angryId) ??
          collisionCalls.find((c) => c.metrics.bargeInHaltMs > 600) ??
          waveResults[0];
        if (collidedAngry) setSelectedCall(collidedAngry);

        if (!(await waitMs(2300))) return;
      }

      if (isCanceled()) return;
      setIsRunning(false);
      setHighlightWaterfall(false);

      // STEP 4 (16–20s): Final QA Scorecard, smooth scroll, and export button highlight
      const finalSnap = summarizeSuiteRun('v1.3-auto-demo', collected, 'sandbox', 10, bargeInFaults);
      setCurrentRun(finalSnap);
      const finalAngryCall =
        collisionCalls.find((c) => c.scenarioId === angryId) ??
        collisionCalls.find((c) => c.metrics.bargeInHaltMs > 600) ??
        collected[0];
      if (finalAngryCall) setSelectedCall(finalAngryCall);

      setSnapshots((prev) => {
        const filtered = prev.filter((s) => s.label !== 'v1.3-auto-demo');
        return [...filtered, finalSnap];
      });

      const finalScore = computeQaScore(finalSnap) ?? 64;
      const worstHalt = finalAngryCall?.metrics.bargeInHaltMs ?? finalSnap.meanBargeInHaltMs;

      if (demoTimerRef.current !== null) {
        window.clearInterval(demoTimerRef.current);
        demoTimerRef.current = null;
      }

      setDemoState({
        active: false,
        completed: true,
        step: 4,
        headline: `Step 4/4: Chaos QA complete — Agent scored ${finalScore}/100 (FAIL: ${worstHalt.toLocaleString()}ms barge-in recovery exceeded 600ms SLA).`,
        detail:
          'Inspect the pass/fail breakdown below, export the JSON QA report, or open Compare & Export to diff against v1.2-prod.',
        progressPct: 100,
        elapsedSec: 20,
        totalSec: 20,
        finalScore,
      });

      setHighlightScorecard(true);
      window.setTimeout(() => {
        const el = document.getElementById('qa-scorecard-section');
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
      window.setTimeout(() => {
        setHighlightScorecard(false);
      }, 5500);
    },
    []
  );

  // Auto-trigger hands-free guided demo if URL contains ?demo=true
  useEffect(() => {
    if (autoDemoUrlTriggeredRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === 'true') {
      autoDemoUrlTriggeredRef.current = true;
      const timer = window.setTimeout(() => {
        void startAutoDemo(false);
      }, 450);
      return () => window.clearTimeout(timer);
    }
  }, [startAutoDemo]);

  // Clean up demo interval on unmount
  useEffect(() => {
    return () => {
      if (demoTimerRef.current !== null) {
        window.clearInterval(demoTimerRef.current);
      }
      audioControllerRef.current.stop();
    };
  }, []);

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
          <nav className="hidden xl:flex items-center gap-1 h-full">
            {NAV_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
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

          {/* Right Header Controls: Book QA Audit + Upgrade to Pro + Theme Toggle + Watch Auto-Demo */}
          <div className="flex items-center gap-2 shrink-0">
            <a
              href="mailto:lakshya2008sharma2008@gmail.com?subject=VoxBench%20Voice%20AI%20Audit"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#151B28] transition-colors whitespace-nowrap shrink-0"
            >
              <Mail className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              Book QA Audit
            </a>

            <button
              type="button"
              onClick={() => setProModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-indigo-200 dark:border-indigo-500/40 bg-indigo-50/80 dark:bg-indigo-500/15 text-[#4F46E5] dark:text-indigo-300 hover:bg-indigo-100/80 dark:hover:bg-indigo-500/25 transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Upgrade to Pro
            </button>

            <button
              type="button"
              onClick={() => setIsDark((d) => !d)}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-lg border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#151B28] transition-colors shrink-0"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {demoState.active ? (
              <button
                type="button"
                onClick={() => stopAutoDemo(false)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 shadow-sm transition-colors whitespace-nowrap shrink-0"
              >
                <Square className="w-3.5 h-3.5" />
                Stop Demo
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startAutoDemo(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-[#4F46E5] text-white hover:bg-[#4338CA] shadow-sm transition-colors whitespace-nowrap shrink-0"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Watch Auto-Demo
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Responsive Mobile / Tablet Tab Bar */}
      <div className="xl:hidden flex items-center justify-between gap-2 overflow-x-auto border-b border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#0D1017] px-4 py-2">
        <div className="flex items-center gap-1">
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

        <a
          href="mailto:lakshya2008sharma2008@gmail.com?subject=VoxBench%20Voice%20AI%20Audit"
          className="sm:hidden inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-[#1E2536] text-slate-700 dark:text-slate-300 whitespace-nowrap shrink-0"
        >
          <Mail className="w-3 h-3" />
          Book QA Audit
        </a>
      </div>

      {/* Main Centered Executive SaaS Viewport */}
      <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
        {/* Executive Self-Explanatory Hero Header, Audience Strip & 3-Step Horizontal Explainer */}
        <section className="mb-6 rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm overflow-hidden">
          <div className="p-5 sm:p-6 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
              <div className="space-y-1.5 max-w-4xl">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 text-balance">
                  VoxBench — Chaos Engineering &amp; QA Workbench for Voice AI
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  Stress-test Vapi, Retell, LiveKit, and Pipecat voice agents against real-world 4G jitter, background street noise, and mid-sentence caller interruptions before production.
                </p>
              </div>
            </div>

            <div className="pt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Built for:</span>
              <span>Voice AI Engineering Teams</span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">•</span>
              <span>AI Automation Agencies</span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">•</span>
              <span>Contact Center QA</span>
            </div>
          </div>

          {/* Compact 3-Step Horizontal Explainer Strip */}
          <div className="grid grid-cols-1 md:grid-cols-3 border-t border-slate-200 dark:border-[#1E2536] divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-[#1E2536] bg-[#F8FAFC] dark:bg-[#0D1017]">
            <div className="px-5 py-3.5">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                <span className="font-mono text-[#4F46E5] dark:text-indigo-400 mr-1.5">01.</span>
                Inject Chaos
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Jitter, packet loss, acoustic noise, Hinglish/accent stress
              </p>
            </div>

            <div className="px-5 py-3.5">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                <span className="font-mono text-[#4F46E5] dark:text-indigo-400 mr-1.5">02.</span>
                Simulate Barge-In
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Test full-duplex interruption &amp; turn-taking recovery
              </p>
            </div>

            <div className="px-5 py-3.5">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                <span className="font-mono text-[#4F46E5] dark:text-indigo-400 mr-1.5">03.</span>
                Ship with Confidence
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Automated P95 latency &amp; collision pass/fail scorecard
              </p>
            </div>
          </div>
        </section>

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
            onExportReport={() => {
              if (!currentRun) return;
              triggerFileDownload(
                buildJsonReport(currentRun),
                `voxbench-qa-report-${currentRun.label.replace(/[^a-z0-9._-]/gi, '_')}.json`,
                'application/json'
              );
              showToast('Downloaded JSON QA report.');
            }}
            qaScore={qaScore}
            highlightWaterfall={highlightWaterfall}
            highlightScorecard={highlightScorecard}
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
            demoAnimate={demoState.active && (demoState.step === 1 || demoState.step === 2)}
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

      {/* Minimal Founder & Contact Footer */}
      <footer
        className={`border-t border-slate-200 dark:border-[#1E2536] bg-white/80 dark:bg-[#0D1017]/80 ${
          demoState.active || demoState.completed ? 'pb-36' : ''
        }`}
      >
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span>Built by Lakshya Sharma</span>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">•</span>
          <span>
            GitHub:{' '}
            <a
              href="https://github.com/Lakshya-dev80/voxbench"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-700 dark:text-slate-300 hover:text-[#4F46E5] dark:hover:text-indigo-400 transition-colors underline-offset-2 hover:underline"
            >
              github.com/Lakshya-dev80/voxbench
            </a>
          </span>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">•</span>
          <span>
            Contact:{' '}
            <a
              href="mailto:lakshya2008sharma2008@gmail.com"
              className="text-slate-700 dark:text-slate-300 hover:text-[#4F46E5] dark:hover:text-indigo-400 transition-colors underline-offset-2 hover:underline"
            >
              lakshya2008sharma2008@gmail.com
            </a>
          </span>
        </div>
      </footer>

      {/* Pro Upgrade Comparison Modal */}
      <ProUpgradeModal open={proModalOpen} onClose={() => setProModalOpen(false)} />

      {/* Sleek Floating Live Walkthrough Banner */}
      <AutoDemoBanner
        demo={demoState}
        onStop={() => stopAutoDemo(false)}
        onReplay={() => void startAutoDemo(true)}
        onDismiss={() => setDemoState(INITIAL_DEMO_STATE)}
      />
    </div>
  );
}
