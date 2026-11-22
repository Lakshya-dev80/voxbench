import React, { useEffect, useRef, useState } from 'react';
import {
  Download,
  Mic,
  Play,
  Repeat,
  Square,
  Upload,
  Volume2,
} from 'lucide-react';
import {
  AudioSourceType,
  ChaosConfig,
  DspProcessingResult,
  NoiseProfile,
  Scenario,
} from '../types';
import {
  decodeAudioBlobToPcm,
  encodePcmToWav,
  LiveAudioController,
} from '../engine/dspEngine';
import { triggerFileDownload } from '../engine/exporters';
import { OscilloscopeCanvas } from './OscilloscopeCanvas';

interface ChaosLabPanelProps {
  scenarios: Scenario[];
  scenario: Scenario;
  onSelectScenario: (id: string) => void;
  dspResult: DspProcessingResult | null;
  audioSourceType: AudioSourceType;
  uploadedFileName: string | null;
  onAudioSourceTypeChange: (src: AudioSourceType) => void;
  onCustomPcmCaptured: (
    pcm: Float32Array,
    sampleRate: number,
    label: string,
    sourceType: AudioSourceType
  ) => void;
  onChaosChange: (nextChaos: ChaosConfig) => void;
  onUtteranceChange: (nextUtterance: string) => void;
  audioController: LiveAudioController;
  isDark: boolean;
}

const NOISE_OPTIONS: Array<{ id: NoiseProfile; label: string; detail: string }> = [
  { id: 'none', label: 'Quiet Studio', detail: 'No background noise' },
  { id: 'street_traffic', label: 'Street Traffic', detail: 'Engine rumble & horns' },
  { id: 'ceiling_fan', label: 'Ceiling Fan / AC', detail: '50Hz hum & air chop' },
  { id: 'call_center', label: 'Busy Call Center', detail: 'Multi-talker babble' },
];

