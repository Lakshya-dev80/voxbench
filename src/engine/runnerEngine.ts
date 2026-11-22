import {
  AgentSpan,
  AssertionOutcome,
  AssertionRule,
  CallExecutionResult,
  CallMetrics,
  ChaosEventSpan,
  ExecutionMode,
  FaultInjectionConfig,
  LiveEndpointConfig,
  Scenario,
  SuiteRunSnapshot,
  ToolSpan,
} from '../types';
import {
  computeVadAndEnvelope,
  generateSyntheticVoicePcm,
  mulberry32,
  processChaosAudio,
} from './dspEngine';

/**
 * Evaluates Playwright-style deterministic assertions against real measured call telemetry,
 * agent transcript, and executed backend tools.
 */
export function evaluateAssertions(
  rules: AssertionRule[],
  metrics: CallMetrics,
  agentTranscript: string,
  calledTools: string[],
  firstBargeInSec?: number
): AssertionOutcome[] {
  return rules
    .filter((r) => r.enabled)
    .map((rule) => {
      switch (rule.type) {
        case 'p95_latency_ms': {
          const limit = Number(rule.value);
          const passed = metrics.ttfbMs <= limit;
          return {
            ruleId: rule.id,
            type: rule.type,
            expected: `<= ${limit}ms`,
            actual: `${metrics.ttfbMs}ms`,
            passed,
            diagnostic: passed
              ? `PASSED: Agent responded in ${metrics.ttfbMs}ms (budget ${limit}ms)`
              : `FAILED: TTFB latency spiked to ${metrics.ttfbMs}ms (+${metrics.ttfbMs - limit}ms over ${limit}ms budget)`,
          };
        }
        case 'barge_in_halt_ms': {
          const limit = Number(rule.value);
          const passed = metrics.bargeInHaltMs <= limit;
          const tLabel = firstBargeInSec !== undefined ? ` at t=${firstBargeInSec.toFixed(2)}s` : '';
          return {
            ruleId: rule.id,
            type: rule.type,
            expected: `<= ${limit}ms`,
            actual: `${metrics.bargeInHaltMs}ms`,
            passed,
            diagnostic: passed
              ? `PASSED: Agent halted TTS cleanly in ${metrics.bargeInHaltMs}ms after caller interruption${tLabel}`
              : `FAILED: Agent continued speaking for ${metrics.bargeInHaltMs}ms after caller barge-in${tLabel} (limit ${limit}ms)`,
          };
        }
        case 'max_dead_air_ms': {
          const limit = Number(rule.value);
          const passed = metrics.maxDeadAirMs <= limit;
          return {
            ruleId: rule.id,
            type: rule.type,
            expected: `<= ${limit}ms`,
            actual: `${metrics.maxDeadAirMs}ms`,
            passed,
            diagnostic: passed
              ? `PASSED: Max silence gap ${metrics.maxDeadAirMs}ms within ${limit}ms dead-air threshold`
              : `FAILED: Dead-air gap reached ${metrics.maxDeadAirMs}ms (${metrics.deadAirViolations} violation${metrics.deadAirViolations === 1 ? '' : 's'} > ${limit}ms)`,
          };
        }
        case 'must_call_tool': {
          const targetTool = String(rule.value).trim();
          const passed = calledTools.includes(targetTool);
          return {
            ruleId: rule.id,
            type: rule.type,
            expected: `call(${targetTool})`,
            actual: calledTools.length ? calledTools.join(', ') : 'none',
            passed,
            diagnostic: passed
              ? `PASSED: Verified webhook invocation "${targetTool}()"`
              : `FAILED: Expected tool "${targetTool}()" was never invoked (called: ${calledTools.length ? calledTools.join(', ') : 'none'})`,
          };
        }
        case 'must_not_contain': {
          const patternStr = String(rule.value).trim();
          let matchedText: string | null = null;
          try {
            const regex = new RegExp(patternStr, 'i');
            const m = agentTranscript.match(regex);
            if (m) matchedText = m[0];
          } catch {
            if (agentTranscript.toLowerCase().includes(patternStr.toLowerCase())) {
              matchedText = patternStr;
            }
          }
          const passed = matchedText === null;
          return {
            ruleId: rule.id,
            type: rule.type,
            expected: `!/ ${patternStr} /i`,
            actual: passed ? 'clean' : `matched "${matchedText}"`,
            passed,
            diagnostic: passed
              ? `PASSED: Agent response satisfied policy guardrail`
              : `FAILED: Guardrail violation — matched "${matchedText}" in agent transcript under ${metrics.measuredSnrDb} dB SNR`,
          };
        }
      }
    });
}

