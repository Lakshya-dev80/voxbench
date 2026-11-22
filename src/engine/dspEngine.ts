import { ChaosConfig, ChaosEventSpan, DspProcessingResult, NoiseProfile, VadFrame } from '../types';

/**
 * Deterministic PRNG (Mulberry32) so DSP noise, packet loss, and jitter are reproducible.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Synthesizes a realistic speech-cadence multi-formant audio signal directly from utterance text.
 * Uses glottal pulse harmonics shaped by vowel formants (F1/F2/F3), consonant bursts,
 * pitch intonation contours, and word/punctuation micro-pauses. Guaranteed offline & deterministic.
 */
export function generateSyntheticVoicePcm(
  utteranceText: string,
  sampleRate = 16000,
  seed = 42
): Float32Array {
  const rand = mulberry32(seed);
  const words = utteranceText
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  // Build syllable segments from words (approx 160-240ms per syllable + pauses)
  interface SyllableSpec {
    durationSec: number;
    voiced: boolean;
    f0: number;
    f1: number;
    f2: number;
    f3: number;
    amplitude: number;
    isPause: boolean;
  }

  const vowelFormants: Array<[number, number, number]> = [
    [730, 1090, 2440], // /a/
    [530, 1840, 2480], // /e/
    [270, 2290, 3010], // /i/
    [570, 840, 2410], // /o/
    [300, 870, 2240], // /u/
    [660, 1720, 2410], // /ae/
  ];

  const segments: SyllableSpec[] = [];
  // Short lead-in silence (120ms)
  segments.push({ durationSec: 0.12, voiced: false, f0: 0, f1: 0, f2: 0, f3: 0, amplitude: 0, isPause: true });

  const basePitch = 135 + rand() * 55; // 135Hz - 190Hz natural speaking voice
  let wordIndex = 0;

  for (const word of words) {
    const clean = word.toLowerCase();
    const syllableCount = Math.max(1, Math.min(4, Math.ceil(clean.replace(/[^a-z0-9]/g, '').length / 3)));

    for (let s = 0; s < syllableCount; s++) {
      // Optional crisp unvoiced onset consonant (25-45ms)
      if (rand() > 0.35) {
        segments.push({
          durationSec: 0.028 + rand() * 0.02,
          voiced: false,
          f0: 0,
          f1: 2400 + rand() * 1400,
          f2: 3800,
          f3: 0,
          amplitude: 0.14 + rand() * 0.08,
          isPause: false,
        });
      }

      const charCode = clean.charCodeAt(s % clean.length) || 97;
      const formant = vowelFormants[charCode % vowelFormants.length];
      const phraseProgress = wordIndex / Math.max(1, words.length);
      const pitchContour = basePitch * (1.06 - 0.14 * phraseProgress + (rand() - 0.5) * 0.12);

      segments.push({
        durationSec: 0.115 + rand() * 0.075,
        voiced: true,
        f0: pitchContour,
        f1: formant[0] * (0.94 + rand() * 0.12),
        f2: formant[1] * (0.94 + rand() * 0.12),
        f3: formant[2] * (0.96 + rand() * 0.08),
        amplitude: 0.62 + rand() * 0.22,
        isPause: false,
      });
    }

    // Pause based on punctuation
    let pauseSec = 0.045 + rand() * 0.035;
    if (word.includes('...') || word.includes('—')) pauseSec = 0.28 + rand() * 0.1;
    else if (/[.,!?]$/.test(word)) pauseSec = 0.18 + rand() * 0.08;

    segments.push({
      durationSec: pauseSec,
      voiced: false,
      f0: 0,
      f1: 0,
      f2: 0,
      f3: 0,
      amplitude: 0,
      isPause: true,
    });
    wordIndex++;
  }

  // Tail silence (180ms)
  segments.push({ durationSec: 0.18, voiced: false, f0: 0, f1: 0, f2: 0, f3: 0, amplitude: 0, isPause: true });

  const totalSec = Math.min(7.2, Math.max(2.6, segments.reduce((acc, s) => acc + s.durationSec, 0)));
  const totalSamples = Math.floor(totalSec * sampleRate);
  const pcm = new Float32Array(totalSamples);

  let cursor = 0;
  let glottalPhase = 0;

  for (const seg of segments) {
    const segSamples = Math.floor(seg.durationSec * sampleRate);
    if (cursor >= totalSamples) break;
    const end = Math.min(totalSamples, cursor + segSamples);
    const len = end - cursor;

    if (seg.isPause) {
      cursor = end;
      continue;
    }

    // Simple 2-pole resonator state for F1 & F2
    const bw1 = 85;
    const bw2 = 120;
    const bw3 = 160;
    const r1 = Math.exp((-Math.PI * bw1) / sampleRate);
    const r2 = Math.exp((-Math.PI * bw2) / sampleRate);
    const r3 = Math.exp((-Math.PI * bw3) / sampleRate);
    const a1_1 = -2 * r1 * Math.cos((2 * Math.PI * seg.f1) / sampleRate);
    const a2_1 = r1 * r1;
    const a1_2 = -2 * r2 * Math.cos((2 * Math.PI * seg.f2) / sampleRate);
    const a2_2 = r2 * r2;
    const a1_3 = -2 * r3 * Math.cos((2 * Math.PI * seg.f3) / sampleRate);
    const a2_3 = r3 * r3;

    let y1_1 = 0, y2_1 = 0;
    let y1_2 = 0, y2_2 = 0;
    let y1_3 = 0, y2_3 = 0;

    for (let i = 0; i < len; i++) {
      const tNorm = i / Math.max(1, len - 1);
      // Smooth Hann-like syllable envelope
      const env = Math.sin(Math.PI * Math.min(1, tNorm * 1.15)) * (1 - 0.15 * tNorm);

      let sample = 0;
      if (seg.voiced) {
        // Subtle vibrato + downward pitch glide
        const instF0 = seg.f0 * (1 + 0.015 * Math.sin(2 * Math.PI * 5.2 * (i / sampleRate)) - 0.04 * tNorm);
        glottalPhase += instF0 / sampleRate;
        if (glottalPhase >= 1) glottalPhase -= 1;

        // Soft Rosenberg-like glottal pulse source
        const glottal = glottalPhase < 0.4 ? Math.sin((Math.PI * glottalPhase) / 0.4) : -0.18 * Math.exp(-(glottalPhase - 0.4) * 6);
        const excitation = glottal + (rand() - 0.5) * 0.06;

        // Parallel formant resonators
        const out1 = excitation * 0.42 - a1_1 * y1_1 - a2_1 * y2_1;
        y2_1 = y1_1;
        y1_1 = out1;

        const out2 = excitation * 0.24 - a1_2 * y1_2 - a2_2 * y2_2;
        y2_2 = y1_2;
        y1_2 = out2;

        const out3 = excitation * 0.12 - a1_3 * y1_3 - a2_3 * y2_3;
        y2_3 = y1_3;
        y1_3 = out3;

        sample = (out1 + out2 + out3) * 0.26 * env * seg.amplitude;
      } else {
        // Unvoiced fricative / plosive consonant burst
        const white = rand() * 2 - 1;
        const out = white * 0.35 - a1_1 * y1_1 - a2_1 * y2_1;
        y2_1 = y1_1;
        y1_1 = out;
        sample = Math.max(-0.5, Math.min(0.5, out * 0.18)) * env * seg.amplitude;
      }

      pcm[cursor + i] = Math.tanh(sample * 1.45);
    }
    cursor = end;
  }

  // Normalize peak to -3 dBFS (~0.70)
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0.001) {
    const scale = 0.72 / peak;
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] *= scale;
    }
  }

  return pcm;
}

