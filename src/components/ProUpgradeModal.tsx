import React, { useEffect } from 'react';
import { Check, Mail, Sparkles, X } from 'lucide-react';

interface ProUpgradeModalProps {
  open: boolean;
  onClose: () => void;
}

const FREE_FEATURES = [
  '100% browser-native Web Audio DSP Chaos Lab',
  'G.711 codec, 4G jitter, packet loss & ambient noise synthesis',
  'Deterministic sandbox stress runner & barge-in simulator',
  'Local JSON, JUnit XML & GitHub Actions workflow exports',
];

const PRO_FEATURES = [
  'Live Vapi, Retell, LiveKit & Pipecat endpoint testing',
  'Real-time WebRTC/SIP audio streaming & barge-in verification',
  'High-concurrency cloud load waves & historical SLA tracking',
  'Priority founder-led Voice AI QA audit & latency tuning',
];

export const ProUpgradeModal: React.FC<ProUpgradeModalProps> = ({ open, onClose }) => {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="voxbench-pro-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45 dark:bg-black/70 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-200 dark:border-[#1E2536] flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#4F46E5] dark:text-indigo-400">
              <Sparkles className="w-3.5 h-3.5" />
              VoxBench Pro Access
            </div>
            <h2
              id="voxbench-pro-modal-title"
              className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100"
            >
              Free Browser Simulator vs. Pro Live Endpoint Testing
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Stress-test production Vapi, Retell, LiveKit, and Pipecat voice agents directly before shipping.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close upgrade modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-[#1A2130] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Comparison Grid */}
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#F8FAFC] dark:bg-[#0B0E15]">
          {/* Free Tier */}
          <div className="rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Free Browser Simulator
                </h3>
                <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200 dark:bg-[#1A2130] dark:text-slate-300 dark:border-[#263044]">
                  Active
                </span>
              </div>

              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  $0
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">/ forever</span>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Zero API keys required. Runs 100% locally in your browser.
              </p>

              <ul className="mt-4 space-y-2.5">
                {FREE_FEATURES.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="mt-6 w-full px-3.5 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-[#1E2536] bg-slate-50 dark:bg-[#0D1017] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#151B28] transition-colors"
            >
              Continue with Free Simulator
            </button>
          </div>

          {/* Pro Tier */}
          <div className="rounded-xl border border-[#4F46E5] dark:border-indigo-500/80 ring-1 ring-indigo-500/15 bg-white dark:bg-[#11151E] p-5 flex flex-col justify-between shadow-sm">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Pro Live Endpoint Testing
                </h3>
                <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30">
                  Recommended
                </span>
              </div>

              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  $29
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">/ mo</span>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                For Vapi, Retell, LiveKit &amp; Pipecat production voice teams.
              </p>

              <ul className="mt-4 space-y-2.5">
                {PRO_FEATURES.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200">
                    <Check className="w-3.5 h-3.5 text-[#4F46E5] dark:text-indigo-400 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <a
              href="mailto:lakshya2008sharma2008@gmail.com?subject=VoxBench%20Pro%20Access"
              className="mt-6 w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-semibold bg-[#4F46E5] text-white hover:bg-[#4338CA] shadow-sm transition-colors text-center"
            >
              <Mail className="w-3.5 h-3.5 shrink-0" />
              Join Pro Waitlist / Request Access
            </a>
          </div>
        </div>

        {/* Subtle Footer Strip */}
        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Need a custom voice agent stress audit?</span>
          <a
            href="mailto:lakshya2008sharma2008@gmail.com?subject=VoxBench%20Voice%20AI%20Audit"
            className="font-medium text-[#4F46E5] dark:text-indigo-400 hover:underline"
          >
            Book QA Audit with Founder →
          </a>
        </div>
      </div>
    </div>
  );
};
