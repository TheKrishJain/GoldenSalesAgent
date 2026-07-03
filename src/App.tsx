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
IMPORTANT: While your AUDIO must match the customer's language, your TEXT response (the text part) MUST ALWAYS BE TRANSLATED TO ENGLISH. No matter what language you are speaking in, output English text.
If the customer switches language mid-conversation, you switch too immediately.`,
    greetText:
      'Greet the customer warmly in Hindi only. Say hello, ask how you can help them choose a product today, and explicitly tell them they can speak to you in Hindi, English, or Marathi.',
  },
  {
    code: 'en',
    label: 'English',
    instruction: 'You MUST respond ONLY in English. Do not use any other language under any circumstance.',
    greetText:
      'Greet the customer warmly in English and offer to help them choose a toaster or washing machine.',
  },
  {
    code: 'hi',
    label: 'हिंदी (Hindi)',
    instruction:
      'तुम्हें केवल हिंदी में जवाब देना है। चाहे ग्राहक किसी भी भाषा में बोले, तुम हमेशा हिंदी में जवाब दो।',
    greetText:
      'ग्राहक का हिंदी में गर्मजोशी से स्वागत करें और टोस्टर या वाशिंग मशीन चुनने में मदद की पेशकश करें।',
  },
  {
    code: 'mr',
    label: 'मराठी (Marathi)',
    instruction:
      'तुम्ही फक्त मराठीत उत्तर द्यायचे आहे। ग्राहक कोणत्याही भाषेत बोलला तरी तुम्ही नेहमी मराठीतच उत्तर द्या.',
    greetText:
      'ग्राहकाचे मराठीत उत्साहाने स्वागत करा आणि टोस्टर किंवा वॉशिंग मशीन निवडण्यात मदत करण्याची ऑफर द्या.',
  },
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
    <div className="relative flex items-center justify-center" style={{ width: 280, height: 380 }}>
      {/* Ripple rings when speaking */}
      {speaking && (
        <>
          <div className="speaking-ring-1 absolute inset-0 rounded-full border-2 border-white/40" />
          <div className="speaking-ring-2 absolute inset-0 rounded-full border-2 border-white/30" />
          <div className="speaking-ring-3 absolute inset-0 rounded-full border-2 border-white/20" />
        </>
      )}
      {/* Glow ring when listening */}
      {listening && (
        <div className="listening-ring absolute inset-0 rounded-full border-2 border-sky-300/60" />
      )}
      {/* Woman image */}
      <div
        className={`avatar-float relative overflow-hidden rounded-full border-4 border-white/30 shadow-2xl`}
        style={{ width: 260, height: 360, boxShadow: speaking ? '0 0 40px rgba(255,255,255,0.4)' : '0 20px 60px rgba(0,0,0,0.3)' }}
      >
        <img
          src="/maya.png"
          alt="Maya"
          className="w-full h-full object-cover object-top"
          style={{ filter: speaking ? 'brightness(1.05)' : 'brightness(1)' }}
        />
        {/* Speaking overlay shimmer */}
        {speaking && (
          <div className="absolute inset-0 bg-gradient-to-t from-white/10 to-transparent" />
        )}
      </div>
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
  const [_subtitle, setSubtitle] = useState<string>('');
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
  const sttRef      = useRef<any>(null);

  // Initialize Web Speech API for transcribing Maya
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US'; // User requested English only
      rec.onresult = (e: any) => {
        let text = '';
        for (let i = e.resultIndex; i < e.results.length; ++i) {
          text += e.results[i][0].transcript;
        }
        setSubtitle(text);
      };
      sttRef.current = rec;
    }
  }, []);

  // Keep langIdxRef in sync
  useEffect(() => { langIdxRef.current = langIdx; }, [langIdx]);

  function setPhase(p: Phase) { phaseRef.current = p; setPhaseS(p); }

  // Detect language from Maya's text response (Unicode range check)
  function detectLangFromText(text: string): string {
    const devanagari = (text.match(/[\u0900-\u097F]/g) || []).length;
    if (devanagari === 0) return 'English';
    // Marathi-specific characters that rarely appear in Hindi
    const marathiSpecific = (text.match(/[\u0965\u0902\u093E\u093F\u0940\u094D]/g) || []).length;
    // Simple heuristic: check for common Marathi-only words
    const hasMarathi = /आहे|नाही|करा|द्या|आणि|किंवा|मदत/.test(text);
    const hasHindi   = /है|नहीं|करें|और|या|मदद|आप/.test(text);
    if (hasMarathi && !hasHindi) return 'मराठी';
    if (hasHindi)  return 'हिंदी';
    if (marathiSpecific > 2) return 'मराठी';
    return 'हिंदी'; // default Devanagari to Hindi
  }

  // ── Audio output callback ──────────────────────────
  useEffect(() => {
    player.current.onchange = (on) => {
      if (on) {
        setPhase('speaking');
        setStatus('MAYA IS SPEAKING...');
        setSubtitle('');
        try { sttRef.current?.start(); } catch (_) {}
      } else {
        if (phaseRef.current === 'speaking') {
          try { sttRef.current?.stop(); } catch (_) {}
          // Automatically open the mic and start listening again
          startMic().then(() => {
            setPhase('listening');
            setStatus('LISTENING...');
          }).catch(() => {
            setPhase('ready');
            setStatus('PRESS TO SPEAK');
          });
          // Clear subtitle after 4 s
          if (subTimer.current) clearTimeout(subTimer.current);
          subTimer.current = window.setTimeout(() => setSubtitle(''), 4000);
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

          // Audio + text from Maya
          const parts: any[] = msg.serverContent?.modelTurn?.parts ?? [];
          for (const p of parts) {
            if (p.inlineData?.data) {
              if (phaseRef.current !== 'speaking') {
                setPhase('speaking');
                setStatus('MAYA IS SPEAKING...');
                setSubtitle('');
              }
              player.current.enqueue(p.inlineData.data);
            }
            if (p.text) {
              setSubtitle(prev => (prev + p.text).slice(-300));
              if (subTimer.current) clearTimeout(subTimer.current);
              // In auto mode, detect and display which language Maya responded in
              if (langIdxRef.current === 0) {
                setDetectedLang(detectLangFromText(p.text));
              }
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
    try { sttRef.current?.stop(); } catch (_) {}
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
        sock.send(JSON.stringify({
          clientContent: {
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
      setStatus('...');
      return; // wait for Maya to finish; user taps again to speak
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
    <div className="w-screen h-screen bg-[#FF0000] flex flex-col items-center justify-between select-none overflow-hidden relative" style={{ paddingTop: 20, paddingBottom: 36 }}>

      {/* TOP BAR */}
      <div className="w-full flex items-center justify-between px-6 z-10">
        {/* Language dropdown - top left */}
        <div className="relative">
          <select
            value={langIdx}
            onChange={e => switchLang(Number(e.target.value))}
            className="appearance-none bg-black/30 backdrop-blur-sm text-white font-bold text-xs
              border border-white/50 rounded-full pl-4 pr-8 py-2
              cursor-pointer outline-none hover:bg-black/50 focus:border-white transition-all"
          >
            {LANGS.map((l, i) => (
              <option key={l.code} value={i} className="bg-red-700 text-white">{l.label}</option>
            ))}
          </select>
          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
              <path d="M1 1l4 4 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>

        {/* Detected language badge + End Chat - top right */}
        <div className="flex items-center gap-3">
          {langIdx === 0 && detectedLang && detectedLang !== 'English' && (
            <div className="flex items-center gap-1 bg-white/20 backdrop-blur-sm border border-white/40 rounded-full px-3 py-1">
              <span className="text-[9px] text-white/70 font-bold uppercase tracking-wider">DETECTED</span>
              <span className="text-xs text-white font-black">{detectedLang}</span>
            </div>
          )}
          {phase !== 'idle' && phase !== 'connecting' && (
            <button
              onClick={resetSession}
              className="px-4 py-2 bg-black/30 hover:bg-black/50 text-white text-xs font-black tracking-widest rounded-full border border-white/50 transition-all backdrop-blur-sm"
            >
              END CHAT
            </button>
          )}
        </div>
      </div>

      {/* MAIN: Woman avatar centred */}
      <div className="flex-1 flex items-center justify-center">
        <Avatar speaking={isSpeaking} listening={isListening} />
      </div>

      {/* BOTTOM: Mic + status */}
      <div className="flex flex-col items-center gap-3 z-10">
        {/* Visualiser */}
        <canvas ref={canvasRef} width={120} height={24} className="opacity-70" />

        {/* Status label */}
        <span className="text-[11px] font-black tracking-widest text-white/90 uppercase">{status}</span>

        {/* Mic button */}
        <button
          id="kiosk-mic-btn"
          onClick={handleTap}
          disabled={isConnecting || isProcessing}
          className={`w-20 h-20 rounded-full border-2 border-white bg-transparent
            flex items-center justify-center transition-all duration-200
            active:scale-95 outline-none cursor-pointer
            ${isListening  ? 'border-sky-300 bg-sky-500/20' : ''}
            ${isConnecting || isProcessing ? 'opacity-40 cursor-not-allowed' : ''}`}
          style={{
            boxShadow: isIdle ? undefined : isListening ? '0 0 20px rgba(56,189,248,0.5)' : isSpeaking ? '0 0 20px rgba(255,255,255,0.3)' : undefined
          }}
        >
          {isProcessing
            ? <svg className="processing-spinner w-8 h-8 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            : isListening
              ? <MicOff className="w-8 h-8 text-sky-200" />
              : <Mic className={`w-8 h-8 text-white ${isIdle ? 'mic-idle' : ''}`} />
          }
        </button>
      </div>

    </div>
  );
}