/**
 * Generates pure math programmatic ambient noise matching selectable real-world acoustic profiles.
 * Also returns timestamps of prominent noise spikes (e.g. traffic horns) for the Waterfall Track.
 */
function synthesizeAmbientNoise(
  length: number,
  sampleRate: number,
  profile: NoiseProfile,
  seed: number
): { noise: Float32Array; spikes: Array<{ startMs: number; endMs: number; label: string }> } {
  const noise = new Float32Array(length);
  const spikes: Array<{ startMs: number; endMs: number; label: string }> = [];
  if (profile === 'none') return { noise, spikes };

  const rand = mulberry32(seed ^ 0x9e3779b9);

  if (profile === 'street_traffic') {
    // Brown/pink engine rumble + diesel idle + modulated dual-tone auto/truck horn bursts
    let brown = 0;
    let b0 = 0, b1 = 0, b2 = 0;
    const durationMs = (length / sampleRate) * 1000;

    // Schedule 2-3 realistic horn bursts
    const hornCount = Math.max(1, Math.min(3, Math.floor(durationMs / 1500)));
    const horns: Array<{ start: number; end: number; f1: number; f2: number }> = [];
    for (let h = 0; h < hornCount; h++) {
      const startMs = 450 + h * (durationMs / (hornCount + 0.3)) + rand() * 320;
      const durMs = 260 + rand() * 240;
      const endMs = Math.min(durationMs - 100, startMs + durMs);
      horns.push({
        start: Math.floor((startMs / 1000) * sampleRate),
        end: Math.floor((endMs / 1000) * sampleRate),
        f1: 410 + rand() * 90,
        f2: 515 + rand() * 110,
      });
      spikes.push({
        startMs: Math.round(startMs),
        endMs: Math.round(endMs),
        label: 'Traffic Horn Spike',
      });
    }

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const white = rand() * 2 - 1;
      // Brown rumble
      brown = (brown + 0.028 * white) / 1.028;
      // Pink road tire hiss
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.95 * b2 + white * 0.048;
      const pink = (b0 + b1 + b2) * 0.32;
      // Diesel engine idle modulation (58Hz + 116Hz)
      const engine = (Math.sin(2 * Math.PI * 58 * t) * 0.16 + Math.sin(2 * Math.PI * 116 * t) * 0.09) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 1.4 * t));
      let val = brown * 1.9 + pink * 0.55 + engine;

      // Add dual-tone horn bursts
      for (const horn of horns) {
        if (i >= horn.start && i < horn.end) {
          const p = (i - horn.start) / Math.max(1, horn.end - horn.start);
          const env = Math.min(1, p * 12) * Math.min(1, (1 - p) * 12);
          const hSig =
            Math.sin(2 * Math.PI * horn.f1 * t) * 0.45 +
            Math.sin(2 * Math.PI * horn.f2 * t) * 0.38 +
            Math.sin(2 * Math.PI * horn.f1 * 2 * t) * 0.15;
          val += hSig * env * 0.72;
        }
      }
      noise[i] = Math.tanh(val);
    }
  } else if (profile === 'ceiling_fan') {
    // 50Hz / 100Hz / 150Hz mains hum harmonics + rhythmic 4.2Hz blade-chop amplitude modulation
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const white = rand() * 2 - 1;
      lp = lp * 0.92 + white * 0.08;
      const bladeMod = 0.68 + 0.32 * Math.sin(2 * Math.PI * 4.2 * t);
      const hum =
        Math.sin(2 * Math.PI * 50 * t) * 0.42 +
        Math.sin(2 * Math.PI * 100 * t) * 0.28 +
        Math.sin(2 * Math.PI * 150 * t) * 0.14;
      const whoosh = lp * 1.35 * bladeMod;
      noise[i] = Math.tanh(hum * 0.85 + whoosh);
    }
    const durationMs = (length / sampleRate) * 1000;
    if (durationMs > 1200) {
      spikes.push({
        startMs: Math.round(durationMs * 0.35),
        endMs: Math.round(durationMs * 0.52),
        label: '50Hz Hum Resonance',
      });
    }
  } else if (profile === 'call_center') {
    // Multi-talker band-limited speech-like babble (4 independent formant-modulated streams)
    const freqs = [480, 920, 1450, 2100];
    const modRates = [3.7, 4.9, 2.8, 5.4];
    const phases = [rand() * 6, rand() * 6, rand() * 6, rand() * 6];
    let bp1 = 0, bp2 = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const white = rand() * 2 - 1;
      // Band-limit 300Hz-2800Hz
      bp1 = bp1 * 0.84 + white * 0.16;
      bp2 = bp2 * 0.65 + (white - bp1) * 0.35;
      let babble = 0;
      for (let v = 0; v < 4; v++) {
        const syllabicEnv = Math.max(0, Math.sin(2 * Math.PI * modRates[v] * t + phases[v]));
        babble += Math.sin(2 * Math.PI * freqs[v] * t + bp2 * 4.2) * syllabicEnv * 0.22;
      }
      noise[i] = Math.tanh(babble + bp2 * 0.72);
    }
    const durationMs = (length / sampleRate) * 1000;
    spikes.push({
      startMs: Math.round(durationMs * 0.28),
      endMs: Math.round(durationMs * 0.44),
      label: 'Cross-Talk Babble Surge',
    });
  }

  return { noise, spikes };
}

