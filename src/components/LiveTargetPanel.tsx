import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  Send,
  XCircle,
} from 'lucide-react';
import {
  CallExecutionResult,
  LiveEndpointConfig,
  Scenario,
} from '../types';
import { buildLivePayload, executeLiveEndpointCall } from '../engine/runnerEngine';

interface LiveTargetPanelProps {
  scenario: Scenario;
  config: LiveEndpointConfig;
  onConfigChange: (next: LiveEndpointConfig) => void;
  onLiveResult: (res: CallExecutionResult) => void;
}

const LIVE_PRESETS: Array<{ label: string; protocol: 'http' | 'websocket'; url: string; method: 'POST' | 'GET' }> = [
  { label: 'HTTP Echo (CORS)', protocol: 'http', url: 'https://httpbin.org/post', method: 'POST' },
  { label: 'JSONPlaceholder API', protocol: 'http', url: 'https://jsonplaceholder.typicode.com/posts', method: 'POST' },
  { label: 'WebSocket Echo', protocol: 'websocket', url: 'wss://ws.postman-echo.com/raw', method: 'POST' },
];

export const LiveTargetPanel: React.FC<LiveTargetPanelProps> = ({
  scenario,
  config,
  onConfigChange,
  onLiveResult,
}) => {
  const [isSending, setIsSending] = useState(false);
  const [lastResult, setLastResult] = useState<CallExecutionResult | null>(null);

  const handleSendProbe = async () => {
    if (!config.url.trim()) return;
    setIsSending(true);
    try {
      const res = await executeLiveEndpointCall(scenario, config, 1);
      setLastResult(res);
      onLiveResult(res);
    } finally {
      setIsSending(false);
    }
  };

  const interpolatedPreview = buildLivePayload(config.payloadTemplate, scenario);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-100 dark:border-[#1E2536]">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 shrink-0">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Live Custom Endpoint Connector
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Send real HTTP or WebSocket requests to your staging voice agent, measure genuine network latency, and validate assertions.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {LIVE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() =>
                  onConfigChange({
                    ...config,
                    protocol: p.protocol,
                    url: p.url,
                    method: p.method,
                  })
                }
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-[#1E2536] bg-[#F8FAFC] dark:bg-[#090B10] text-slate-600 dark:text-slate-300 hover:border-indigo-300 hover:text-indigo-600 dark:hover:border-indigo-500/50 dark:hover:text-indigo-300 transition-colors whitespace-nowrap"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Protocol + Method + URL + Send Bar */}
        <div className="flex flex-col md:flex-row gap-2.5">
          <div className="inline-flex rounded-lg bg-slate-100 dark:bg-[#090B10] p-1 border border-slate-200/70 dark:border-[#1E2536] shrink-0">
            <button
              type="button"
              onClick={() => onConfigChange({ ...config, protocol: 'http' })}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                config.protocol === 'http'
                  ? 'bg-white dark:bg-[#151B28] text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              HTTP
            </button>
            <button
              type="button"
              onClick={() => onConfigChange({ ...config, protocol: 'websocket' })}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                config.protocol === 'websocket'
                  ? 'bg-white dark:bg-[#151B28] text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              WebSocket
            </button>
          </div>

          {config.protocol === 'http' && (
            <select
              value={config.method}
              onChange={(e) =>
                onConfigChange({ ...config, method: e.target.value as 'POST' | 'GET' | 'PUT' })
              }
              className="rounded-lg bg-white dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3 py-2 text-xs font-mono font-semibold text-indigo-600 dark:text-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shrink-0"
            >
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="GET">GET</option>
            </select>
          )}

          <input
            type="text"
            value={config.url}
            onChange={(e) => onConfigChange({ ...config, url: e.target.value })}
            placeholder={
              config.protocol === 'http'
                ? 'https://api.your-voice-agent.com/v1/turn'
                : 'wss://api.your-voice-agent.com/v1/stream'
            }
            className="flex-1 rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3.5 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
          />

          <button
            type="button"
            disabled={isSending || !config.url.trim()}
            onClick={handleSendProbe}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#4F46E5] text-white hover:bg-[#4338CA] disabled:opacity-50 shadow-xs transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            {isSending ? 'Sending Probe...' : 'Send Live Probe'}
          </button>
        </div>

        {/* Auth, Headers, Payload Template */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Authorization Bearer Token
              </label>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">
                Optional token attached directly to your browser request header.
              </p>
              <input
                type="password"
                value={config.authBearer}
                onChange={(e) => onConfigChange({ ...config, authBearer: e.target.value })}
                placeholder="Optional bearer token..."
                className="w-full rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Custom Headers (JSON)
              </label>
              <textarea
                rows={4}
                value={config.headersJson}
                onChange={(e) => onConfigChange({ ...config, headersJson: e.target.value })}
                className="w-full rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                JSON Payload Template
              </label>
              <span className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400">
                {'{{utterance}}'} · {'{{snr_db}}'} · {'{{packet_loss_pct}}'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Variables automatically populate from the currently active test scenario.
            </p>
            <textarea
              rows={7}
              value={config.payloadTemplate}
              onChange={(e) => onConfigChange({ ...config, payloadTemplate: e.target.value })}
              className="w-full rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3 py-2.5 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>
        </div>

        <details className="rounded-lg border border-slate-200 dark:border-[#1E2536] bg-[#F8FAFC] dark:bg-[#090B10]">
          <summary className="px-3.5 py-2.5 text-xs font-medium text-slate-600 dark:text-slate-400 cursor-pointer select-none">
            Preview Resolved JSON Payload for "{scenario.name}"
          </summary>
          <pre className="p-3.5 border-t border-slate-200 dark:border-[#1E2536] text-xs font-mono text-slate-800 dark:text-indigo-300 overflow-x-auto">
            {interpolatedPreview}
          </pre>
        </details>
      </section>

      {/* Live Response Inspector & Deterministic Assertions */}
      {lastResult && (
        <section className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          <div className="xl:col-span-7 rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-[#1E2536] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Raw Endpoint Response
              </h3>
              <div className="flex items-center gap-2.5 text-xs font-mono tabular-nums">
                {lastResult.liveHttpStatus && (
                  <span
                    className={`px-2 py-0.5 rounded-full border text-[11px] font-medium ${
                      lastResult.liveHttpStatus >= 200 && lastResult.liveHttpStatus < 300
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
                        : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30'
                    }`}
                  >
                    HTTP {lastResult.liveHttpStatus}
                  </span>
                )}
                <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
                  TTFB {lastResult.metrics.ttfbMs}ms
                </span>
              </div>
            </div>

            <div className="p-5 space-y-3">
              {lastResult.liveError && (
                <div className="rounded-lg border border-rose-200 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-500/10 p-3.5 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-rose-900 dark:text-rose-300">
                      Network / CORS Diagnostic
                    </div>
                    <p className="mt-0.5 leading-relaxed">{lastResult.liveError}</p>
                  </div>
                </div>
              )}

              <pre className="rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] p-3.5 text-xs font-mono text-slate-800 dark:text-slate-200 max-h-80 overflow-auto whitespace-pre-wrap break-words">
                {lastResult.rawLiveResponse || '(empty response body)'}
              </pre>
            </div>
          </div>

          <div className="xl:col-span-5 rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-[#1E2536] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Assertions on Live Response
              </h3>
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                  lastResult.status === 'passed'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
                    : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30'
                }`}
              >
                {lastResult.status === 'passed' ? 'Passed' : 'Failed'}
              </span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-[#1E2536]">
              {lastResult.assertions.map((a) => (
                <div key={a.ruleId} className="p-4 text-xs flex items-start gap-2.5">
                  {a.passed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between font-mono">
                      <span className="text-slate-800 dark:text-slate-200 font-medium">{a.type}</span>
                      <span className={a.passed ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}>
                        {a.actual}
                      </span>
                    </div>
                    <p className={`mt-1 ${a.passed ? 'text-slate-500 dark:text-slate-400' : 'text-rose-700 dark:text-rose-300'}`}>
                      {a.diagnostic}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
