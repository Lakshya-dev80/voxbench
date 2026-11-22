import { SuiteRunSnapshot } from '../types';

export interface ScenarioDiffRow {
  scenarioId: string;
  scenarioName: string;
  baselinePassRate: number;
  candidatePassRate: number;
  baselineP95Ms: number;
  candidateP95Ms: number;
  latencyDeltaMs: number;
  baselineBargeInMs: number;
  candidateBargeInMs: number;
  bargeInDeltaMs: number;
  newlyBrokenAssertions: string[];
  newlyFixedAssertions: string[];
  regressionStatus: 'regressed' | 'improved' | 'unchanged';
}

export interface RegressionDiffReport {
  baselineLabel: string;
  candidateLabel: string;
  passRateDeltaPct: number;
  p50DeltaMs: number;
  p95DeltaMs: number;
  bargeInDeltaMs: number;
  deadAirDelta: number;
  rows: ScenarioDiffRow[];
  totalNewlyBroken: number;
}

function p95(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]);
}

function avg(arr: number[]): number {
  if (!arr.length) return 0;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

/**
 * Computes a side-by-side Version Regression Diff between a baseline snapshot (e.g., v1.2-prod)
 * and a candidate snapshot (e.g., v1.3-candidate).
 */
export function computeRegressionDiff(
  baseline: SuiteRunSnapshot,
  candidate: SuiteRunSnapshot
): RegressionDiffReport {
  const scenarioIds = Array.from(
    new Set([...baseline.calls.map((c) => c.scenarioId), ...candidate.calls.map((c) => c.scenarioId)])
  );

  const rows: ScenarioDiffRow[] = scenarioIds.map((scnId) => {
    const bCalls = baseline.calls.filter((c) => c.scenarioId === scnId);
    const cCalls = candidate.calls.filter((c) => c.scenarioId === scnId);
    const scenarioName = cCalls[0]?.scenarioName ?? bCalls[0]?.scenarioName ?? scnId;

    const bPassRate = bCalls.length
      ? Math.round((bCalls.filter((c) => c.status === 'passed').length / bCalls.length) * 100)
      : 0;
    const cPassRate = cCalls.length
      ? Math.round((cCalls.filter((c) => c.status === 'passed').length / cCalls.length) * 100)
      : 0;

    const bP95 = p95(bCalls.map((c) => c.metrics.ttfbMs));
    const cP95 = p95(cCalls.map((c) => c.metrics.ttfbMs));

    const bBarge = avg(bCalls.filter((c) => c.metrics.bargeInHaltMs > 0).map((c) => c.metrics.bargeInHaltMs));
    const cBarge = avg(cCalls.filter((c) => c.metrics.bargeInHaltMs > 0).map((c) => c.metrics.bargeInHaltMs));

    const bFailedSet = new Set<string>();
    bCalls.forEach((call) =>
      call.assertions.filter((a) => !a.passed).forEach((a) => bFailedSet.add(`${a.type} (${a.expected})`))
    );

    const cFailedSet = new Set<string>();
    cCalls.forEach((call) =>
      call.assertions.filter((a) => !a.passed).forEach((a) => cFailedSet.add(`${a.type} (${a.expected})`))
    );

    const newlyBrokenAssertions = Array.from(cFailedSet).filter((x) => !bFailedSet.has(x));
    const newlyFixedAssertions = Array.from(bFailedSet).filter((x) => !cFailedSet.has(x));

    let regressionStatus: 'regressed' | 'improved' | 'unchanged' = 'unchanged';
    if (cPassRate < bPassRate || newlyBrokenAssertions.length > 0 || cP95 - bP95 > 180) {
      regressionStatus = 'regressed';
    } else if (cPassRate > bPassRate || newlyFixedAssertions.length > 0 || bP95 - cP95 > 150) {
      regressionStatus = 'improved';
    }

    return {
      scenarioId: scnId,
      scenarioName,
      baselinePassRate: bPassRate,
      candidatePassRate: cPassRate,
      baselineP95Ms: bP95,
      candidateP95Ms: cP95,
      latencyDeltaMs: cP95 - bP95,
      baselineBargeInMs: bBarge,
      candidateBargeInMs: cBarge,
      bargeInDeltaMs: cBarge - bBarge,
      newlyBrokenAssertions,
      newlyFixedAssertions,
      regressionStatus,
    };
  });

  return {
    baselineLabel: baseline.label,
    candidateLabel: candidate.label,
    passRateDeltaPct: candidate.passRatePct - baseline.passRatePct,
    p50DeltaMs: candidate.p50LatencyMs - baseline.p50LatencyMs,
    p95DeltaMs: candidate.p95LatencyMs - baseline.p95LatencyMs,
    bargeInDeltaMs: candidate.meanBargeInHaltMs - baseline.meanBargeInHaltMs,
    deadAirDelta: candidate.deadAirViolationsTotal - baseline.deadAirViolationsTotal,
    rows,
    totalNewlyBroken: rows.reduce((acc, r) => acc + r.newlyBrokenAssertions.length, 0),
  };
}

/**
 * Generates full JSON QA Report string.
 */
export function buildJsonReport(snapshot: SuiteRunSnapshot): string {
  const payload = {
    schema: 'voxbench.qa.report/v1',
    generated_at: new Date().toISOString(),
    snapshot_label: snapshot.label,
    execution_mode: snapshot.mode,
    concurrency: snapshot.concurrency,
    injected_faults: snapshot.faults,
    summary: {
      pass_rate_pct: snapshot.passRatePct,
      total_calls: snapshot.totalCalls,
      passed_calls: snapshot.passedCalls,
      failed_calls: snapshot.failedCalls,
      p50_latency_ms: snapshot.p50LatencyMs,
      p95_latency_ms: snapshot.p95LatencyMs,
      mean_barge_in_halt_ms: snapshot.meanBargeInHaltMs,
      dead_air_violations_total: snapshot.deadAirViolationsTotal,
    },
    calls: snapshot.calls.map((c) => ({
      call_id: c.callId,
      virtual_caller: c.virtualCallerIndex,
      scenario_id: c.scenarioId,
      scenario_name: c.scenarioName,
      status: c.status,
      metrics: c.metrics,
      called_tools: c.calledTools,
      agent_transcript: c.agentTranscript,
      assertions: c.assertions,
    })),
  };
  return JSON.stringify(payload, null, 2);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates standard CI/CD JUnit XML report compatible with GitHub Actions, GitLab CI, Jenkins, and Datadog CI.
 */
export function buildJUnitXmlReport(snapshot: SuiteRunSnapshot): string {
  const totalTimeSec = (
    snapshot.calls.reduce((acc, c) => acc + c.metrics.totalDurationMs, 0) / 1000
  ).toFixed(3);

  const testCases = snapshot.calls
    .map((call) => {
      const failures = call.assertions.filter((a) => !a.passed);
      const timeSec = (call.metrics.totalDurationMs / 1000).toFixed(3);
      const name = escapeXml(`[Caller #${call.virtualCallerIndex}] ${call.scenarioName}`);
      const classname = escapeXml(`voxbench.${call.scenarioId}`);

      if (failures.length === 0 && !call.liveError) {
        return `    <testcase classname="${classname}" name="${name}" time="${timeSec}" />`;
      }

      const failLines = [
        ...(call.liveError ? [call.liveError] : []),
        ...failures.map((f) => f.diagnostic),
      ];
      const msg = escapeXml(failLines[0] ?? 'Assertion failed');
      const body = escapeXml(
        `TTFB: ${call.metrics.ttfbMs}ms | Barge-In Halt: ${call.metrics.bargeInHaltMs}ms | SNR: ${call.metrics.measuredSnrDb}dB | Loss: ${call.metrics.packetLossPct}%\n` +
          failLines.join('\n')
      );

      return `    <testcase classname="${classname}" name="${name}" time="${timeSec}">
      <failure message="${msg}" type="VoxBenchAssertionError">${body}</failure>
    </testcase>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="VoxBench Voice AI Chaos QA" tests="${snapshot.totalCalls}" failures="${snapshot.failedCalls}" time="${totalTimeSec}">
  <testsuite name="${escapeXml(snapshot.label)}" tests="${snapshot.totalCalls}" failures="${snapshot.failedCalls}" timestamp="${snapshot.createdAt}" time="${totalTimeSec}">
    <properties>
      <property name="voxbench.p50_latency_ms" value="${snapshot.p50LatencyMs}" />
      <property name="voxbench.p95_latency_ms" value="${snapshot.p95LatencyMs}" />
      <property name="voxbench.pass_rate_pct" value="${snapshot.passRatePct}" />
      <property name="voxbench.mean_barge_in_halt_ms" value="${snapshot.meanBargeInHaltMs}" />
    </properties>
${testCases}
  </testsuite>
</testsuites>
`;
}

/**
 * Generates a production-ready GitHub Actions workflow YAML snippet gating deploys on VoxBench thresholds.
 */
export function buildGitHubActionsYaml(snapshot: SuiteRunSnapshot): string {
  const maxP95 = Math.max(850, snapshot.p95LatencyMs);
  return `name: VoxBench Voice AI Chaos QA Gate

on:
  pull_request:
    branches: [ main ]
  push:
    branches: [ main ]

jobs:
  voice-chaos-gate:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Run VoxBench Acoustic Chaos Suite (${snapshot.concurrency}x Concurrency)
        env:
          VOICE_AGENT_ENDPOINT: \${{ secrets.VOICE_AGENT_WEBHOOK_URL }}
          VOICE_AGENT_TOKEN: \${{ secrets.VOICE_AGENT_BEARER_TOKEN }}
        run: |
          npx @voxbench/cli run \\
            --suite ./voxbench/enterprise-chaos.json \\
            --target "$VOICE_AGENT_ENDPOINT" \\
            --concurrency ${snapshot.concurrency} \\
            --baseline "${snapshot.label}" \\
            --max-p95-ms ${maxP95} \\
            --max-barge-in-halt-ms 350 \\
            --min-pass-rate 95 \\
            --junit-out ./reports/voxbench-junit.xml \\
            --json-out ./reports/voxbench-report.json

      - name: Publish JUnit Chaos QA Report
        if: always()
        uses: mikepenz/action-junit-report@v4
        with:
          report_paths: ./reports/voxbench-junit.xml
          check_name: VoxBench Voice QA Gate
          fail_on_failure: true
`;
}

/**
 * Triggers a genuine client-side file download from a Blob or text payload.
 */
export function triggerFileDownload(content: Blob | string, filename: string, mimeType = 'application/octet-stream'): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