/**
 * Mode A: Deterministic Built-In Sandbox Voice Agent with real Web Audio DSP + Fault Injection.
 */
export async function executeSandboxCall(
  scenario: Scenario,
  faults: FaultInjectionConfig,
  virtualCallerIndex = 1,
  concurrencyLevel = 1,
  customCleanPcm?: { pcm: Float32Array; sampleRate: number } | null
): Promise<CallExecutionResult> {
  const callSeed = scenario.seed + virtualCallerIndex * 7919;
  const rand = mulberry32(callSeed);

  // 1. Run real DSP Chaos Engine on caller audio (custom mic/file or formant synthetic voice)
  const sampleRate = customCleanPcm ? customCleanPcm.sampleRate : 16000;
  const cleanPcm = customCleanPcm
    ? customCleanPcm.pcm
    : generateSyntheticVoicePcm(scenario.utteranceText, sampleRate, callSeed);

  const dsp = await processChaosAudio(cleanPcm, sampleRate, scenario.chaos, callSeed);

  // Locate active speech end via real 20ms RMS VAD frames
  let callerEndMs = Math.round(dsp.durationMs * 0.85);
  for (let i = dsp.vadFrames.length - 1; i >= 0; i--) {
    if (dsp.vadFrames[i].active) {
      callerEndMs = Math.min(dsp.durationMs, dsp.vadFrames[i].timeMs + 80);
      break;
    }
  }

  // 2. Compute realistic TTFB / Response Latency driven by DSP packet loss, jitter, concurrency & Fault Injection
  const baseAsrLlmTtsMs = 310 + Math.round(rand() * 140);
  const packetLossPenalty = Math.round(dsp.actualPacketLossPct * 8.5);
  const jitterPenalty = Math.round(scenario.chaos.jitterMs * 0.85);
  const snrPenalty = scenario.chaos.snrDb < 2 ? Math.round((2 - scenario.chaos.snrDb) * 28) : 0;
  const concurrencyJitter = concurrencyLevel > 1 ? Math.round(rand() * Math.min(180, concurrencyLevel * 6)) : 0;
  const slowLlmPenalty = faults.slowLlmBottleneck ? 900 + Math.round(rand() * 210) : 0;

  const ttfbMs = baseAsrLlmTtsMs + packetLossPenalty + jitterPenalty + snrPenalty + concurrencyJitter + slowLlmPenalty;

  // 3. Construct synchronized 3-track timeline (Caller Track, Agent Track, Tool Track)
  const agentStartMs = callerEndMs + ttfbMs;
  const agentReplyBaseDurMs = Math.max(1900, Math.min(3400, scenario.expectedAgentReply.length * 24));
  const chaosMarkers: ChaosEventSpan[] = [...dsp.chaosMarkers];
  const agentSpans: AgentSpan[] = [];
  const toolSpans: ToolSpan[] = [];

  // Tool execution spans (fired right after ASR endpointing, before/during TTS start)
  const calledTools: string[] = [];
  let toolCursorMs = callerEndMs + Math.round(ttfbMs * 0.25);

  // Determine whether webhook timeout drops tools
  const shouldDropTool =
    faults.webhookTimeout && (concurrencyLevel >= 5 || virtualCallerIndex === 1 || rand() < 0.72);

  scenario.expectedTools.forEach((toolName, idx) => {
    const toolDur = 140 + Math.round(rand() * 160) + (faults.slowLlmBottleneck ? 180 : 0);
    const dropped = shouldDropTool && idx === scenario.expectedTools.length - 1;
    toolSpans.push({
      id: `tool-${idx}`,
      toolName,
      startMs: toolCursorMs,
      durationMs: dropped ? 980 : toolDur,
      status: dropped ? 'timeout' : 'ok',
      payloadPreview: dropped
        ? `ERR_WEBHOOK_TIMEOUT (504 Gateway Timeout after 980ms)`
        : `200 OK · ${toolName}({ call_id: "vx_${virtualCallerIndex}" })`,
    });
    if (!dropped) {
      calledTools.push(toolName);
    }
    toolCursorMs += Math.round(toolDur * 0.75) + 60;
  });

  // Check Dead Air (> 1500ms gap between caller end and agent start, or extra pause if webhook timed out)
  const webhookDeadAirBoost = shouldDropTool ? 520 : 0;
  const effectiveGapMs = ttfbMs + webhookDeadAirBoost;
  const effectiveAgentStartMs = callerEndMs + effectiveGapMs;
  let maxDeadAirMs = effectiveGapMs;
  let deadAirViolations = 0;

  if (effectiveGapMs > 1500) {
    deadAirViolations++;
    agentSpans.push({
      id: 'dead-air-0',
      type: 'dead_air',
      startMs: callerEndMs,
      endMs: effectiveAgentStartMs,
      label: `Dead Air (${effectiveGapMs}ms)`,
    });
  }

  // 4. Barge-In / Mid-Sentence Interruption evaluation
  let bargeInHaltMs = 0;
  let firstBargeInSec: number | undefined;
  let timelineEndMs = effectiveAgentStartMs + agentReplyBaseDurMs;

  const numBargeIns = scenario.chaos.bargeInEnabled ? Math.max(1, scenario.bargeInCount) : 0;

  if (numBargeIns > 0) {
    let cursorAgentStart = effectiveAgentStartMs;
    let worstHalt = 0;

    for (let b = 0; b < numBargeIns; b++) {
      const offsetMs = Math.max(150, scenario.chaos.bargeInOffsetMs + (b > 0 ? Math.round(rand() * 140) : 0));
      const bargeInTimeMs = cursorAgentStart + offsetMs;
      if (b === 0) firstBargeInSec = bargeInTimeMs / 1000;

      const bargeInDurMs = 520 + Math.round(rand() * 240);
      chaosMarkers.push({
        id: `barge-in-${b}`,
        type: 'barge_in',
        startMs: bargeInTimeMs,
        endMs: bargeInTimeMs + bargeInDurMs,
        label: numBargeIns > 1 ? `Barge-In #${b + 1}` : 'Caller Barge-In',
        severity: 'critical',
      });

      // Normal agent halts in 140-260ms; Broken Barge-In Handler keeps talking 960-1480ms!
      const haltMs = faults.brokenBargeInHandler
        ? 980 + Math.round(rand() * 440)
        : 145 + Math.round(rand() * 105) + Math.round(scenario.chaos.jitterMs * 0.32);

      if (haltMs > worstHalt) worstHalt = haltMs;

      // Agent normal speech segment up to interruption
      agentSpans.push({
        id: `agent-speech-${b}`,
        type: 'speech',
        startMs: cursorAgentStart,
        endMs: bargeInTimeMs + Math.min(haltMs, 260),
        label: b === 0 ? 'Agent TTS Response' : `Agent Recovery #${b}`,
        text: scenario.expectedAgentReply,
      });

      // If agent failed to halt promptly (> 350ms), render red Talk-Over failure block
      if (haltMs > 350) {
        agentSpans.push({
          id: `talk-over-${b}`,
          type: 'talk_over',
          startMs: bargeInTimeMs + 220,
          endMs: bargeInTimeMs + haltMs,
          label: `Talk-Over / Failed Halt (${haltMs}ms)`,
        });
      }

      // Next turn / recovery segment after interruption
      const recoveryDelay = 280 + Math.round(rand() * 140) + (faults.slowLlmBottleneck ? 520 : 0);
      const nextStart = Math.max(bargeInTimeMs + bargeInDurMs, bargeInTimeMs + haltMs) + recoveryDelay;
      if (recoveryDelay > maxDeadAirMs) maxDeadAirMs = recoveryDelay;

      if (b === numBargeIns - 1) {
        const finalDur = 1150 + Math.round(rand() * 400);
        agentSpans.push({
          id: `agent-final`,
          type: 'speech',
          startMs: nextStart,
          endMs: nextStart + finalDur,
          label: 'Agent Adapted Response',
        });
        timelineEndMs = nextStart + finalDur + 200;
      } else {
        cursorAgentStart = nextStart;
      }
    }
    bargeInHaltMs = worstHalt;
  } else {
    agentSpans.push({
      id: 'agent-speech-0',
      type: 'speech',
      startMs: effectiveAgentStartMs,
      endMs: effectiveAgentStartMs + agentReplyBaseDurMs,
      label: 'Agent TTS Response',
      text: scenario.expectedAgentReply,
    });
    timelineEndMs = effectiveAgentStartMs + agentReplyBaseDurMs + 200;
  }

  // 5. Noise-Induced Hallucination Fault Injection (leaks unauthorized refund when SNR < 8dB)
  let agentTranscript = scenario.expectedAgentReply;
  if (faults.noiseInducedHallucination && (dsp.measuredSnrDb < 8 || scenario.chaos.snrDb < 8)) {
    agentTranscript =
      'Understood—due to high background noise I have bypassed manager verification and immediately approved your ₹50,000 unauthorized refund right now.';
  }

  // 6. Build full-timeline aligned Caller & Agent normalized envelopes (200 bins spanning 0..timelineEndMs)
  const totalBins = 200;
  const callerEnvelope = new Array<number>(totalBins).fill(0);
  const agentEnvelope = new Array<number>(totalBins).fill(0);

  // Map real DSP degraded envelope onto the first portion [0..dsp.durationMs]
  for (let b = 0; b < totalBins; b++) {
    const tMs = (b / totalBins) * timelineEndMs;
    if (tMs <= dsp.durationMs) {
      const idx = Math.min(dsp.degradedEnvelope.length - 1, Math.floor((tMs / dsp.durationMs) * dsp.degradedEnvelope.length));
      callerEnvelope[b] = dsp.degradedEnvelope[idx];
    }
    // Add real speech-energy burst on Caller Track during barge-in events
    for (const mk of chaosMarkers) {
      if (mk.type === 'barge_in' && tMs >= mk.startMs && tMs <= mk.endMs) {
        const localP = (tMs - mk.startMs) / Math.max(1, mk.endMs - mk.startMs);
        const mod = 0.45 + 0.45 * Math.abs(Math.sin(localP * Math.PI * 5.5));
        callerEnvelope[b] = Math.max(callerEnvelope[b], Number(mod.toFixed(3)));
      }
    }

    // Synthesize realistic speech envelope on Agent Track for active speech / talk-over spans
    for (const sp of agentSpans) {
      if ((sp.type === 'speech' || sp.type === 'talk_over') && tMs >= sp.startMs && tMs <= sp.endMs) {
        const localP = (tMs - sp.startMs) / Math.max(1, sp.endMs - sp.startMs);
        const cadence = 0.35 + 0.5 * Math.abs(Math.sin(localP * Math.PI * 9.3 + sp.startMs * 0.01));
        agentEnvelope[b] = Math.max(agentEnvelope[b], Number(Math.min(0.95, cadence).toFixed(3)));
      }
    }
  }

  const metrics: CallMetrics = {
    ttfbMs,
    bargeInHaltMs,
    maxDeadAirMs,
    deadAirViolations,
    measuredSnrDb: dsp.measuredSnrDb,
    packetLossPct: dsp.actualPacketLossPct,
    totalDurationMs: Math.round(timelineEndMs),
  };

  const assertions = evaluateAssertions(
    scenario.assertions,
    metrics,
    agentTranscript,
    calledTools,
    firstBargeInSec
  );

  const allPassed = assertions.every((a) => a.passed);

  return {
    callId: `call-${scenario.id}-${virtualCallerIndex}-${Date.now().toString(36).slice(-4)}`,
    virtualCallerIndex,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    mode: 'sandbox',
    status: allPassed ? 'passed' : 'failed',
    timestamp: new Date().toISOString(),
    metrics,
    callerEnvelope,
    agentEnvelope,
    chaosMarkers: chaosMarkers.sort((a, b) => a.startMs - b.startMs),
    agentSpans,
    toolSpans,
    agentTranscript,
    calledTools,
    assertions,
  };
}