/**
 * Generates ITU-T G.711 mu-law companding + 8-bit quantization WaveShaper curve.
 */
function createMuLawCurve(samples = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  const mu = 255;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    const sign = Math.sign(x);
    const companded = sign * (Math.log(1 + mu * Math.abs(x)) / Math.log(1 + mu));
    // Quantize to 6-7 effective bits for unmistakable G.711 narrowband grit
    const quantized = Math.round(companded * 48) / 48;
    const expanded = sign * (1 / mu) * (Math.pow(1 + mu, Math.abs(quantized)) - 1);
    curve[i] = expanded;
  }
  return curve;
}

/**
 * Runs real OfflineAudioContext G.711 telephony emulation (300Hz HPF + 3400Hz LPF + WaveShaper mu-law).
 */
async function applyG711OfflineCodec(input: Float32Array, sampleRate: number): Promise<Float32Array> {
  try {
    const OfflineCtx = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!OfflineCtx) {
      return applyG711FallbackMath(input, sampleRate);
    }

    const offline = new OfflineCtx(1, input.length, sampleRate);
    const buffer = offline.createBuffer(1, input.length, sampleRate);
    buffer.getChannelData(0).set(input);

    const src = offline.createBufferSource();
    src.buffer = buffer;

    // Cascaded High-Pass 300Hz (24dB/oct telephony band limit)
    const hp1 = offline.createBiquadFilter();
    hp1.type = 'highpass';
    hp1.frequency.value = 300;
    hp1.Q.value = 0.707;

    const hp2 = offline.createBiquadFilter();
    hp2.type = 'highpass';
    hp2.frequency.value = 300;
    hp2.Q.value = 0.707;

    // Cascaded Low-Pass 3400Hz (8kHz telephony Nyquist band limit)
    const lp1 = offline.createBiquadFilter();
    lp1.type = 'lowpass';
    lp1.frequency.value = 3400;
    lp1.Q.value = 0.707;

    const lp2 = offline.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.frequency.value = 3400;
    lp2.Q.value = 0.707;

    // Mu-law WaveShaper quantization
    const shaper = offline.createWaveShaper();
    shaper.curve = createMuLawCurve(1024);
    shaper.oversample = 'none';

    src.connect(hp1);
    hp1.connect(hp2);
    hp2.connect(lp1);
    lp1.connect(lp2);
    lp2.connect(shaper);
    shaper.connect(offline.destination);

    src.start(0);
    const rendered = await offline.startRendering();
    const out = new Float32Array(rendered.getChannelData(0));

    // Emulate 8kHz decimation/sample-and-hold stairstep if sampleRate > 8000
    const step = Math.max(1, Math.round(sampleRate / 8000));
    if (step > 1) {
      for (let i = 0; i < out.length; i += step) {
        const held = out[i];
        for (let j = 1; j < step && i + j < out.length; j++) {
          out[i + j] = held * 0.85 + out[i + j] * 0.15;
        }
      }
    }
    return out;
  } catch {
    return applyG711FallbackMath(input, sampleRate);
  }
}

