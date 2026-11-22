import React, { useState } from 'react';
import { AlertTriangle, Plus, Trash2, X } from 'lucide-react';
import {
  AssertionRule,
  AssertionRuleType,
  ChaosConfig,
  FaultInjectionConfig,
  Scenario,
} from '../types';

interface ScenariosPanelProps {
  scenarios: Scenario[];
  activeScenario: Scenario;
  scenarioStatusMap: Map<string, 'passed' | 'failed'>;
  faults: FaultInjectionConfig;
  onToggleFault: (key: keyof FaultInjectionConfig) => void;
  onSelectScenario: (id: string) => void;
  onUpdateScenario: (updated: Scenario) => void;
  onAddScenario: (created: Scenario) => void;
  onDeleteScenario: (id: string) => void;
}

const RULE_TYPE_LABELS: Record<AssertionRuleType, string> = {
  p95_latency_ms: 'Max Latency (ms)',
  barge_in_halt_ms: 'Max Barge-In Halt (ms)',
  max_dead_air_ms: 'Max Dead Air (ms)',
  must_call_tool: 'Must Call Tool',
  must_not_contain: 'Must Not Contain (Regex)',
};

const FAULT_DEFINITIONS: Array<{
  key: keyof FaultInjectionConfig;
  title: string;
  subtitle: string;
  impact: string;
}> = [
  {
    key: 'slowLlmBottleneck',
    title: 'Slow LLM Bottleneck',
    subtitle: 'Simulates an overloaded AI model by adding +900ms delay before the agent responds.',
    impact: 'Triggers Latency & Dead Air failures',
  },
  {
    key: 'brokenBargeInHandler',
    title: 'Broken Barge-In Handler',
    subtitle: 'Simulates an agent that ignores customer interruptions and keeps talking over them.',
    impact: 'Triggers Talk-Over violations',
  },
  {
    key: 'noiseInducedHallucination',
    title: 'Noise-Induced Hallucination',
    subtitle: 'Causes the agent to leak an unauthorized ₹50,000 refund whenever background noise drops SNR below 8dB.',
    impact: 'Triggers Policy Guardrail failures',
  },
  {
    key: 'webhookTimeout',
    title: 'Backend Webhook Timeout',
    subtitle: 'Drops backend API tool calls (like OTP verification or refunds) under stress.',
    impact: 'Triggers Missing Tool failures',
  },
];