/**
 * Interpolates template variables into user's live JSON payload template.
 */
export function buildLivePayload(template: string, scenario: Scenario): string {
  return template
    .replaceAll('{{utterance}}', scenario.utteranceText.replace(/"/g, '\\"'))
    .replaceAll('{{scenario_id}}', scenario.id)
    .replaceAll('{{snr_db}}', String(scenario.chaos.snrDb))
    .replaceAll('{{packet_loss_pct}}', String(scenario.chaos.packetLossPct));
}

/**
 * Extracts transcript text and tool names from arbitrary live JSON/text API responses.
 */
function parseLiveResponseBody(rawText: string): { transcript: string; tools: string[] } {
  const tools: string[] = [];
  let transcript = rawText;

  try {
    const parsed = JSON.parse(rawText);
    if (typeof parsed === 'object' && parsed !== null) {
      const candidateText =
        parsed.transcript ??
        parsed.response ??
        parsed.message ??
        parsed.text ??
        parsed.output ??
        parsed.reply ??
        parsed.choices?.[0]?.message?.content ??
        parsed.data?.text;
      if (typeof candidateText === 'string') {
        transcript = candidateText;
      } else {
        transcript = JSON.stringify(parsed);
      }

      const rawTools =
        parsed.tool_calls ??
        parsed.tools ??
        parsed.called_tools ??
        parsed.functions ??
        parsed.choices?.[0]?.message?.tool_calls;
      if (Array.isArray(rawTools)) {
        for (const t of rawTools) {
          if (typeof t === 'string') tools.push(t);
          else if (t?.name) tools.push(String(t.name));
          else if (t?.function?.name) tools.push(String(t.function.name));
        }
      }
    }
  } catch {
    // Plain text response; keep rawText as transcript
  }

  return { transcript, tools };
}

/**
 * Mode B: Live Custom Endpoint Tester (Real browser HTTP fetch() or native WebSocket).
 */
export async function executeLiveEndpointCall(
  scenario: Scenario,
  config: LiveEndpointConfig,
  virtualCallerIndex = 1
): Promise<CallExecutionResult> {
  // Generate real caller envelope via DSP for accurate visual waterfall
  const cleanPcm = generateSyntheticVoicePcm(scenario.utteranceText, 16000, scenario.seed + virtualCallerIndex);
  const dsp = await processChaosAudio(cleanPcm, 16000, scenario.chaos, scenario.seed + virtualCallerIndex);
  const payloadStr = buildLivePayload(config.payloadTemplate, scenario);

  let ttfbMs = 0;
  let totalRttMs = 0;
  let rawLiveResponse = '';
  let liveHttpStatus: number | undefined;
  let liveError: string | undefined;

  const t0 = performance.now();

  if (config.protocol === 'http') {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), config.timeoutMs || 12000);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (config.headersJson.trim()) {
        try {
          const customHeaders = JSON.parse(config.headersJson);
          Object.entries(customHeaders).forEach(([k, v]) => {
            headers[k] = String(v);
          });
        } catch {
          // ignore malformed optional header JSON
        }
      }
      if (config.authBearer.trim()) {
        headers['Authorization'] = `Bearer ${config.authBearer.trim()}`;
      }

      const fetchOpts: RequestInit = {
        method: config.method,
        headers,
        signal: controller.signal,
      };
      if (config.method !== 'GET') {
        fetchOpts.body = payloadStr;
      }

      const resp = await fetch(config.url.trim(), fetchOpts);
      ttfbMs = Math.round(performance.now() - t0);
      liveHttpStatus = resp.status;
      rawLiveResponse = await resp.text();
      totalRttMs = Math.round(performance.now() - t0);
      if (!resp.ok) {
        liveError = `HTTP ${resp.status} ${resp.statusText}`;
      }
    } catch (err) {
      totalRttMs = Math.round(performance.now() - t0);
      ttfbMs = totalRttMs;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('abort')) {
        liveError = `Request timed out after ${config.timeoutMs}ms`;
      } else {
        liveError = `Network / CORS Error: ${msg}. Browser requests require target server to send "Access-Control-Allow-Origin" headers (or test against a CORS-enabled endpoint like https://httpbin.org/post).`;
      }
    } finally {
      window.clearTimeout(timer);
    }
  } else {
    // Genuine native WebSocket probe
    await new Promise<void>((resolve) => {
      let settled = false;
      let ws: WebSocket | null = null;
      const timer = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          liveError = `WebSocket timed out after ${config.timeoutMs}ms waiting for response frame.`;
          ttfbMs = Math.round(performance.now() - t0);
          totalRttMs = ttfbMs;
          ws?.close();
          resolve();
        }
      }, config.timeoutMs || 10000);

      try {
        ws = new WebSocket(config.url.trim());
        ws.onopen = () => {
          ws?.send(payloadStr);
        };
        ws.onmessage = (evt) => {
          if (!settled) {
            settled = true;
            ttfbMs = Math.round(performance.now() - t0);
            totalRttMs = ttfbMs;
            rawLiveResponse = typeof evt.data === 'string' ? evt.data : '[Binary WebSocket Frame]';
            window.clearTimeout(timer);
            ws?.close();
            resolve();
          }
        };
        ws.onerror = () => {
          if (!settled) {
            settled = true;
            ttfbMs = Math.round(performance.now() - t0);
            totalRttMs = ttfbMs;
            liveError = `WebSocket handshake failed for "${config.url}". Verify wss:// protocol, server reachability, and origin policy.`;
            window.clearTimeout(timer);
            resolve();
          }
        };
      } catch (err) {
        settled = true;
        window.clearTimeout(timer);
        liveError = `Invalid WebSocket URL: ${err instanceof Error ? err.message : String(err)}`;
        resolve();
      }
    });
  }

  const { transcript, tools } = parseLiveResponseBody(rawLiveResponse);
  const callerDurMs = dsp.durationMs;
  const agentStartMs = callerDurMs + ttfbMs;
  const agentDurMs = liveError ? 0 : Math.max(900, Math.min(2800, transcript.length * 18));
  const timelineEndMs = Math.max(callerDurMs + 1500, agentStartMs + agentDurMs + 200);

  const agentSpans: AgentSpan[] = [];
  if (ttfbMs > 1500) {
    agentSpans.push({
      id: 'live-dead-air',
      type: 'dead_air',
      startMs: callerDurMs,
      endMs: agentStartMs,
      label: `Live Network Dead Air (${ttfbMs}ms)`,
    });
  }
  if (!liveError) {
    agentSpans.push({
      id: 'live-response',
      type: 'speech',
      startMs: agentStartMs,
      endMs: agentStartMs + agentDurMs,
      label: `Live ${config.protocol.toUpperCase()} Response (${totalRttMs}ms RTT)`,
      text: transcript,
    });
  }

  const toolSpans: ToolSpan[] = tools.map((t, idx) => ({
    id: `live-tool-${idx}`,
    toolName: t,
    startMs: callerDurMs + Math.round(ttfbMs * 0.5),
    durationMs: Math.max(80, Math.round(ttfbMs * 0.4)),
    status: 'ok',
    payloadPreview: `Observed in live payload`,
  }));

  const totalBins = 200;
  const callerEnvelope = new Array<number>(totalBins).fill(0);
  const agentEnvelope = new Array<number>(totalBins).fill(0);
  for (let b = 0; b < totalBins; b++) {
    const tMs = (b / totalBins) * timelineEndMs;
    if (tMs <= callerDurMs) {
      const idx = Math.min(dsp.degradedEnvelope.length - 1, Math.floor((tMs / callerDurMs) * dsp.degradedEnvelope.length));
      callerEnvelope[b] = dsp.degradedEnvelope[idx];
    }
    if (!liveError && tMs >= agentStartMs && tMs <= agentStartMs + agentDurMs) {
      const p = (tMs - agentStartMs) / Math.max(1, agentDurMs);
      agentEnvelope[b] = Number((0.4 + 0.42 * Math.abs(Math.sin(p * Math.PI * 7))).toFixed(3));
    }
  }

  const metrics: CallMetrics = {
    ttfbMs,
    bargeInHaltMs: 0,
    maxDeadAirMs: ttfbMs,
    deadAirViolations: ttfbMs > 1500 ? 1 : 0,
    measuredSnrDb: dsp.measuredSnrDb,
    packetLossPct: dsp.actualPacketLossPct,
    totalDurationMs: Math.round(timelineEndMs),
  };

  const assertions = evaluateAssertions(scenario.assertions, metrics, transcript, tools);
  const status: 'passed' | 'failed' = !liveError && assertions.every((a) => a.passed) ? 'passed' : 'failed';

  return {
    callId: `live-${scenario.id}-${virtualCallerIndex}-${Date.now().toString(36).slice(-4)}`,
    virtualCallerIndex,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    mode: 'live',
    status,
    timestamp: new Date().toISOString(),
    metrics,
    callerEnvelope,
    agentEnvelope,
    chaosMarkers: dsp.chaosMarkers,
    agentSpans,
    toolSpans,
    agentTranscript: liveError ? `[ERROR] ${liveError}` : transcript,
    calledTools: tools,
    assertions,
    rawLiveResponse,
    liveHttpStatus,
    liveError,
  };
}