function applyG711FallbackMath(input: Float32Array, sampleRate: number): Float32Array {
  const out = new Float32Array(input.length);
  const mu = 255;
  let hpPrev = 0, lpPrev = 0;
  const rcHp = 1 / (2 * Math.PI * 300);
  const dt = 1 / sampleRate;
  const alphaHp = rcHp / (rcHp + dt);
  const rcLp = 1 / (2 * Math.PI * 3400);
  const alphaLp = dt / (rcLp + dt);

  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const hp = alphaHp * (hpPrev + x - (i > 0 ? input[i - 1] : 0));
    hpPrev = hp;
    const lp = lpPrev + alphaLp * (hp - lpPrev);
    lpPrev = lp;
    const sign = Math.sign(lp);
    const comp = sign * (Math.log(1 + mu * Math.abs(lp)) / Math.log(1 + mu));
    const q = Math.round(comp * 48) / 48;
    out[i] = sign * (1 / mu) * (Math.pow(1 + mu, Math.abs(q)) - 1);
  }
  return out;
}

/**
 * Computes true RMS of active frames (> -40 dBFS) for accurate SNR calibration.
 */
function computeActiveSpeechRms(pcm: Float32Array, sampleRate: number): number {
  const frameSize = Math.floor(sampleRate * 0.02);
  let sumSq = 0;
  let activeSamples = 0;
  for (let i = 0; i < pcm.length; i += frameSize) {
    const end = Math.min(pcm.length, i + frameSize);
    let fSq = 0;
    for (let j = i; j < end; j++) fSq += pcm[j] * pcm[j];
    const rms = Math.sqrt(fSq / Math.max(1, end - i));
    if (rms > 0.015) {
      sumSq += fSq;
      activeSamples += end - i;
    }
  }
  if (activeSamples === 0) {
    let totalSq = 0;
    for (let i = 0; i < pcm.length; i++) totalSq += pcm[i] * pcm[i];
    return Math.sqrt(totalSq / Math.max(1, pcm.length)) || 0.1;
  }
  return Math.sqrt(sumSq / activeSamples);
}

