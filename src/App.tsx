import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { buildSystemPromptWithLang } from './toasters';
import './App.css';

// ─────────────────────────────────────────────────────────
// Language config
// ─────────────────────────────────────────────────────────
interface LangCfg {
  code: string;
  label: string;
  instruction: string;
  greetText: string;
}

const LANGS: LangCfg[] = [
  {
    // Auto-detect: Maya mirrors whatever language the customer speaks
    code: 'auto',
    label: '🌐 Auto-detect',
    instruction: `LANGUAGE DETECTION RULE — This is your most important rule:
Listen to the language the customer is speaking and ALWAYS respond in that exact same language in audio.
- Customer speaks English  → YOU respond ONLY in English
- Customer speaks Hindi (हिंदी) → YOU respond ONLY in Hindi
- Customer speaks Marathi (मराठी) → YOU respond ONLY in Marathi
Never mix languages. Never respond in a different language than the customer used.

CRITICAL TEXT RULE: Your text response must contain NO INTERNAL THOUGHTS. Do not use <thought> tags. You must output ONLY this exact format:
[DETECTED: <Language>] <English Translation of your audio>
Example: [DETECTED: Hindi] Hello, how can I help you today?
Example: [DETECTED: English] Sure, let me show you some toasters.

CRITICAL: Never repeat your greeting. After your first greeting, engage naturally in conversation.`,
    greetText:
      'Greet the customer warmly in Hindi only. Say hello, ask how you can help them choose a product today, and explicitly tell them they can speak to you in Hindi, English, or Marathi. Remember to follow the CRITICAL TEXT RULE.',
  }
];

// ─────────────────────────────────────────────────────────
// PCM-16 AudioPlayer at 24 kHz
// ─────────────────────────────────────────────────────────
class AudioPlayer {
  ctx:      AudioContext | null = null;
  gain:     GainNode     | null = null;
  analyser: AnalyserNode | null = null;
  nextTime = 0;
  sources: AudioBufferSourceNode[] = [];
  playing = false;
  onchange: ((v: boolean) => void) | null = null;