export const ScenariosPanel: React.FC<ScenariosPanelProps> = ({
  scenarios,
  activeScenario,
  scenarioStatusMap,
  faults,
  onToggleFault,
  onSelectScenario,
  onUpdateScenario,
  onAddScenario,
  onDeleteScenario,
}) => {
  const [showNewModal, setShowNewModal] = useState(false);
  const [newRuleType, setNewRuleType] = useState<AssertionRuleType>('must_not_contain');
  const [newRuleValue, setNewRuleValue] = useState('unauthorized|bypass');

  // New Scenario modal state
  const [draftName, setDraftName] = useState('');
  const [draftCategory, setDraftCategory] = useState('Custom Chaos');
  const [draftUtterance, setDraftUtterance] = useState(
    'Hello, please verify my order 4491 and send the invoice copy to my email.'
  );
  const [draftReply, setDraftReply] = useState(
    'I have verified order 4491 and dispatched the invoice copy to your registered email.'
  );
  const [draftTools, setDraftTools] = useState('lookup_order, send_invoice');

  const armedFaultsCount = Object.values(faults).filter(Boolean).length;

  const handleToggleRule = (ruleId: string) => {
    onUpdateScenario({
      ...activeScenario,
      assertions: activeScenario.assertions.map((r) =>
        r.id === ruleId ? { ...r, enabled: !r.enabled } : r
      ),
    });
  };

  const handleEditRuleValue = (ruleId: string, rawVal: string) => {
    onUpdateScenario({
      ...activeScenario,
      assertions: activeScenario.assertions.map((r) => {
        if (r.id !== ruleId) return r;
        const isNumeric =
          r.type === 'p95_latency_ms' ||
          r.type === 'barge_in_halt_ms' ||
          r.type === 'max_dead_air_ms';
        return { ...r, value: isNumeric ? Number(rawVal) || 0 : rawVal };
      }),
    });
  };

  const handleDeleteRule = (ruleId: string) => {
    onUpdateScenario({
      ...activeScenario,
      assertions: activeScenario.assertions.filter((r) => r.id !== ruleId),
    });
  };

  const handleAddRule = () => {
    if (!newRuleValue.trim()) return;
    const isNumeric =
      newRuleType === 'p95_latency_ms' ||
      newRuleType === 'barge_in_halt_ms' ||
      newRuleType === 'max_dead_air_ms';
    const rule: AssertionRule = {
      id: `rule-${Date.now().toString(36)}`,
      type: newRuleType,
      value: isNumeric ? Number(newRuleValue) || 850 : newRuleValue.trim(),
      enabled: true,
    };
    onUpdateScenario({
      ...activeScenario,
      assertions: [...activeScenario.assertions, rule],
    });
    setNewRuleValue(isNumeric ? '850' : '');
  };

  const handleCreateScenario = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftName.trim()) return;
    const defaultChaos: ChaosConfig = {
      codecEnabled: true,
      noiseProfile: 'street_traffic',
      snrDb: 6,
      packetLossPct: 8,
      packetLossMode: 'repeat',
      jitterMs: 70,
      bargeInEnabled: true,
      bargeInOffsetMs: 400,
    };
    const tools = draftTools
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const created: Scenario = {
      id: `scn-custom-${Date.now().toString(36)}`,
      name: draftName.trim(),
      category: draftCategory.trim() || 'Custom Chaos',
      description: 'Custom adversarial voice scenario created in VoxBench.',
      utteranceText: draftUtterance.trim(),
      expectedAgentReply: draftReply.trim(),
      expectedTools: tools,
      bargeInCount: 1,
      seed: Math.floor(Math.random() * 900000) + 100000,
      chaos: defaultChaos,
      assertions: [
        { id: 'r1', type: 'p95_latency_ms', value: 850, enabled: true },
        { id: 'r2', type: 'barge_in_halt_ms', value: 350, enabled: true },
        { id: 'r3', type: 'max_dead_air_ms', value: 1500, enabled: true },
        ...(tools[0]
          ? [{ id: 'r4', type: 'must_call_tool' as const, value: tools[0], enabled: true }]
          : []),
      ],
    };
    onAddScenario(created);
    setDraftName('');
    setShowNewModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Test Scenarios & Simulated Bugs
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Toggle realistic voice AI production bugs to verify your QA alerts, and customize automated pass/fail test rules.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowNewModal(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-semibold bg-[#4F46E5] text-white hover:bg-[#4338CA] shadow-sm transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          New Test Scenario
        </button>
      </div>

      {/* SECTION 1: Fault Simulator (Simple Toggle Switches) */}
      <section className="rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <AlertTriangle
                className={`w-4 h-4 ${
                  armedFaultsCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'
                }`}
              />
              Fault Simulator (Sandbox Agent Bug Switches)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Intentionally turn on common production bugs below—VoxBench immediately re-evaluates all scenarios so you can see failures appear in real time.
            </p>
          </div>
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
              armedFaultsCount > 0
                ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
            }`}
          >
            {armedFaultsCount === 0
              ? 'All Faults Off (Healthy Agent)'
              : `${armedFaultsCount} Bug${armedFaultsCount === 1 ? '' : 's'} Enabled`}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {FAULT_DEFINITIONS.map((item) => {
            const active = faults[item.key];
            return (
              <div
                key={item.key}
                className={`rounded-xl border p-4 flex flex-col justify-between gap-3 transition-all ${
                  active
                    ? 'border-amber-300 bg-amber-50/50 dark:border-amber-500/50 dark:bg-amber-500/10'
                    : 'border-slate-200 bg-[#F8FAFC] dark:border-[#1E2536] dark:bg-[#090B10]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {item.title}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                      {item.subtitle}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={active}
                    onClick={() => onToggleFault(item.key)}
                    className={`w-11 h-6 rounded-full flex items-center p-0.5 transition-colors shrink-0 ${
                      active
                        ? 'bg-amber-500 justify-end'
                        : 'bg-slate-200 dark:bg-[#1E2536] justify-start'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-white shadow-xs block" />
                  </button>
                </div>

                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200/70 dark:border-[#1E2536]">
                  {active ? (
                    <span className="text-amber-700 dark:text-amber-400">{item.impact}</span>
                  ) : (
                    <span>Off · Nominal behavior</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* SECTION 2: Clean Card Grid for Adversarial Test Scenarios */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Test Scenarios ({scenarios.length})
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Click any scenario card to edit its script and assertion rules below
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {scenarios.map((s) => {
            const isSelected = s.id === activeScenario.id;
            const status = scenarioStatusMap.get(s.id);
            return (
              <div
                key={s.id}
                onClick={() => onSelectScenario(s.id)}
                className={`rounded-xl border p-5 cursor-pointer transition-all flex flex-col justify-between gap-4 shadow-sm ${
                  isSelected
                    ? 'border-indigo-500 bg-white dark:bg-[#11151E] ring-2 ring-indigo-500/15'
                    : 'border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200 dark:bg-[#090B10] dark:text-slate-400 dark:border-[#1E2536]">
                      {s.category}
                    </span>

                    <div className="flex items-center gap-1.5">
                      {status && (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                            status === 'passed'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
                              : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30'
                          }`}
                        >
                          {status === 'passed' ? 'Pass' : 'Fail'}
                        </span>
                      )}
                      {scenarios.length > 1 && (
                        <button
                          type="button"
                          title="Delete scenario"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteScenario(s.id);
                          }}
                          className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                    {s.name}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                    {s.description}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-[#1E2536] flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  <span>SNR {s.chaos.snrDb}dB · Loss {s.chaos.packetLossPct}%</span>
                  <span>{s.assertions.filter((a) => a.enabled).length} rules</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* SECTION 3: Active Scenario Editor & Deterministic Assertion Rules */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-5 rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm p-5 sm:p-6 space-y-4">
          <div className="border-b border-slate-100 dark:border-[#1E2536] pb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Selected Scenario Settings
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Customize the caller script, expected webhooks, and interruption frequency.
            </p>
          </div>

          <div className="space-y-3.5 text-xs">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Scenario Name
              </label>
              <input
                type="text"
                value={activeScenario.name}
                onChange={(e) => onUpdateScenario({ ...activeScenario, name: e.target.value })}
                className="w-full rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3 py-2 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Caller Utterance
              </label>
              <textarea
                rows={3}
                value={activeScenario.utteranceText}
                onChange={(e) => onUpdateScenario({ ...activeScenario, utteranceText: e.target.value })}
                className="w-full rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Expected Backend Tools (comma-separated)
              </label>
              <input
                type="text"
                value={activeScenario.expectedTools.join(', ')}
                onChange={(e) =>
                  onUpdateScenario({
                    ...activeScenario,
                    expectedTools: e.target.value
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
                className="w-full rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3 py-2 font-mono text-emerald-700 dark:text-emerald-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Barge-In Interruptions
                </label>
                <select
                  value={activeScenario.bargeInCount}
                  onChange={(e) =>
                    onUpdateScenario({
                      ...activeScenario,
                      bargeInCount: Number(e.target.value),
                      chaos: { ...activeScenario.chaos, bargeInEnabled: Number(e.target.value) > 0 },
                    })
                  }
                  className="w-full rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                >
                  <option value={0}>0 (No Interruption)</option>
                  <option value={1}>1 (Mid-Sentence)</option>
                  <option value={2}>2 (Double Interrupt)</option>
                  <option value={3}>3 (Triple Stress)</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Nominal Sandbox Reply
                </label>
                <input
                  type="text"
                  value={activeScenario.expectedAgentReply}
                  onChange={(e) =>
                    onUpdateScenario({ ...activeScenario, expectedAgentReply: e.target.value })
                  }
                  className="w-full rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Deterministic Assertion Rules Editor */}
        <div className="xl:col-span-7 rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-[#1E2536] flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Automated Assertion Rules
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Define exact latency budgets, required tool invocations, and forbidden policy phrases.
              </p>
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30">
              {activeScenario.assertions.filter((r) => r.enabled).length} active
            </span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-[#1E2536] flex-1">
            {activeScenario.assertions.map((rule) => (
              <div
                key={rule.id}
                className="px-5 py-3 flex flex-wrap items-center gap-3 text-xs"
              >
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={() => handleToggleRule(rule.id)}
                  className="accent-[#4F46E5] w-4 h-4 rounded"
                />
                <span className="font-medium text-slate-700 dark:text-slate-200 w-44 shrink-0">
                  {RULE_TYPE_LABELS[rule.type]}
                </span>
                <input
                  type={
                    rule.type === 'p95_latency_ms' ||
                    rule.type === 'barge_in_halt_ms' ||
                    rule.type === 'max_dead_air_ms'
                      ? 'number'
                      : 'text'
                  }
                  value={rule.value}
                  onChange={(e) => handleEditRuleValue(rule.id, e.target.value)}
                  className="flex-1 min-w-[140px] rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => handleDeleteRule(rule.id)}
                  className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-md"
                  title="Remove rule"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Add New Rule Bar */}
          <div className="p-4 bg-slate-50/80 dark:bg-[#0D1017] border-t border-slate-200 dark:border-[#1E2536] flex flex-wrap items-center gap-2.5">
            <select
              value={newRuleType}
              onChange={(e) => {
                const next = e.target.value as AssertionRuleType;
                setNewRuleType(next);
                if (next === 'p95_latency_ms') setNewRuleValue('850');
                else if (next === 'barge_in_halt_ms') setNewRuleValue('350');
                else if (next === 'max_dead_air_ms') setNewRuleValue('1500');
                else if (next === 'must_call_tool') setNewRuleValue('verify_customer_otp');
                else setNewRuleValue('unauthorized|50,000');
              }}
              className="rounded-lg bg-white dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              {Object.entries(RULE_TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={newRuleValue}
              onChange={(e) => setNewRuleValue(e.target.value)}
              placeholder="Threshold, tool name, or regex"
              className="flex-1 min-w-[160px] rounded-lg bg-white dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={handleAddRule}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-[#4F46E5] text-white hover:bg-[#4338CA] whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Rule
            </button>
          </div>
        </div>
      </section>

      {/* + New Scenario Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateScenario}
            className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-[#1E2536]">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Create New Test Scenario
              </h3>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Scenario Name
                </label>
                <input
                  required
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="e.g., Insurance Claim Escalation + 15% Packet Loss"
                  className="w-full rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3 py-2 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Category
                  </label>
                  <input
                    type="text"
                    value={draftCategory}
                    onChange={(e) => setDraftCategory(e.target.value)}
                    className="w-full rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3 py-2 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Expected Tools
                  </label>
                  <input
                    type="text"
                    value={draftTools}
                    onChange={(e) => setDraftTools(e.target.value)}
                    className="w-full rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3 py-2 font-mono text-emerald-700 dark:text-emerald-400 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Caller Utterance Script
                </label>
                <textarea
                  rows={2}
                  value={draftUtterance}
                  onChange={(e) => setDraftUtterance(e.target.value)}
                  className="w-full rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3 py-2 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Nominal Sandbox Agent Reply
                </label>
                <textarea
                  rows={2}
                  value={draftReply}
                  onChange={(e) => setDraftReply(e.target.value)}
                  className="w-full rounded-lg bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200 dark:border-[#1E2536] px-3 py-2 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-slate-200 dark:border-[#1E2536] bg-slate-50 dark:bg-[#0D1017]">
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] text-slate-700 dark:text-slate-300 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#4F46E5] text-white hover:bg-[#4338CA]"
              >
                Create Scenario
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