/**
 * Computes sliding 20ms Energy-Based VAD frames and downsampled visual peak envelope.
 */
export function computeVadAndEnvelope(
  pcm: Float32Array,
  sampleRate: number,
  envelopeBins = 160
): { vadFrames: VadFrame[]; envelope: number[] } {
  const frameSize = Math.max(1, Math.floor(sampleRate * 0.02)); // 20ms frame
  const vadFrames: VadFrame[] = [];

  for (let i = 0; i < pcm.length; i += frameSize) {
    const end = Math.min(pcm.length, i + frameSize);
    let sq = 0;
    for (let j = i; j < end; j++) sq += pcm[j] * pcm[j];
    const rms = Math.sqrt(sq / Math.max(1, end - i));
    const db = rms > 1e-6 ? 20 * Math.log10(rms) : -96;
    vadFrames.push({
      timeMs: Math.round((i / sampleRate) * 1000),
      rms,
      db: Number(db.toFixed(1)),
      active: db > -34,
    });
  }

  const envelope: number[] = [];
  const binSize = Math.max(1, Math.floor(pcm.length / envelopeBins));
  for (let b = 0; b < envelopeBins; b++) {
    const start = b * binSize;
    const end = Math.min(pcm.length, start + binSize);
    let peak = 0;
    for (let j = start; j < end; j++) {
      const a = Math.abs(pcm[j]);
      if (a > peak) peak = a;
    }
    envelope.push(Number(Math.min(1, peak).toFixed(3)));
  }

  return { vadFrames, envelope };
}