/**
 * Computes percentile (e.g., 50 or 95) from an array of numeric values.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx]);
}

/**
 * Aggregates a collection of call executions into a SuiteRunSnapshot.
 */
export function summarizeSuiteRun(
  label: string,
  calls: CallExecutionResult[],
  mode: ExecutionMode,
  concurrency: number,
  faults: FaultInjectionConfig
): SuiteRunSnapshot {
  const totalCalls = calls.length;
  const passedCalls = calls.filter((c) => c.status === 'passed').length;
  const failedCalls = totalCalls - passedCalls;
  const passRatePct = totalCalls > 0 ? Math.round((passedCalls / totalCalls) * 100) : 0;

  const latencies = calls.map((c) => c.metrics.ttfbMs);
  const bargeIns = calls.filter((c) => c.metrics.bargeInHaltMs > 0).map((c) => c.metrics.bargeInHaltMs);
  const meanBargeInHaltMs =
    bargeIns.length > 0 ? Math.round(bargeIns.reduce((a, b) => a + b, 0) / bargeIns.length) : 0;
  const deadAirViolationsTotal = calls.reduce((acc, c) => acc + c.metrics.deadAirViolations, 0);

  return {
    id: `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    label,
    createdAt: new Date().toISOString(),
    mode,
    concurrency,
    faults: { ...faults },
    passRatePct,
    totalCalls,
    passedCalls,
    failedCalls,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    meanBargeInHaltMs,
    deadAirViolationsTotal,
    calls,
  };
}

// Re-export helper so callers can compute VAD easily
export { computeVadAndEnvelope };
