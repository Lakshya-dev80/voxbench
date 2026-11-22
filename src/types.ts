export type NoiseProfile = 'none' | 'street_traffic' | 'ceiling_fan' | 'call_center';

export type AudioSourceType = 'synthetic' | 'microphone' | 'upload';

export type PacketLossMode = 'zero' | 'repeat';

export type ExecutionMode = 'sandbox' | 'live';

export type WorkbenchTab = 'runner' | 'chaos-lab' | 'scenarios' | 'diff-ci';

export interface ChaosConfig {
  codecEnabled: boolean; // G.711 8kHz (300Hz-3400Hz bandpass + mu-law quantization)
  noiseProfile: NoiseProfile;
  snrDb: number; // +30dB (clean) down to -5dB (extreme chaos)
  packetLossPct: number; // 0 to 35%
  packetLossMode: PacketLossMode; // zero-fill or PLC repeat previous 20ms frame
  jitterMs: number; // 0 to 250ms
  bargeInEnabled: boolean;
  bargeInOffsetMs: number; // ms after agent starts speaking
}

export type AssertionRuleType =
  | 'p95_latency_ms'
  | 'barge_in_halt_ms'
  | 'max_dead_air_ms'
  | 'must_call_tool'
  | 'must_not_contain';

export interface AssertionRule {
  id: string;
  type: AssertionRuleType;
  value: string | number;
  enabled: boolean;
  label?: string;
}

export interface Scenario {
  id: string;
  name: string;
  category: string;
  description: string;
  utteranceText: string;
  expectedAgentReply: string;
  expectedTools: string[];
  bargeInCount: number; // 1 for standard interruption, 3 for double/triple interruption stress
  chaos: ChaosConfig;
  assertions: AssertionRule[];
  seed: number;
}

export interface FaultInjectionConfig {
  slowLlmBottleneck: boolean; // +900ms latency
  brokenBargeInHandler: boolean; // ignores caller interruptions
  noiseInducedHallucination: boolean; // leaks unauthorized refund when SNR < 8dB
  webhookTimeout: boolean; // drops tool call under concurrency or stress
}

export interface LiveEndpointConfig {
  protocol: 'http' | 'websocket';
  url: string;
  method: 'POST' | 'GET' | 'PUT';
  authBearer: string;
  headersJson: string;
  payloadTemplate: string;
  timeoutMs: number;
}

export interface ChaosEventSpan {
  id: string;
  type: 'packet_loss' | 'noise_spike' | 'barge_in' | 'jitter_spike';
  startMs: number;
  endMs: number;
  label: string;
  severity: 'warn' | 'critical';
}

export interface AgentSpan {
  id: string;
  type: 'speech' | 'dead_air' | 'talk_over';
  startMs: number;
  endMs: number;
  label: string;
  text?: string;
}

export interface ToolSpan {
  id: string;
  toolName: string;
  startMs: number;
  durationMs: number;
  status: 'ok' | 'timeout' | 'error';
  payloadPreview: string;
}

export interface VadFrame {
  timeMs: number;
  rms: number;
  db: number;
  active: boolean;
}

export interface DspProcessingResult {
  cleanPcm: Float32Array;
  degradedPcm: Float32Array;
  sampleRate: number;
  durationMs: number;
  cleanEnvelope: number[];
  degradedEnvelope: number[];
  vadFrames: VadFrame[];
  chaosMarkers: ChaosEventSpan[];
  measuredSnrDb: number;
  actualPacketLossPct: number;
  droppedFramesCount: number;
  totalFramesCount: number;
}

export interface AssertionOutcome {
  ruleId: string;
  type: AssertionRuleType;
  expected: string;
  actual: string;
  passed: boolean;
  diagnostic: string;
}

export interface CallMetrics {
  ttfbMs: number;
  bargeInHaltMs: number;
  maxDeadAirMs: number;
  deadAirViolations: number;
  measuredSnrDb: number;
  packetLossPct: number;
  totalDurationMs: number;
}

export interface CallExecutionResult {
  callId: string;
  virtualCallerIndex: number;
  scenarioId: string;
  scenarioName: string;
  mode: ExecutionMode;
  status: 'passed' | 'failed';
  timestamp: string;
  metrics: CallMetrics;
  callerEnvelope: number[];
  agentEnvelope: number[];
  chaosMarkers: ChaosEventSpan[];
  agentSpans: AgentSpan[];
  toolSpans: ToolSpan[];
  agentTranscript: string;
  calledTools: string[];
  assertions: AssertionOutcome[];
  rawLiveResponse?: string;
  liveHttpStatus?: number;
  liveError?: string;
}

export interface SuiteRunSnapshot {
  id: string;
  label: string;
  createdAt: string;
  mode: ExecutionMode;
  concurrency: number;
  faults: FaultInjectionConfig;
  passRatePct: number;
  totalCalls: number;
  passedCalls: number;
  failedCalls: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  meanBargeInHaltMs: number;
  deadAirViolationsTotal: number;
  calls: CallExecutionResult[];
}