/**
 * Full deterministic Web Audio DSP Chaos Pipeline:
 * 1. Mix ambient noise at exact target SNR (dB)
 * 2. Run OfflineAudioContext G.711 8kHz bandpass + mu-law WaveShaper
 * 3. Slice into 20ms telephony frames, apply packet loss (0-35%, zero-fill or PLC repeat) & jitter spikes
 * 4. Compute sliding 20ms RMS VAD + exact chaos event timestamps
 */
export async function processChaosAudio(
  cleanPcm: Float32Array,
  sampleRate: number,
  chaos: ChaosConfig,
  seed = 42
): Promise<DspProcessingResult> {
  const rand = mulberry32(seed ^ 0x517cc1b7);
  const length = cleanPcm.length;
  const durationMs = Math.round((length / sampleRate) * 1000);
  const chaosMarkers: ChaosEventSpan[] = [];

  // Step 1: Ambient Noise Mixing calibrated by real active speech RMS
  const speechRms = computeActiveSpeechRms(cleanPcm, sampleRate);
  let mixed = new Float32Array(cleanPcm);
  let measuredSnrDb = 36.0;

  if (chaos.noiseProfile !== 'none') {
    const { noise, spikes } = synthesizeAmbientNoise(length, sampleRate, chaos.noiseProfile, seed);
    let noiseSq = 0;
    for (let i = 0; i < noise.length; i++) noiseSq += noise[i] * noise[i];
    const rawNoiseRms = Math.sqrt(noiseSq / Math.max(1, noise.length)) || 0.1;

    // Target noise RMS for desired SNR: SNR_dB = 20 * log10(speechRms / noiseRms)
    const targetNoiseRms = speechRms / Math.pow(10, chaos.snrDb / 20);
    const gain = targetNoiseRms / rawNoiseRms;

    let actualNoiseSq = 0;
    for (let i = 0; i < length; i++) {
      const nSample = noise[i] * gain;
      actualNoiseSq += nSample * nSample;
      mixed[i] = Math.tanh(cleanPcm[i] + nSample);
    }
    const actualNoiseRms = Math.sqrt(actualNoiseSq / Math.max(1, length)) || 1e-5;
    measuredSnrDb = Number((20 * Math.log10(speechRms / actualNoiseRms)).toFixed(1));

    spikes.forEach((sp, idx) => {
      chaosMarkers.push({
        id: `noise-spike-${idx}`,
        type: 'noise_spike',
        startMs: sp.startMs,
        endMs: sp.endMs,
        label: sp.label,
        severity: chaos.snrDb < 6 ? 'critical' : 'warn',
      });
    });
  }

  // Step 2: Telephony G.711 8kHz Codec Emulation via real OfflineAudioContext
  let processed = chaos.codecEnabled
    ? await applyG711OfflineCodec(mixed, sampleRate)
    : new Float32Array(mixed);

  // Step 3: Cellular Packet Loss & Jitter Simulator over 20ms telephony frames
  const frameSize = Math.max(1, Math.floor(sampleRate * 0.02)); // 20ms RTP frame
  const totalFramesCount = Math.ceil(length / frameSize);
  let droppedFramesCount = 0;
  const output = new Float32Array(length);

  // Use mild burst correlation (Gilbert-Elliott style) for realistic cellular drops
  const pDrop = Math.max(0, Math.min(0.35, chaos.packetLossPct / 100));
  let inBurst = false;
  let burstStartFrame = -1;

  for (let f = 0; f < totalFramesCount; f++) {
    const start = f * frameSize;
    const end = Math.min(length, start + frameSize);

    let dropFrame = false;
    if (pDrop > 0) {
      if (inBurst) {
        dropFrame = rand() < Math.min(0.55, pDrop * 1.9);
      } else {
        dropFrame = rand() < pDrop * 0.88;
      }
    }

    if (dropFrame) {
      droppedFramesCount++;
      if (!inBurst) {
        inBurst = true;
        burstStartFrame = f;
      }

      if (chaos.packetLossMode === 'zero') {
        for (let i = start; i < end; i++) output[i] = 0;
      } else {
        // PLC: Repeat previous 20ms frame with mild attenuation
        const prevStart = Math.max(0, (f - 1) * frameSize);
        for (let i = start; i < end; i++) {
          const prevIdx = prevStart + (i - start);
          output[i] = prevIdx < start ? output[prevIdx] * 0.84 : 0;
        }
      }
    } else {
      if (inBurst && burstStartFrame >= 0) {
        const sMs = burstStartFrame * 20;
        const eMs = f * 20;
        // Record notable drop bursts for waterfall visualization
        if (chaosMarkers.filter((m) => m.type === 'packet_loss').length < 18) {
          chaosMarkers.push({
            id: `pkt-loss-${burstStartFrame}`,
            type: 'packet_loss',
            startMs: sMs,
            endMs: Math.max(sMs + 20, eMs),
            label: `Packet Loss (${eMs - sMs}ms)`,
            severity: eMs - sMs >= 60 ? 'critical' : 'warn',
          });
        }
        inBurst = false;
        burstStartFrame = -1;
      }
      for (let i = start; i < end; i++) {
        output[i] = processed[i];
      }
    }
  }

  // Apply Jitter Spikes (real micro-buffer delay/stretch disturbances)
  if (chaos.jitterMs >= 30) {
    const jitterSpikes = Math.min(4, Math.max(1, Math.floor(chaos.jitterMs / 55)));
    for (let j = 0; j < jitterSpikes; j++) {
      const centerMs = Math.round(((j + 0.6) / (jitterSpikes + 0.4)) * durationMs);
      const spanMs = Math.min(chaos.jitterMs, 180);
      const startSample = Math.floor((centerMs / 1000) * sampleRate);
      const jitterSamples = Math.floor((spanMs / 1000) * sampleRate);
      const endSample = Math.min(length, startSample + jitterSamples);

      // Subtle micro-stutter buffer hold on the jittered segment
      const holdChunk = Math.max(1, Math.floor(sampleRate * 0.015));
      for (let i = startSample; i < endSample; i++) {
        const offset = (i - startSample) % holdChunk;
        if (startSample + offset < length) {
          output[i] = output[startSample + offset] * 0.7 + output[i] * 0.3;
        }
      }

      chaosMarkers.push({
        id: `jitter-${j}`,
        type: 'jitter_spike',
        startMs: centerMs,
        endMs: Math.min(durationMs, centerMs + spanMs),
        label: `Jitter Spike (+${spanMs}ms)`,
        severity: spanMs > 110 ? 'critical' : 'warn',
      });
    }
  }

  const actualPacketLossPct = Number(((droppedFramesCount / Math.max(1, totalFramesCount)) * 100).toFixed(1));
  const cleanVad = computeVadAndEnvelope(cleanPcm, sampleRate, 160);
  const degradedVad = computeVadAndEnvelope(output, sampleRate, 160);

  return {
    cleanPcm,
    degradedPcm: output,
    sampleRate,
    durationMs,
    cleanEnvelope: cleanVad.envelope,
    degradedEnvelope: degradedVad.envelope,
    vadFrames: degradedVad.vadFrames,
    chaosMarkers: chaosMarkers.sort((a, b) => a.startMs - b.startMs),
    measuredSnrDb,
    actualPacketLossPct,
    droppedFramesCount,
    totalFramesCount,
  };
}

