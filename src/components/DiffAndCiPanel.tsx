import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FileCode2,
  GitCompare,
  Save,
} from 'lucide-react';
import { SuiteRunSnapshot } from '../types';
import {
  buildGitHubActionsYaml,
  buildJsonReport,
  buildJUnitXmlReport,
  computeRegressionDiff,
  triggerFileDownload,
} from '../engine/exporters';

interface DiffAndCiPanelProps {
  snapshots: SuiteRunSnapshot[];
  currentRun: SuiteRunSnapshot | null;
  onSaveSnapshot: (label: string) => void;
}

export const DiffAndCiPanel: React.FC<DiffAndCiPanelProps> = ({
  snapshots,
  currentRun,
  onSaveSnapshot,
}) => {
  const [newLabel, setNewLabel] = useState('v1.3-candidate');
  const [baselineId, setBaselineId] = useState<string>(snapshots[0]?.id ?? '');
  const [candidateId, setCandidateId] = useState<string>(
    snapshots.length > 1 ? snapshots[snapshots.length - 1].id : 'current'
  );
  const [copiedYaml, setCopiedYaml] = useState(false);

  const baselineSnap = snapshots.find((s) => s.id === baselineId) ?? snapshots[0] ?? null;
  const candidateSnap =
    candidateId === 'current'
      ? currentRun
      : snapshots.find((s) => s.id === candidateId) ??
        currentRun ??
        snapshots[snapshots.length - 1] ??
        null;

  const diffReport = useMemo(() => {
    if (!baselineSnap || !candidateSnap) return null;
    return computeRegressionDiff(baselineSnap, candidateSnap);
  }, [baselineSnap, candidateSnap]);

  const exportTarget = candidateSnap ?? currentRun ?? baselineSnap;
  const yamlSnippet = useMemo(
    () => (exportTarget ? buildGitHubActionsYaml(exportTarget) : ''),
    [exportTarget]
  );

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabel.trim() || !currentRun) return;
    onSaveSnapshot(newLabel.trim());
    setNewLabel(`v1.${snapshots.length + 3}-candidate`);
  };

  const handleDownloadJson = () => {
    if (!exportTarget) return;
    triggerFileDownload(
      buildJsonReport(exportTarget),
      `voxbench-qa-report-${exportTarget.label.replace(/[^a-z0-9._-]/gi, '_')}.json`,
      'application/json'
    );
  };

  const handleDownloadJUnit = () => {
    if (!exportTarget) return;
    triggerFileDownload(
      buildJUnitXmlReport(exportTarget),
      `voxbench-junit-${exportTarget.label.replace(/[^a-z0-9._-]/gi, '_')}.xml`,
      'application/xml'
    );
  };

  const handleCopyYaml = async () => {
    if (!yamlSnippet) return;
    try {
      await navigator.clipboard.writeText(yamlSnippet);
      setCopiedYaml(true);
      window.setTimeout(() => setCopiedYaml(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Compare & Export
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Compare voice agent releases side by side to catch latency or safety regressions before shipping, and export CI/CD reports.
        </p>
      </div>

      {/* Snapshot Comparison Bar */}
      <section className="rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm p-5 sm:p-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              Baseline Release
            </label>
            <select
              value={baselineSnap?.id ?? ''}
              onChange={(e) => setBaselineId(e.target.value)}
              className="rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            >
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.passRatePct}% pass · P95 {s.p95LatencyMs}ms)
                </option>
              ))}
            </select>
          </div>

          <div className="pb-2 text-slate-400">
            <GitCompare className="w-4 h-4" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              Candidate Release
            </label>
            <select
              value={candidateId}
              onChange={(e) => setCandidateId(e.target.value)}
              className="rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3 py-2 text-xs font-mono text-indigo-700 dark:text-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            >
              {currentRun && (
                <option value="current">
                  Active Run ({currentRun.passRatePct}% pass · P95 {currentRun.p95LatencyMs}ms)
                </option>
              )}
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.passRatePct}% pass · P95 {s.p95LatencyMs}ms)
                </option>
              ))}
            </select>
          </div>
        </div>

        <form onSubmit={handleSave} className="flex items-center gap-2">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Release tag (e.g. v1.3-rc1)"
            className="w-44 rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            disabled={!currentRun || !newLabel.trim()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-[#4F46E5] text-white hover:bg-[#4338CA] disabled:opacity-40 whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5" />
            Save Snapshot
          </button>
        </form>
      </section>

      {/* 4 Executive Delta Summary Cards */}
      {diffReport && baselineSnap && candidateSnap && (
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
          <div className="rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Pass Rate Change
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-mono tabular-nums font-medium border ${
                  diffReport.passRateDeltaPct < 0
                    ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30'
                    : diffReport.passRateDeltaPct > 0
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
                      : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                }`}
              >
                {diffReport.passRateDeltaPct > 0 ? '+' : ''}
                {diffReport.passRateDeltaPct}%
              </span>
            </div>
            <div className="mt-3 text-2xl font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {baselineSnap.passRatePct}% → {candidateSnap.passRatePct}%
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                P95 Latency Delta
              </span>
              <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {baselineSnap.p95LatencyMs} → {candidateSnap.p95LatencyMs}ms
              </span>
            </div>
            <div
              className={`mt-3 text-2xl font-mono font-semibold tabular-nums ${
                diffReport.p95DeltaMs > 80
                  ? 'text-rose-600 dark:text-rose-400'
                  : diffReport.p95DeltaMs < -50
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {diffReport.p95DeltaMs > 0 ? `+${diffReport.p95DeltaMs}ms` : `${diffReport.p95DeltaMs}ms`}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Barge-In Halt Delta
              </span>
              <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {baselineSnap.meanBargeInHaltMs} → {candidateSnap.meanBargeInHaltMs}ms
              </span>
            </div>
            <div
              className={`mt-3 text-2xl font-mono font-semibold tabular-nums ${
                diffReport.bargeInDeltaMs > 60
                  ? 'text-rose-600 dark:text-rose-400'
                  : diffReport.bargeInDeltaMs < -40
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {diffReport.bargeInDeltaMs > 0
                ? `+${diffReport.bargeInDeltaMs}ms`
                : `${diffReport.bargeInDeltaMs}ms`}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Newly Broken Rules
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                  diffReport.totalNewlyBroken > 0
                    ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
                }`}
              >
                {diffReport.totalNewlyBroken > 0 ? 'Deploy Blocked' : 'Gate Passing'}
              </span>
            </div>
            <div
              className={`mt-3 text-2xl font-mono font-semibold tabular-nums ${
                diffReport.totalNewlyBroken > 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {diffReport.totalNewlyBroken}
            </div>
          </div>
        </section>
      )}

      {/* Side-by-Side Version Comparison Table */}
      {diffReport && (
        <section className="rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-[#1E2536] flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Side-by-Side Version Comparison
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Comparing <span className="font-mono text-slate-700 dark:text-slate-300">{diffReport.baselineLabel}</span> against{' '}
                <span className="font-mono text-indigo-600 dark:text-indigo-400">{diffReport.candidateLabel}</span>
              </p>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {diffReport.rows.length} scenarios
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 dark:bg-[#0D1017] text-[11px] font-medium text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-[#1E2536]">
                <tr>
                  <th className="py-3 px-5">Scenario</th>
                  <th className="py-3 px-3 text-right">Pass Rate</th>
                  <th className="py-3 px-3 text-right">P95 Latency Delta</th>
                  <th className="py-3 px-3 text-right">Barge-In Delta</th>
                  <th className="py-3 px-4">Newly Broken Assertions</th>
                  <th className="py-3 px-5 text-right">Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#1E2536]">
                {diffReport.rows.map((row) => (
                  <tr
                    key={row.scenarioId}
                    className="hover:bg-slate-50/70 dark:hover:bg-[#151B28] transition-colors"
                  >
                    <td className="py-3 px-5 font-medium text-slate-800 dark:text-slate-200 max-w-[260px] truncate">
                      {row.scenarioName}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      <span className="text-slate-400">{row.baselinePassRate}%</span>
                      <span className="mx-1 text-slate-400">→</span>
                      <span
                        className={
                          row.candidatePassRate < row.baselinePassRate
                            ? 'text-rose-600 dark:text-rose-400 font-semibold'
                            : row.candidatePassRate > row.baselinePassRate
                              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                              : 'text-slate-800 dark:text-slate-200'
                        }
                      >
                        {row.candidatePassRate}%
                      </span>
                    </td>
                    <td
                      className={`py-3 px-3 text-right font-mono tabular-nums ${
                        row.latencyDeltaMs > 120
                          ? 'text-rose-600 dark:text-rose-400 font-semibold'
                          : row.latencyDeltaMs < -80
                            ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                            : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {row.latencyDeltaMs > 0 ? `+${row.latencyDeltaMs}ms` : `${row.latencyDeltaMs}ms`}
                    </td>
                    <td
                      className={`py-3 px-3 text-right font-mono tabular-nums ${
                        row.bargeInDeltaMs > 80
                          ? 'text-rose-600 dark:text-rose-400 font-semibold'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {row.bargeInDeltaMs > 0 ? `+${row.bargeInDeltaMs}ms` : `${row.bargeInDeltaMs}ms`}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {row.newlyBrokenAssertions.length > 0 ? (
                        <span className="font-mono text-rose-700 dark:text-rose-300">
                          {row.newlyBrokenAssertions.join(', ')}
                        </span>
                      ) : row.newlyFixedAssertions.length > 0 ? (
                        <span className="font-mono text-emerald-700 dark:text-emerald-400">
                          Fixed: {row.newlyFixedAssertions.join(', ')}
                        </span>
                      ) : (
                        <span className="text-slate-400">No assertion drift</span>
                      )}
                    </td>
                    <td className="py-3 px-5 text-right">
                      {row.regressionStatus === 'regressed' ? (
                        <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold border bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30">
                          Regressed
                        </span>
                      ) : row.regressionStatus === 'improved' ? (
                        <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30">
                          Improved
                        </span>
                      ) : (
                        <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-medium border bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700">
                          Stable
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Production CI/CD Exports */}
      <section className="rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-slate-200 dark:border-[#1E2536]">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 shrink-0">
              <FileCode2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                CI/CD Reports & Deployment Gate
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Download structured QA reports or copy a ready-to-use GitHub Actions workflow to block failing voice deploys.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleDownloadJson}
              disabled={!exportTarget}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#151B28] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:border-indigo-500/50 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              Download JSON Report
            </button>
            <button
              type="button"
              onClick={handleDownloadJUnit}
              disabled={!exportTarget}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#151B28] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:border-indigo-500/50 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              Download JUnit XML
            </button>
            <button
              type="button"
              onClick={handleCopyYaml}
              disabled={!yamlSnippet}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#4F46E5] text-white hover:bg-[#4338CA] disabled:opacity-40 shadow-xs transition-colors whitespace-nowrap"
            >
              {copiedYaml ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedYaml ? 'Copied YAML' : 'Copy GitHub Actions YAML'}
            </button>
          </div>
        </div>

        <div className="p-5">
          <pre className="rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] p-4 text-xs font-mono text-slate-800 dark:text-slate-300 overflow-x-auto leading-relaxed">
            {yamlSnippet}
          </pre>
        </div>
      </section>
    </div>
  );
};