export const ChaosLabPanel: React.FC<ChaosLabPanelProps> = ({
  scenarios,
  scenario,
  onSelectScenario,
  dspResult,
  audioSourceType,
  uploadedFileName,
  onAudioSourceTypeChange,
  onCustomPcmCaptured,
  onChaosChange,
  onUtteranceChange,
  audioController,
  isDark,
}) => {
  const [auditionMode, setAuditionMode] = useState<'clean' | 'degraded'>('degraded');
  const [isPlaying, setIsPlaying] = useState(false);
  const [loopPlayback, setLoopPlayback] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [isSpeakingTts, setIsSpeakingTts] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      audioController.stop();
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [audioController]);

  const handlePlayToggle = () => {
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
      auditionMode,
      loopPlayback,
      () => setIsPlaying(false)
    );
  };

  const handleAuditionSwitch = (nextMode: 'clean' | 'degraded') => {
    setAuditionMode(nextMode);
    if (isPlaying) {
      audioController.setMode(nextMode);
    }
  };

  const handleBrowserSpeechPreview = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSourceError('Browser SpeechSynthesis is unavailable here; using built-in formant voice synthesizer.');
      return;
    }
    window.speechSynthesis.cancel();
    if (isSpeakingTts) {
      setIsSpeakingTts(false);
      return;
    }
    const utter = new SpeechSynthesisUtterance(scenario.utteranceText);
    utter.rate = 1.02;
    utter.onend = () => setIsSpeakingTts(false);
    utter.onerror = () => setIsSpeakingTts(false);
    setIsSpeakingTts(true);
    window.speechSynthesis.speak(utter);
  };

  const handleStartStopMic = async () => {
    setSourceError(null);
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      if (recordTimerRef.current) {
        window.clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (evt) => {
        if (evt.data.size > 0) recordedChunksRef.current.push(evt.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        try {
          const decoded = await decodeAudioBlobToPcm(blob);
          onCustomPcmCaptured(
            decoded.pcm,
            decoded.sampleRate,
            `mic-recording-${Date.now().toString(36).slice(-4)}.wav`,
            'microphone'
          );
        } catch (err) {
          setSourceError(
            `Failed to decode microphone recording: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      };

      recorder.start();
      setRecordingSeconds(0);
      setIsRecording(true);
      recordTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      setSourceError(
        `Microphone access was blocked or unavailable (${err instanceof Error ? err.message : 'Permission denied'}). You can still use Synthetic Voice or upload a .WAV/.MP3 file.`
      );
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setSourceError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const decoded = await decodeAudioBlobToPcm(file);
      onCustomPcmCaptured(decoded.pcm, decoded.sampleRate, file.name, 'upload');
    } catch {
      setSourceError(`Could not decode "${file.name}". Please choose a valid .wav or .mp3 audio file.`);
    }
    e.target.value = '';
  };

  const handleDownloadWav = () => {
    if (!dspResult) return;
    const pcm = auditionMode === 'clean' ? dspResult.cleanPcm : dspResult.degradedPcm;
    const wavBlob = encodePcmToWav(pcm, dspResult.sampleRate);
    const suffix =
      auditionMode === 'clean'
        ? 'clean'
        : `chaos-snr${scenario.chaos.snrDb}db-loss${scenario.chaos.packetLossPct}pct`;
    triggerFileDownload(wavBlob, `voxbench-${scenario.id}-${suffix}.wav`, 'audio/wav');
  };

  const chaos = scenario.chaos;
  const updateChaos = (patch: Partial<ChaosConfig>) => onChaosChange({ ...chaos, ...patch });

  return (
    <div className="space-y-6">
      {/* Page Title & Active Scenario Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Audio Chaos Lab
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Simulate noisy environments, narrowband phone lines, and cellular packet drops right in your browser.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <label htmlFor="chaos-lab-scenario" className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
            Active Scenario
          </label>
          <select
            id="chaos-lab-scenario"
            value={scenario.id}
            onChange={(e) => onSelectScenario(e.target.value)}
            className="max-w-xs rounded-lg border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-100 shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
          >
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Clean 2-Column Layout: Left = Audio Controls, Right = Live Visualizer & A/B Player */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN (5 cols): Caller Source + Chaos Controls */}
        <div className="xl:col-span-5 space-y-6">
          {/* Card 1: Caller Audio Source */}
          <section className="rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm p-5 sm:p-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                1. Caller Audio Source
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Choose the customer voice sample to pass through the acoustic chaos pipeline.
              </p>
            </div>

            {/* Segmented Source Selector */}
            <div className="grid grid-cols-3 rounded-lg bg-slate-100 dark:bg-[#090B10] p-1 border border-slate-200/60 dark:border-[#1E2536]">
              {(
                [
                  { id: 'synthetic', label: 'Synthetic Voice' },
                  { id: 'microphone', label: 'Record Mic' },
                  { id: 'upload', label: 'Upload File' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onAudioSourceTypeChange(tab.id)}
                  className={`py-1.5 px-2 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                    audioSourceType === tab.id
                      ? 'bg-white dark:bg-[#151B28] text-indigo-600 dark:text-indigo-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {audioSourceType === 'synthetic' && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="utterance-input" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Caller Utterance Text
                  </label>
                  <button
                    type="button"
                    onClick={handleBrowserSpeechPreview}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    {isSpeakingTts ? 'Stop Preview' : 'Read Aloud (TTS)'}
                  </button>
                </div>
                <textarea
                  id="utterance-input"
                  rows={3}
                  value={scenario.utteranceText}
                  onChange={(e) => onUtteranceChange(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-[#1E2536] bg-[#F8FAFC] dark:bg-[#090B10] px-3 py-2.5 text-xs text-slate-800 dark:text-slate-100 leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Generates a deterministic speech-cadence audio buffer completely offline in your browser.
                </p>
              </div>
            )}

            {audioSourceType === 'microphone' && (
              <div className="rounded-lg border border-slate-200 dark:border-[#1E2536] bg-[#F8FAFC] dark:bg-[#090B10] p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Live Microphone Capture
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Speak a real test phrase to inject into the chaos engine.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleStartStopMic}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      isRecording
                        ? 'bg-rose-600 text-white hover:bg-rose-700'
                        : 'bg-[#4F46E5] text-white hover:bg-[#4338CA]'
                    }`}
                  >
                    {isRecording ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                    {isRecording ? `Stop (${recordingSeconds}s)` : 'Record Voice'}
                  </button>
                </div>
                {uploadedFileName && (
                  <div className="text-xs font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-md px-2.5 py-1.5">
                    Loaded: {uploadedFileName}
                  </div>
                )}
              </div>
            )}

            {audioSourceType === 'upload' && (
              <div className="rounded-lg border border-slate-200 dark:border-[#1E2536] bg-[#F8FAFC] dark:bg-[#090B10] p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Upload .WAV or .MP3 Recording
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Decoded locally in-browser—your audio never leaves this device.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-[#4F46E5] text-white hover:bg-[#4338CA] whitespace-nowrap shrink-0"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Choose File
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".wav,.mp3,audio/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>
                {uploadedFileName && (
                  <div className="text-xs font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-md px-2.5 py-1.5">
                    Active file: {uploadedFileName}
                  </div>
                )}
              </div>
            )}

            {sourceError && (
              <div className="rounded-lg border border-rose-200 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                {sourceError}
              </div>
            )}
          </section>

          {/* Card 2: Real-Time DSP Chaos Injectors */}
          <section className="rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm p-5 sm:p-6 space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                2. Real-World Audio Degradation
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Adjust acoustic conditions to stress-test speech recognition and turn-taking.
              </p>
            </div>

            {/* G.711 Telephony Codec Toggle */}
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100 dark:border-[#1E2536]">
              <div>
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Phone Line Codec (G.711 8kHz)
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Compresses voice to narrowband phone line quality (300Hz–3.4kHz) with μ-law grit.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={chaos.codecEnabled}
                onClick={() => updateChaos({ codecEnabled: !chaos.codecEnabled })}
                className={`w-11 h-6 rounded-full flex items-center p-0.5 transition-colors shrink-0 ${
                  chaos.codecEnabled
                    ? 'bg-[#4F46E5] justify-end'
                    : 'bg-slate-200 dark:bg-[#1E2536] justify-start'
                }`}
              >
                <span className="w-5 h-5 rounded-full bg-white shadow-xs block" />
              </button>
            </div>

            {/* Background Noise Profile & SNR */}
            <div className="space-y-3 pb-4 border-b border-slate-100 dark:border-[#1E2536]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Background Environment & SNR
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono tabular-nums font-medium border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30">
                  {chaos.noiseProfile === 'none'
                    ? 'Clean Studio'
                    : `${chaos.snrDb > 0 ? '+' : ''}${chaos.snrDb} dB SNR`}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 -mt-1.5">
                Controls how loud the background noise is compared to the caller's voice.
              </p>

              <div className="grid grid-cols-2 gap-2">
                {NOISE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updateChaos({ noiseProfile: opt.id })}
                    className={`text-left p-2.5 rounded-lg border transition-all ${
                      chaos.noiseProfile === opt.id
                        ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-500/15 dark:border-indigo-400'
                        : 'border-slate-200 dark:border-[#1E2536] bg-[#F8FAFC] dark:bg-[#090B10] hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div
                      className={`text-xs font-medium ${
                        chaos.noiseProfile === opt.id
                          ? 'text-indigo-700 dark:text-indigo-300'
                          : 'text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {opt.label}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {opt.detail}
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-1">
                <span className="text-[11px] font-mono text-slate-500 w-12">-5 dB</span>
                <input
                  type="range"
                  min={-5}
                  max={30}
                  step={1}
                  disabled={chaos.noiseProfile === 'none'}
                  value={chaos.snrDb}
                  onChange={(e) => updateChaos({ snrDb: Number(e.target.value) })}
                  className="flex-1 slider-amber disabled:opacity-40"
                />
                <span className="text-[11px] font-mono text-slate-500 w-12 text-right">+30 dB</span>
              </div>
            </div>

            {/* Cellular Packet Loss */}
            <div className="space-y-2.5 pb-4 border-b border-slate-100 dark:border-[#1E2536]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Cellular Packet Loss
                </span>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono tabular-nums font-medium border ${
                    chaos.packetLossPct >= 12
                      ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30'
                      : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                  }`}
                >
                  {chaos.packetLossPct}% dropped
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 -mt-1">
                Drops random 20ms audio frames to simulate weak mobile reception or crowded towers.
              </p>
              <input
                type="range"
                min={0}
                max={35}
                step={1}
                value={chaos.packetLossPct}
                onChange={(e) => updateChaos({ packetLossPct: Number(e.target.value) })}
                className="w-full slider-crimson"
              />
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Dropped frame handling
                </span>
                <div className="inline-flex rounded-md bg-slate-100 dark:bg-[#090B10] p-0.5 border border-slate-200 dark:border-[#1E2536] text-[11px]">
                  <button
                    type="button"
                    onClick={() => updateChaos({ packetLossMode: 'zero' })}
                    className={`px-2.5 py-0.5 rounded font-medium ${
                      chaos.packetLossMode === 'zero'
                        ? 'bg-white dark:bg-[#151B28] text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    Silence (Zero-Fill)
                  </button>
                  <button
                    type="button"
                    onClick={() => updateChaos({ packetLossMode: 'repeat' })}
                    className={`px-2.5 py-0.5 rounded font-medium ${
                      chaos.packetLossMode === 'repeat'
                        ? 'bg-white dark:bg-[#151B28] text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    Repeat Frame (PLC)
                  </button>
                </div>
              </div>
            </div>

            {/* Network Jitter */}
            <div className="space-y-2 pb-4 border-b border-slate-100 dark:border-[#1E2536]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Network Jitter Spikes
                </span>
                <span className="text-xs font-mono tabular-nums font-medium text-slate-700 dark:text-slate-300">
                  {chaos.jitterMs} ms
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 -mt-1">
                Adds uneven arrival delays that cause speech stutter and slow ASR endpointing.
              </p>
              <input
                type="range"
                min={0}
                max={250}
                step={5}
                value={chaos.jitterMs}
                onChange={(e) => updateChaos({ jitterMs: Number(e.target.value) })}
                className="w-full slider-amber"
              />
            </div>

            {/* Barge-In Trigger */}
            <div className="space-y-2.5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Mid-Sentence Barge-In Trigger
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Tests if the AI stops talking when the customer interrupts mid-response.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={chaos.bargeInEnabled}
                  onClick={() => updateChaos({ bargeInEnabled: !chaos.bargeInEnabled })}
                  className={`w-11 h-6 rounded-full flex items-center p-0.5 transition-colors shrink-0 ${
                    chaos.bargeInEnabled
                      ? 'bg-[#4F46E5] justify-end'
                      : 'bg-slate-200 dark:bg-[#1E2536] justify-start'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-white shadow-xs block" />
                </button>
              </div>
              {chaos.bargeInEnabled && (
                <div className="flex items-center gap-3 pt-1">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">Overlap offset</span>
                  <input
                    type="range"
                    min={150}
                    max={1200}
                    step={50}
                    value={chaos.bargeInOffsetMs}
                    onChange={(e) => updateChaos({ bargeInOffsetMs: Number(e.target.value) })}
                    className="flex-1"
                  />
                  <span className="text-xs font-mono tabular-nums font-medium text-indigo-600 dark:text-indigo-400 w-16 text-right">
                    +{chaos.bargeInOffsetMs}ms
                  </span>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN (7 cols): Live Visualizer, A/B Audition Player & Measured DSP Telemetry */}
        <div className="xl:col-span-7 space-y-6 xl:sticky xl:top-20">
          <section className="rounded-xl border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#11151E] shadow-sm p-5 sm:p-6 space-y-5">
            {/* A/B Player Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-[#1E2536]">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Live A/B Audition & Signal Visualizer
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Toggle between clean and degraded audio mid-playback to hear the exact DSP impact.
                </p>
              </div>

              <button
                type="button"
                onClick={handleDownloadWav}
                disabled={!dspResult}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-[#1E2536] bg-white dark:bg-[#151B28] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:border-indigo-500/50 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                Download Degraded .WAV
              </button>
            </div>

            {/* Playback Transport Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#F8FAFC] dark:bg-[#090B10] border border-slate-200/80 dark:border-[#1E2536] p-3">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handlePlayToggle}
                  disabled={!dspResult}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 shadow-xs ${
                    isPlaying
                      ? 'bg-amber-600 text-white hover:bg-amber-700'
                      : 'bg-[#4F46E5] text-white hover:bg-[#4338CA]'
                  }`}
                >
                  {isPlaying ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  {isPlaying ? 'Stop' : auditionMode === 'clean' ? 'Play Clean Audio' : 'Play Chaos Audio'}
                </button>

                <button
                  type="button"
                  onClick={() => setLoopPlayback((v) => !v)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                    loopPlayback
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-500/15 dark:border-indigo-500/40 dark:text-indigo-300'
                      : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 dark:bg-[#11151E] dark:border-[#1E2536] dark:text-slate-400'
                  }`}
                >
                  <Repeat className="w-3.5 h-3.5" />
                  Loop
                </button>
              </div>

              {/* Instant A/B Switch */}
              <div className="inline-flex rounded-lg bg-slate-200/70 dark:bg-[#11151E] p-1 border border-slate-200/80 dark:border-[#1E2536]">
                <button
                  type="button"
                  onClick={() => handleAuditionSwitch('clean')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                    auditionMode === 'clean'
                      ? 'bg-white dark:bg-[#1E2536] text-emerald-700 dark:text-emerald-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  A · Clean Original
                </button>
                <button
                  type="button"
                  onClick={() => handleAuditionSwitch('degraded')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                    auditionMode === 'degraded'
                      ? 'bg-white dark:bg-[#1E2536] text-indigo-700 dark:text-indigo-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  B · Chaos-Degraded
                </button>
              </div>
            </div>

            {/* Dual Canvas Oscilloscope & Spectrum */}
            <OscilloscopeCanvas
              dspResult={dspResult}
              audioController={audioController}
              isPlaying={isPlaying}
              auditionMode={auditionMode}
              isDark={isDark}
            />

            {/* Measured Signal Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              <div className="rounded-lg border border-slate-200 dark:border-[#1E2536] bg-[#F8FAFC] dark:bg-[#090B10] p-3">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Measured SNR</div>
                <div
                  className={`text-base font-mono font-semibold tabular-nums mt-1 ${
                    (dspResult?.measuredSnrDb ?? 30) < 6
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-slate-900 dark:text-slate-100'
                  }`}
                >
                  {dspResult ? `${dspResult.measuredSnrDb.toFixed(1)} dB` : '--'}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-[#1E2536] bg-[#F8FAFC] dark:bg-[#090B10] p-3">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Packet Loss</div>
                <div
                  className={`text-base font-mono font-semibold tabular-nums mt-1 ${
                    (dspResult?.actualPacketLossPct ?? 0) >= 12
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-900 dark:text-slate-100'
                  }`}
                >
                  {dspResult ? `${dspResult.actualPacketLossPct.toFixed(1)}%` : '--'}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-[#1E2536] bg-[#F8FAFC] dark:bg-[#090B10] p-3">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Dropped Frames</div>
                <div className="text-base font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                  {dspResult ? `${dspResult.droppedFramesCount}/${dspResult.totalFramesCount}` : '--'}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-[#1E2536] bg-[#F8FAFC] dark:bg-[#090B10] p-3">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Audio Length</div>
                <div className="text-base font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                  {dspResult ? `${(dspResult.durationMs / 1000).toFixed(2)}s` : '--'}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