/**
 * Pure TypeScript Client-Side PCM-to-WAV Binary Encoder (16-bit signed PCM, RIFF/WAVE).
 */
export function encodePcmToWav(pcm: Float32Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < pcm.length; i++) {
    const clamped = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Decodes an uploaded WAV/MP3 File or recorded Blob into a mono Float32Array + sampleRate.
 */
export async function decodeAudioBlobToPcm(blob: Blob): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const sampleRate = audioBuffer.sampleRate;
    const len = audioBuffer.length;
    const mono = new Float32Array(len);
    const channels = audioBuffer.numberOfChannels;
    for (let ch = 0; ch < channels; ch++) {
      const data = audioBuffer.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        mono[i] += data[i] / channels;
      }
    }
    return { pcm: mono, sampleRate };
  } finally {
    await ctx.close();
  }
}

/**
 * Live Web Audio Playback Engine with seamless A/B Clean vs Chaos switching and AnalyserNode.
 */
export class LiveAudioController {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private cleanSource: AudioBufferSourceNode | null = null;
  private degradedSource: AudioBufferSourceNode | null = null;
  private cleanGain: GainNode | null = null;
  private degradedGain: GainNode | null = null;
  private isPlaying = false;
  private startTime = 0;
  private duration = 0;
  private activeMode: 'clean' | 'degraded' = 'degraded';
  private onEndedCallback: (() => void) | null = null;

