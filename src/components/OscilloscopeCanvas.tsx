import React, { useEffect, useRef } from 'react';
import { DspProcessingResult } from '../types';
import { LiveAudioController } from '../engine/dspEngine';

interface OscilloscopeCanvasProps {
  dspResult: DspProcessingResult | null;
  audioController: LiveAudioController;
  isPlaying: boolean;
  auditionMode: 'clean' | 'degraded';
  isDark: boolean;
}

export const OscilloscopeCanvas: React.FC<OscilloscopeCanvasProps> = ({
  dspResult,
  audioController,
  isPlaying,
  auditionMode,
  isDark,
}) => {
  const scopeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const specCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let rafId = 0;

    const palette = isDark
      ? {
          bg: '#090B10',
          grid: '#1E2536',
          centerLine: '#334155',
          cleanStroke: '#10B981',
          cleanFill: 'rgba(16, 185, 129, 0.22)',
          chaosStroke: '#3B82F6',
          chaosFill: '#3B82F6',
          amber: '#F59E0B',
          amberSoft: 'rgba(245, 158, 11, 0.16)',
          amberGuide: 'rgba(245, 158, 11, 0.55)',
          roseSoft: 'rgba(244, 63, 94, 0.24)',
          outOfBand: 'rgba(245, 158, 11, 0.5)',
          label: '#94A3B8',
        }
      : {
          bg: '#F8FAFC',
          grid: '#E2E8F0',
          centerLine: '#CBD5E1',
          cleanStroke: '#10B981',
          cleanFill: 'rgba(16, 185, 129, 0.20)',
          chaosStroke: '#2563EB',
          chaosFill: '#2563EB',
          amber: '#D97706',
          amberSoft: 'rgba(217, 119, 6, 0.14)',
          amberGuide: 'rgba(217, 119, 6, 0.55)',
          roseSoft: 'rgba(225, 29, 72, 0.16)',
          outOfBand: 'rgba(217, 119, 6, 0.45)',
          label: '#64748B',
        };

    const renderFrame = () => {
      const scopeCanvas = scopeCanvasRef.current;
      const specCanvas = specCanvasRef.current;
      if (!scopeCanvas || !specCanvas) return;

      const dpr = window.devicePixelRatio || 1;
      const sRect = scopeCanvas.getBoundingClientRect();
      const fRect = specCanvas.getBoundingClientRect();

      if (sRect.width > 0 && sRect.height > 0) {
        const targetW = Math.floor(sRect.width * dpr);
        const targetH = Math.floor(sRect.height * dpr);
        if (scopeCanvas.width !== targetW || scopeCanvas.height !== targetH) {
          scopeCanvas.width = targetW;
          scopeCanvas.height = targetH;
        }
      }
      if (fRect.width > 0 && fRect.height > 0) {
        const targetW = Math.floor(fRect.width * dpr);
        const targetH = Math.floor(fRect.height * dpr);
        if (specCanvas.width !== targetW || specCanvas.height !== targetH) {
          specCanvas.width = targetW;
          specCanvas.height = targetH;
        }
      }

      const sCtx = scopeCanvas.getContext('2d');
      const fCtx = specCanvas.getContext('2d');
      if (!sCtx || !fCtx) return;

      const sw = sRect.width;
      const sh = sRect.height;
      const fw = fRect.width;
      const fh = fRect.height;

      sCtx.save();
      sCtx.scale(dpr, dpr);
      fCtx.save();
      fCtx.scale(dpr, dpr);

      // Clean Canvas Backgrounds
      sCtx.fillStyle = palette.bg;
      sCtx.fillRect(0, 0, sw, sh);
      fCtx.fillStyle = palette.bg;
      fCtx.fillRect(0, 0, fw, fh);

      // Subtle Horizontal & Vertical Gridlines
      sCtx.strokeStyle = palette.grid;
      sCtx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (sh / 4) * i;
        sCtx.beginPath();
        sCtx.moveTo(0, y);
        sCtx.lineTo(sw, y);
        sCtx.stroke();
      }
      for (let i = 1; i < 8; i++) {
        const x = (sw / 8) * i;
        sCtx.beginPath();
        sCtx.moveTo(x, 0);
        sCtx.lineTo(x, sh);
        sCtx.stroke();
      }

      // Center Zero Reference Axis
      sCtx.strokeStyle = palette.centerLine;
      sCtx.beginPath();
      sCtx.moveTo(0, sh / 2);
      sCtx.lineTo(sw, sh / 2);
      sCtx.stroke();

      // Spectrum Gridlines
      fCtx.strokeStyle = palette.grid;
      fCtx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (fh / 4) * i;
        fCtx.beginPath();
        fCtx.moveTo(0, y);
        fCtx.lineTo(fw, y);
        fCtx.stroke();
      }

      const analyser = audioController.getAnalyser();

      if (isPlaying && analyser) {
        // Live Time-Domain Oscilloscope from AnalyserNode
        const timeBuf = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(timeBuf);

        sCtx.lineWidth = 2;
        sCtx.strokeStyle = auditionMode === 'clean' ? palette.cleanStroke : palette.chaosStroke;
        sCtx.beginPath();
        const sliceW = sw / timeBuf.length;
        for (let i = 0; i < timeBuf.length; i++) {
          const v = timeBuf[i] / 128.0;
          const y = (v * sh) / 2;
          if (i === 0) sCtx.moveTo(0, y);
          else sCtx.lineTo(i * sliceW, y);
        }
        sCtx.stroke();

        // Playhead indicator
        const prog = audioController.getProgress();
        if (prog > 0) {
          sCtx.strokeStyle = palette.amber;
          sCtx.lineWidth = 1.5;
          sCtx.beginPath();
          sCtx.moveTo(prog * sw, 0);
          sCtx.lineTo(prog * sw, sh);
          sCtx.stroke();
        }

        // Live FFT Frequency Spectrum
        const freqBuf = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(freqBuf);

        const barCount = 64;
        const binStep = Math.max(1, Math.floor((freqBuf.length * 0.65) / barCount));
        const barW = fw / barCount;

        for (let b = 0; b < barCount; b++) {
          let sum = 0;
          for (let j = 0; j < binStep; j++) {
            sum += freqBuf[b * binStep + j] || 0;
          }
          const avgVal = sum / binStep / 255;
          const barH = Math.max(2, avgVal * (fh - 18));
          const x = b * barW;
          const y = fh - barH;
          const isMidBand = b > 4 && b < 38;

          fCtx.fillStyle =
            auditionMode === 'clean'
              ? isMidBand
                ? '#10B981'
                : '#34D399'
              : avgVal > 0.72
                ? palette.amber
                : palette.chaosFill;
          fCtx.fillRect(x + 1, y, Math.max(1.5, barW - 2.5), barH);
        }
      } else if (dspResult) {
        const { cleanEnvelope, degradedEnvelope, chaosMarkers, durationMs } = dspResult;

        // Highlight packet-loss & noise spike zones
        for (const mk of chaosMarkers) {
          const x1 = (mk.startMs / Math.max(1, durationMs)) * sw;
          const x2 = (mk.endMs / Math.max(1, durationMs)) * sw;
          sCtx.fillStyle = mk.type === 'packet_loss' ? palette.roseSoft : palette.amberSoft;
          sCtx.fillRect(x1, 0, Math.max(2, x2 - x1), sh);
        }

        // Clean reference envelope overlay (subtle emerald)
        const bins = cleanEnvelope.length;
        const stepX = sw / Math.max(1, bins);
        sCtx.fillStyle = palette.cleanFill;
        for (let i = 0; i < bins; i++) {
          const h = cleanEnvelope[i] * (sh * 0.82);
          sCtx.fillRect(i * stepX, (sh - h) / 2, Math.max(1, stepX - 0.8), h);
        }

        // Active audition signal envelope (Royal Blue for chaos, Emerald for clean)
        const activeEnv = auditionMode === 'clean' ? cleanEnvelope : degradedEnvelope;
        sCtx.fillStyle = auditionMode === 'clean' ? palette.cleanStroke : palette.chaosFill;
        for (let i = 0; i < activeEnv.length; i++) {
          const h = Math.max(2, activeEnv[i] * (sh * 0.82));
          sCtx.fillRect(i * stepX, (sh - h) / 2, Math.max(1.5, stepX - 1.2), h);
        }

        // Deterministic DFT Frequency Preview from real PCM buffer
        const pcm = auditionMode === 'clean' ? dspResult.cleanPcm : dspResult.degradedPcm;
        const sr = dspResult.sampleRate;
        const barCount = 58;
        const sampleWindow = Math.min(pcm.length, 2048);
        const startIdx = Math.floor(pcm.length * 0.25);
        const barW = fw / barCount;

        for (let b = 0; b < barCount; b++) {
          const freq = 60 + (b / (barCount - 1)) * 7540;
          let re = 0;
          let im = 0;
          const omega = (2 * Math.PI * freq) / sr;
          for (let n = 0; n < sampleWindow; n += 4) {
            const s = pcm[startIdx + n] || 0;
            const angle = omega * n;
            re += s * Math.cos(angle);
            im -= s * Math.sin(angle);
          }
          const mag = Math.sqrt(re * re + im * im) / (sampleWindow / 4);
          const dbNorm = Math.max(0.04, Math.min(1, (20 * Math.log10(mag + 1e-5) + 64) / 56));
          const barH = dbNorm * (fh - 20);
          const inTelephonyBand = freq >= 300 && freq <= 3400;

          fCtx.fillStyle =
            auditionMode === 'clean'
              ? palette.cleanStroke
              : inTelephonyBand
                ? palette.chaosFill
                : palette.outOfBand;
          fCtx.fillRect(b * barW + 1, fh - barH, Math.max(1.5, barW - 2.5), barH);
        }
      }

      // G.711 Telephony 300Hz – 3.4kHz Band Cutoff Guides
      const x300 = (300 / 7600) * fw;
      const x3400 = (3400 / 7600) * fw;
      fCtx.strokeStyle = palette.amberGuide;
      fCtx.setLineDash([4, 3]);
      fCtx.lineWidth = 1;
      fCtx.beginPath();
      fCtx.moveTo(x300, 0);
      fCtx.lineTo(x300, fh);
      fCtx.moveTo(x3400, 0);
      fCtx.lineTo(x3400, fh);
      fCtx.stroke();
      fCtx.setLineDash([]);

      // Frequency Axis Annotations
      fCtx.fillStyle = palette.label;
      fCtx.font = '10px "JetBrains Mono", monospace';
      fCtx.fillText('300Hz', x300 + 4, 13);
      fCtx.fillText('3.4kHz G.711 Cutoff', x3400 + 5, 13);
      fCtx.fillText('7.6kHz', fw - 44, 13);

      sCtx.restore();
      fCtx.restore();

      if (isPlaying) {
        rafId = window.requestAnimationFrame(renderFrame);
      }
    };

    renderFrame();
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [dspResult, audioController, isPlaying, auditionMode, isDark]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 dark:border-[#1E2536] bg-[#F8FAFC] dark:bg-[#090B10] p-3.5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            Waveform Oscilloscope
          </span>
          <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {isPlaying
              ? 'Live Analyser · 2048 FFT'
              : auditionMode === 'clean'
                ? 'Clean Original (Emerald)'
                : 'Caller Degraded (Blue) · Packet Loss (Rose)'}
          </span>
        </div>
        <canvas ref={scopeCanvasRef} className="w-full h-36 block rounded" />
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-[#1E2536] bg-[#F8FAFC] dark:bg-[#090B10] p-3.5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            Frequency Spectrum Analyzer
          </span>
          <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {auditionMode === 'clean' ? 'Fullband Source' : '300Hz–3.4kHz Telephony Band'}
          </span>
        </div>
        <canvas ref={specCanvasRef} className="w-full h-36 block rounded" />
      </div>
    </div>
  );
};