  resume() {
    if (!this.ctx) {
      const C = (window as any).AudioContext || (window as any).webkitAudioContext;
      this.ctx = new C({ sampleRate: 24000 }) as AudioContext;
      this.gain = this.ctx.createGain();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.gain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  enqueue(b64: string) {
    this.resume();
    if (!this.ctx || !this.gain) return;
    try {
      const raw = atob(b64);
      const u8  = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
      const pcm = new Int16Array(u8.buffer);
      const f32 = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768;
      const buf = this.ctx.createBuffer(1, f32.length, 24000);
      buf.copyToChannel(f32, 0);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.gain);
      const now = this.ctx.currentTime;
      if (this.nextTime < now) this.nextTime = now;
      src.start(this.nextTime);
      this.nextTime += buf.duration;
      this.sources.push(src);
      if (!this.playing) { this.playing = true; this.onchange?.(true); }
      src.onended = () => {
        this.sources = this.sources.filter(s => s !== src);
        if (!this.sources.length) { this.playing = false; this.onchange?.(false); }
      };
    } catch (e) { console.error('enqueue:', e); }
  }

  stop() {
    this.sources.forEach(s => { try { s.stop(); } catch (_) {} });
    this.sources = []; this.nextTime = 0;
    if (this.playing) { this.playing = false; this.onchange?.(false); }
  }
}

// ─────────────────────────────────────────────────────────
// Avatar
// ─────────────────────────────────────────────────────────
function Avatar({ speaking, listening }: { speaking: boolean; listening: boolean }) {
  return (
    <div className="avatar-container" style={{ width: 200, height: 300 }}>
      {/* Ripple rings under/around the image when speaking */}
      {speaking && (
        <>
          <div className="speaking-ring-1 ring-base ring-40" />
          <div className="speaking-ring-2 ring-base ring-30" />
          <div className="speaking-ring-3 ring-base ring-20" />
        </>
      )}
      {/* Glow ring when listening */}
      {listening && (
        <div className="listening-ring ring-base ring-sky" />
      )}
      {/* Woman PNG image - no clip, shows naturally */}
      <img
        src="/maya.png"
        alt="Maya"
        className="avatar-img avatar-float"
        style={{
          filter: speaking ? 'drop-shadow(0 0 20px rgba(255,255,255,0.5))' : 'drop-shadow(0 8px 24px rgba(0,0,0,0.3))',
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const MODEL   = 'models/gemini-2.5-flash-native-audio-latest';

function wsUrl() {
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_KEY}`;
}

function toB64(buf: ArrayBuffer) {
  let s = ''; const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}

function downsample(src: Float32Array, from: number, to: number) {
  if (from === to) return src;
  const ratio = from / to;
  const out   = new Float32Array(Math.round(src.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const s = Math.floor(i * ratio), e = Math.min(Math.floor((i + 1) * ratio), src.length);
    let sum = 0; for (let j = s; j < e; j++) sum += src[j];
    out[i] = sum / (e - s || 1);
  }
  return out;
}

function toPcm16(f: Float32Array) {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

// ─────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────
type Phase = 'idle' | 'connecting' | 'ready' | 'listening' | 'speaking' | 'processing';

export default function App() {
  // ── State ───────────────────────────────────────────
  const [langIdx,  setLangIdx]  = useState(0); // 0 = Auto-detect (default)
  const [phase,    setPhaseS]   = useState<Phase>('idle');
  const [status,   setStatus]   = useState('TAP TO START');
  const [subtitle,  setSubtitle]  = useState<string>('');
  const [detectedLang, setDetectedLang] = useState('');  // shown when auto mode is active

  // Refs that survive re-renders without causing them
  const phaseRef    = useRef<Phase>('idle');
  const langIdxRef  = useRef(0);           // mirror of langIdx, no stale closure
  const wsRef       = useRef<WebSocket | null>(null);
  const greetedRef  = useRef(false);
  const micOnRef    = useRef(false);
  const player      = useRef(new AudioPlayer());
  const canvasRef   = useRef<HTMLCanvasElement | null>(null);
  const micCtx      = useRef<AudioContext | null>(null);
  const micStream   = useRef<MediaStream | null>(null);
  const micWorklet  = useRef<AudioWorkletNode | null>(null);
  const micAnal     = useRef<AnalyserNode | null>(null);
  const subTimer    = useRef<number | null>(null);

  // Keep langIdxRef in sync
  useEffect(() => { langIdxRef.current = langIdx; }, [langIdx]);

  function setPhase(p: Phase) { phaseRef.current = p; setPhaseS(p); }


  // ── Audio output callback ──────────────────────────
  useEffect(() => {
    player.current.onchange = (on) => {
      if (on) {
        setPhase('speaking');
        setStatus('MAYA IS SPEAKING...');
        // subtitle is not cleared here so it builds up continuously for the turn
      } else {
        if (phaseRef.current === 'speaking') {
          // Automatically open the mic and start listening again
          startMic().then(() => {
            setPhase('listening');
            setStatus('LISTENING...');
          }).catch(() => {
            setPhase('ready');
            setStatus('PRESS TO SPEAK');
          });
          // Removed 4-second timeout so the transcript stays visible
        }
      }
    };
    return () => {
      stopMic();
      player.current.stop();
      killWs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── WebSocket ──────────────────────────────────────
  function killWs() {
    const s = wsRef.current;
    if (!s) return;
    s.onopen = s.onmessage = s.onerror = s.onclose = null;
    try { s.close(); } catch (_) {}
    wsRef.current = null;
  }

  function connectWs(lang: LangCfg): Promise<void> {
    return new Promise((resolve, reject) => {
      killWs();
      setPhase('connecting');
      setStatus('CONNECTING...');

      const sock = new WebSocket(wsUrl());
      wsRef.current = sock;

      // 8-second handshake timeout
      const timer = window.setTimeout(() => {
        killWs();
        setPhase('idle');
        setStatus('TAP TO START');
        reject(new Error('timeout'));
      }, 8000);

      sock.onopen = () => {
        // First message must be setup
        sock.send(JSON.stringify({
          setup: {
            model: MODEL,
            generationConfig: {
              responseModalities: ['AUDIO'],
            },
            systemInstruction: {
              parts: [{ text: buildSystemPromptWithLang(lang.instruction) }]
            },
            outputAudioTranscription: {},
          }
        }));
      };

      sock.onmessage = async (evt) => {
        let text: string;
        try {
          text = typeof evt.data === 'string' ? evt.data : await (evt.data as Blob).text();
          const msg = JSON.parse(text);

          // Connection ready
          if (msg.setupComplete) {
            clearTimeout(timer);
            setPhase('ready');
            setStatus('PRESS TO SPEAK');
            resolve();
            return;
          }

          // Maya interrupted
          if (msg.serverContent?.interrupted) {
            player.current.stop();
            if (phaseRef.current === 'speaking') {
              setPhase('ready'); setStatus('PRESS TO SPEAK');
            }
            return;
          }

          // Audio from Maya
          const parts: any[] = msg.serverContent?.modelTurn?.parts ?? [];
          for (const p of parts) {
            // As soon as we receive any data (audio or text) for a new turn, switch to speaking and clear the old subtitle
            if (p.inlineData?.data || p.text) {
              if (phaseRef.current !== 'speaking') {
                setPhase('speaking');
                setStatus('MAYA IS SPEAKING...');
                setSubtitle('');
              }
            }
            if (p.inlineData?.data) {
              player.current.enqueue(p.inlineData.data);
            }
            if (p.text) {
              let textChunk = p.text;
              // Extract [DETECTED: language] from text
              const match = textChunk.match(/\[DETECTED:\s*([^\]]+)\]/i);
              if (match) {
                setDetectedLang(match[1].toUpperCase());
                textChunk = textChunk.replace(/\[DETECTED:\s*([^\]]+)\]/i, '').trim();
              }
              setSubtitle(prev => (prev + ' ' + textChunk).trim().slice(-2000));
            }
          }
        } catch (_) { /* ignore parse errors */ }
      };

      sock.onerror = () => {
        clearTimeout(timer);
        killWs();
        setPhase('idle');
        setStatus('TAP TO START');
        reject(new Error('ws error'));
      };

      sock.onclose = (e) => {
        clearTimeout(timer);
        wsRef.current = null;
        console.log('[WS close]', e.code, e.reason);
        if (phaseRef.current !== 'listening') {
          setPhase('idle');
          setStatus('TAP TO START');
        }
      };
    });
  }

  // ── Mic ────────────────────────────────────────────
  function stopMic() {
    micOnRef.current = false;
    micWorklet.current?.disconnect(); micWorklet.current = null;
    micStream.current?.getTracks().forEach(t => t.stop()); micStream.current = null;
    micCtx.current?.close().catch(() => {}); micCtx.current = null;
    micAnal.current = null;
  }

  async function startMic() {
    stopMic();
    micOnRef.current = true;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStream.current = stream;
    const C   = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new C() as AudioContext;
    micCtx.current = ctx;
    if (ctx.state === 'suspended') await ctx.resume();

    const anal = ctx.createAnalyser(); anal.fftSize = 256;
    micAnal.current = anal;

    const src = ctx.createMediaStreamSource(stream);
    src.connect(anal);

    try {
      await ctx.audioWorklet.addModule('/recorder.worklet.js');
    } catch (e) {
      console.error('Failed to load recorder worklet', e);
      return;
    }

    const worklet = new AudioWorkletNode(ctx, 'recorder-worklet');
    src.connect(worklet);
    worklet.connect(ctx.destination);
    micWorklet.current = worklet;

    const inRate = ctx.sampleRate;
    worklet.port.onmessage = (e: MessageEvent) => {
      if (!micOnRef.current) return;
      const sock = wsRef.current;
      if (!sock || sock.readyState !== WebSocket.OPEN) return;
      const ds  = downsample(e.data, inRate, 16000);
      const pcm = toPcm16(ds);
      sock.send(JSON.stringify({
        realtimeInput: {
          mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: toB64(pcm.buffer.slice(0) as ArrayBuffer) }]
        }
      }));
    };
  }

  // ── Session Reset ──────────────────────────────────
  const resetSession = () => {
    setDetectedLang('');
    player.current.stop();
    stopMic();
    killWs();
    greetedRef.current = false;
    setSubtitle('');
    setPhase('idle');
    setStatus('TAP TO START');
  };

  // ── Language change ────────────────────────────────
  const switchLang = (idx: number) => {
    if (idx === langIdxRef.current) return;
    setLangIdx(idx);
    resetSession();
  };

  // ── Mic button ─────────────────────────────────────
  const handleTap = async () => {
    player.current.resume(); // must call on user gesture to unlock AudioContext

    const p = phaseRef.current;

    // Currently listening → stop mic manually and force submission
    if (p === 'listening') {
      stopMic();
      
      const sock = wsRef.current;
      if (sock && sock.readyState === WebSocket.OPEN) {
        // Send turnComplete to force Gemini to respond now
        sock.send(JSON.stringify({
          clientContent: {
            turns: [],
            turnComplete: true
          }
        }));
        setPhase('processing'); 
        setStatus('PROCESSING...');
      } else {
        setPhase('ready'); 
        setStatus('PRESS TO SPEAK');
      }
      return;
    }

    // Busy connecting → ignore
    if (p === 'connecting') return;

    // Stop any playing audio
    player.current.stop();

    // Read current language (always fresh via ref)
    const lang = LANGS[langIdxRef.current];

    // Connect if not already connected
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      try { await connectWs(lang); }
      catch { return; }
    }

    // ── FIRST TAP of this session: play greeting ──────
    if (!greetedRef.current) {
      greetedRef.current = true;
      wsRef.current!.send(JSON.stringify({
        clientContent: {
          turns: [{ role: 'user', parts: [{ text: lang.greetText }] }],
          turnComplete: true
        }
      }));
      
      // Start microphone immediately so user can speak right after (or during) greeting
      try {
        await startMic();
        setPhase('listening'); setStatus('LISTENING...');
      } catch {
        setStatus('MIC ERROR – TAP AGAIN');
      }
      return;
    }

    // ── SUBSEQUENT TAPS: open mic and stream ──────────
    try {
      await startMic();
      setPhase('listening'); setStatus('LISTENING...');
    } catch {
      setStatus('MIC ERROR – TAP AGAIN');
    }
  };

  // ── Visualiser ─────────────────────────────────────
  useEffect(() => {
    let id: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2 = canvas.getContext('2d') as CanvasRenderingContext2D;
    if (!ctx2) return;
    const W = canvas.width, H = canvas.height;
    const N = 10, BW = 4, G = 3;
    const x0 = (W - (N * BW + (N - 1) * G)) / 2;
    const draw = () => {
      id = requestAnimationFrame(draw);
      ctx2.clearRect(0, 0, W, H);
      const isL = phase === 'listening' && micAnal.current;
      const isS = phase === 'speaking'  && player.current.analyser;
      const an  = isL ? micAnal.current! : isS ? player.current.analyser! : null;
      if (an) {
        const data = new Uint8Array(an.frequencyBinCount);
        an.getByteFrequencyData(data);
        for (let i = 0; i < N; i++) {
          const h = Math.max(4, (data[Math.floor(i / N * an.frequencyBinCount * 0.5)] / 255) * H * 0.9);
          ctx2.fillStyle = isL ? '#38bdf8' : '#fff';
          ctx2.beginPath(); ctx2.roundRect(x0 + i * (BW + G), (H - h) / 2, BW, h, 2); ctx2.fill();
        }
      } else {
        const t = Date.now() * 0.003;
        for (let i = 0; i < N; i++) {
          const h = Math.sin(t + i * 0.5) * 3 + 6;
          ctx2.fillStyle = 'rgba(255,255,255,0.2)';
          ctx2.beginPath(); ctx2.roundRect(x0 + i * (BW + G), (H - h) / 2, BW, h, 2); ctx2.fill();
        }
      }
    };
    draw();
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Render ─────────────────────────────────────────
  const isListening  = phase === 'listening';
  const isConnecting = phase === 'connecting';
  const isProcessing = phase === 'processing';
  const isIdle       = phase === 'idle';
  const isSpeaking   = phase === 'speaking';

  return (
    <div className="app-container">
      
      {/* 1. MAIN CENTERED CONTAINER (holds all interactive elements) */}
      <div className="app-main">
        
        {/* TOP CONTROLS (Horizontally Centered) */}
        <div className="top-controls">
          {/* Language dropdown */}
          <div className="lang-dropdown">
            <select
              value={langIdx}
              onChange={e => switchLang(Number(e.target.value))}
              className="lang-select"
            >
              {LANGS.map((l, i) => (
                <option key={l.code} value={i} className="lang-option">{l.label}</option>
              ))}
            </select>
            <div className="dropdown-arrow">
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
                <path d="M1 1l4 4 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>

          {/* Detected language badge + End Chat */}
          <div className="actions-group">
            {langIdx === 0 && detectedLang && detectedLang !== 'English' && (
              <div className="detected-badge">
                <span className="detected-label">DETECTED</span>
                <span className="detected-value">{detectedLang}</span>
              </div>
            )}
            {phase !== 'idle' && phase !== 'connecting' && (
              <button
                onClick={resetSession}
                className="end-chat-btn"
              >
                End Chat
              </button>
            )}
          </div>
        </div>

        {/* CENTER: Woman avatar */}
        <div className="avatar-wrapper">
          <Avatar speaking={isSpeaking} listening={isListening} />
        </div>

        {/* BOTTOM: Mic + status */}
        <div className="bottom-controls">
          <canvas ref={canvasRef} width={120} height={24} className="visualizer-canvas" />
          <span className="status-text">{status}</span>
          <button
            id="kiosk-mic-btn"
            onClick={handleTap}
            disabled={isConnecting || isProcessing}
            className={`mic-btn ${isConnecting || isProcessing ? 'mic-disabled' : 'mic-active'}`}
          >
            {isProcessing
              ? <svg className="processing-spinner spinner-icon" fill="none" viewBox="0 0 24 24">
                  <circle className="spinner-bg" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="spinner-fg" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              : isListening
                ? <MicOff className="mic-icon" />
                : <Mic className={`mic-icon ${isIdle ? 'mic-idle' : ''}`} />
            }
          </button>
        </div>
      </div>

      {/* 2. OVERLAPPING TOP-RIGHT KPI CONTAINER (z-index 50) */}
      <div className="kpi-container">
        {subtitle && (
          <div className="kpi-card">
            {/* KPI Header */}
            <div className="kpi-header">
              <div className="kpi-title-group">
                <div className="kpi-dot"></div>
                <div className="kpi-title">
                  Live KPI
                </div>
              </div>
              <div className="kpi-tag">
                Transcript
              </div>
            </div>
            {/* 122px is exactly 5 lines of 15px text with 1.625 line height */}
            <div className="kpi-transcript-box scrollable-transcript">
              <p className="kpi-transcript-text">
                {subtitle.replace(/<thought>[\s\S]*?(<\/thought>|$)/gi, '').trim()}
              </p>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