  private ensureContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.78;
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  public getPlayingState(): boolean {
    return this.isPlaying;
  }

  public getProgress(): number {
    if (!this.isPlaying || !this.ctx || this.duration <= 0) return 0;
    const elapsed = this.ctx.currentTime - this.startTime;
    return Math.max(0, Math.min(1, elapsed / this.duration));
  }

  public play(
    cleanPcm: Float32Array,
    degradedPcm: Float32Array,
    sampleRate: number,
    mode: 'clean' | 'degraded',
    loop = false,
    onEnded?: () => void
  ): void {
    this.stop();
    const ctx = this.ensureContext();
    this.activeMode = mode;
    this.onEndedCallback = onEnded ?? null;

    const cleanBuf = ctx.createBuffer(1, cleanPcm.length, sampleRate);
    cleanBuf.getChannelData(0).set(cleanPcm);

    const degBuf = ctx.createBuffer(1, degradedPcm.length, sampleRate);
    degBuf.getChannelData(0).set(degradedPcm);

    const cleanSrc = ctx.createBufferSource();
    cleanSrc.buffer = cleanBuf;
    cleanSrc.loop = loop;

    const degSrc = ctx.createBufferSource();
    degSrc.buffer = degBuf;
    degSrc.loop = loop;

    const cleanGain = ctx.createGain();
    const degGain = ctx.createGain();
    cleanGain.gain.value = mode === 'clean' ? 1 : 0;
    degGain.gain.value = mode === 'degraded' ? 1 : 0;

    cleanSrc.connect(cleanGain);
    degSrc.connect(degGain);
    cleanGain.connect(this.analyser!);
    degGain.connect(this.analyser!);

    this.cleanSource = cleanSrc;
    this.degradedSource = degSrc;
    this.cleanGain = cleanGain;
    this.degradedGain = degGain;
    this.duration = cleanBuf.duration;
    this.startTime = ctx.currentTime;
    this.isPlaying = true;

    cleanSrc.onended = () => {
      if (this.cleanSource === cleanSrc && !loop) {
        this.isPlaying = false;
        this.onEndedCallback?.();
      }
    };

    cleanSrc.start(0);
    degSrc.start(0);
  }

  public setMode(mode: 'clean' | 'degraded'): void {
    this.activeMode = mode;
    if (!this.ctx || !this.cleanGain || !this.degradedGain) return;
    const now = this.ctx.currentTime;
    this.cleanGain.gain.setTargetAtTime(mode === 'clean' ? 1 : 0, now, 0.015);
    this.degradedGain.gain.setTargetAtTime(mode === 'degraded' ? 1 : 0, now, 0.015);
  }

  public stop(): void {
    try {
      this.cleanSource?.stop();
    } catch {
      // ignore already stopped
    }
    try {
      this.degradedSource?.stop();
    } catch {
      // ignore already stopped
    }
    this.cleanSource = null;
    this.degradedSource = null;
    this.cleanGain = null;
    this.degradedGain = null;
    this.isPlaying = false;
  }
}
