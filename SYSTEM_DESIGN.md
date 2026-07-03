# RHSP VTV — Voice Kiosk System Design
> **Version:** 1.0 | **Stack:** React + TypeScript + Vite + Gemini Live API
> **Last updated:** July 2026

---

## 1. What This System Is

A **browser-based, voice-first retail kiosk** that lets customers speak naturally (in English, Hindi, or Marathi) to an AI sales assistant called **Maya**. Maya listens, understands intent, and responds in real-time audio — recommending products from a local TypeScript database. No typing, no touchscreen navigation — pure voice.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                   BROWSER (React SPA)                │
│                                                      │
│  ┌──────────┐   ┌──────────────┐   ┌─────────────┐  │
│  │  UI Layer│   │ Audio Engine │   │ WebSocket   │  │
│  │(App.tsx) │◄──│(AudioPlayer) │◄──│  Manager    │  │
│  │          │   │  ScriptProc  │──►│             │  │
│  └──────────┘   └──────────────┘   └──────┬──────┘  │
│                                           │ ws://    │
└───────────────────────────────────────────┼─────────┘
                                            │ HTTP Upgrade
                                 ┌──────────▼──────────┐
                                 │   Vite Dev Server    │
                                 │   (Proxy /ws-api)    │
                                 └──────────┬───────────┘
                                            │ wss://
                                 ┌──────────▼───────────┐
                                 │  Google Gemini        │
                                 │  Live API             │
                                 │  (BidiGenerateContent)│
                                 └──────────────────────┘
```

### Why a Proxy?
Browsers block direct cross-origin `wss://` connections to `generativelanguage.googleapis.com`. The Vite dev server proxies all `/ws-api/*` traffic to the real Google endpoint from Node.js (which has no such restriction).

---

## 3. File Structure

```
RHSP VTV/
├── src/
│   ├── App.tsx          ← Entire application logic and UI
│   └── toasters.ts      ← Product database + prompt builders
├── vite.config.ts       ← Vite + WebSocket proxy config
├── index.html           ← Single HTML entry point
├── package.json
└── SYSTEM_DESIGN.md     ← This file
```

---

## 4. Component Breakdown

### 4.1 `App.tsx` — Core Application

| Section | Responsibility |
|---|---|
| `LANGS[]` | Language config: code, label, system prompt instruction, greeting text |
| `AudioPlayer` class | Schedules and plays PCM-16 audio chunks from Gemini at 24 kHz |
| `Avatar` component | SVG illustration that animates on speaking/listening |
| `wsUrl()` | Builds the proxy WebSocket URL at runtime |
| `connectWs()` | Opens WebSocket, sends setup frame, resolves when setupComplete received |
| `startMic()` | Opens mic via getUserMedia, downsamples to 16 kHz, streams via realtimeInput |
| `stopMic()` | Tears down ScriptProcessorNode, AudioContext, and media stream |
| `handleTap()` | Main button logic: connect → greet → listen → stream |
| `switchLang()` | Resets entire session and sets new language |
| Visualiser `useEffect` | Canvas-based frequency bar animation (mic or speaker) |

### 4.2 `toasters.ts` — Product Database

| Export | Purpose |
|---|---|
| `interface Toaster` | Type definition for toaster entries |
| `interface WashingMachine` | Type definition for washing machine entries |
| `TOASTERS[]` | Array of 5 toaster models with full details |
| `WASHING_MACHINES[]` | Array of 5 washing machine models |
| `buildSystemPrompt()` | Generates the full product catalog as Maya's system instruction |
| `buildSystemPromptWithLang(instruction)` | Prepends language constraint to the base prompt |

### 4.3 `vite.config.ts` — Proxy

```ts
proxy: {
  '/ws-api': {
    target: 'wss://generativelanguage.googleapis.com',
    ws: true,
    rewrite: path => path.replace(/^\/ws-api/, '/ws')
  }
}
```

---

## 5. Data Flow (Step by Step)

### Connection Flow
```
User taps mic button
       │
       ▼
player.resume()         ← Unlock AudioContext (browser requires user gesture)
       │
       ▼
connectWs(lang)
  └─ new WebSocket(wsUrl())
  └─ sock.onopen → send setup { model, generationConfig, systemInstruction }
  └─ wait for setupComplete message
  └─ resolve() → phase = 'ready'
       │
       ▼
greetedRef === false?
  YES → send clientContent (text greeting turn)
        greetedRef = true
        phase = '...'
        ← Maya generates greeting audio
        ← Audio chunks arrive in onmessage → enqueue → play
        ← phase = 'speaking' → 'ready'
  NO  → startMic()
```

### Audio Streaming Flow (While Listening)
```
Microphone (44.1kHz Float32)
       │
ScriptProcessorNode (256 samples)
       │
downsample() → 16000 Hz Float32
       │
toPcm16() → Int16Array
       │
toB64() → base64 string
       │
WebSocket.send({ realtimeInput: { mediaChunks: [...] } })
       │
Vite Proxy → wss://generativelanguage.googleapis.com
       │
Gemini Live API (server-side VAD detects speech end)
       │
BidiGenerateContent response stream
       │
onmessage → parse → inlineData.data (base64 PCM-16 @ 24kHz)
       │
AudioPlayer.enqueue() → decode → AudioBufferSourceNode → speakers
```

### Language Switch Flow
```
User selects new language from dropdown
       │
switchLang(idx)
  └─ player.stop()
  └─ stopMic()
  └─ killWs()
  └─ greetedRef = false
  └─ phase = 'idle'
       │
User taps again → fresh connectWs() with new system prompt
```

---

## 6. WebSocket Message Reference

### Outgoing (Browser → Gemini)

| Message Type | When Sent | Fields |
|---|---|---|
| `setup` | On `sock.onopen` | `model`, `generationConfig.responseModalities`, `systemInstruction` |
| `clientContent` | Greeting trigger | `turns[role=user, parts[text]]`, `turnComplete: true` |
| `realtimeInput` | Every 256-sample audio chunk | `mediaChunks[mimeType, data]` |

### Incoming (Gemini → Browser)

| Message Type | When | Action |
|---|---|---|
| `setupComplete` | After setup accepted | Resolve connection promise, set phase = ready |
| `serverContent.modelTurn.parts[inlineData]` | Audio chunk | `player.enqueue(b64)` |
| `serverContent.modelTurn.parts[text]` | Subtitle text | Append to subtitle state |
| `serverContent.interrupted` | Maya cut off | `player.stop()` |
| `serverContent.turnComplete` | Response done | Player onchange handles UI |

---

## 7. Current Limitations

| Limitation | Impact |
|---|---|
| API key is hardcoded in `App.tsx` | Anyone who views source can steal the key |
| Single concurrent session per browser tab | No multi-user support |
| Product DB is a static TypeScript file | Requires code redeploy to update products |
| No conversation history stored | Session memory resets each reconnect |
| No analytics or logging | Cannot see what customers are asking |
| Vite proxy only works in dev (`npm run dev`) | Production deployment needs a real backend proxy |
| No fallback if Gemini goes down | Stuck/blank state |

---

## 8. Scalability & Expansion Roadmap

### 8.1 Make the API Key Secure

**Problem:** The Gemini API key is exposed in browser JS bundle.

**Solution:** Move all Gemini calls to a **backend relay server**.

```
Browser ──ws──► Your Backend Server ──wss──► Gemini API
                (validates user,
                 rate-limits,
                 logs sessions)
```

**What to build/buy:**

| Service | Purpose | Cost |
|---|---|---|
| Node.js + `ws` package | Backend WebSocket relay | Free (self-host) |
| **Railway / Render / Fly.io** | Host the relay server | ~$5–$10/mo |
| **Cloudflare Workers** (alternative) | Edge relay, zero cold-start | $5/mo paid plan |

---

### 8.2 Move Product Database to a Real Backend

**Problem:** Editing `toasters.ts` requires a developer and redeploy.

**Solution:** Store products in a database with an admin panel.

**Stack recommendation:**

| Component | Tool | Cost |
|---|---|---|
| **Database** | Supabase (PostgreSQL) | Free tier / $25/mo pro |
| **Admin UI** | Supabase Studio (built-in) | Free |
| **API** | Supabase REST / your Node relay | Free |
| **CMS alternative** | Contentful / Sanity | Free tier available |

**Schema:**
```sql
CREATE TABLE products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category    TEXT NOT NULL,       -- 'toaster', 'washing_machine'
  name        TEXT NOT NULL,
  price_inr   INTEGER NOT NULL,
  best_for    TEXT,
  features    TEXT[],
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

Maya's system prompt is then built **dynamically at session start** by fetching active products from the API.

---

### 8.3 Multi-Kiosk / Multi-Store Deployment

**Problem:** Each store needs its own product list and branding.

**Solution:** Add a `store_id` / `tenant_id` to the data model.

```
kiosk.mystore.com?store=mumbai-andheri
       │
Backend reads store config:
  - Product list for that store
  - Store name for system prompt
  - Languages enabled for that store
  - Custom Maya greeting
```

**What to buy:**

| Service | Purpose |
|---|---|
| **Vercel / Netlify** | Host the React frontend (CDN, fast, global) — ~$0–20/mo |
| **Custom domain** | `kiosk.stash21.in` — ~₹800/yr |
| **Cloudflare** | DNS + DDoS protection + edge caching — Free tier sufficient |

---

### 8.4 Analytics & Conversation Logging

**Problem:** You have no idea what customers are asking.

**Solution:** Log every conversation turn to a database.

```ts
// Log structure
{
  session_id:           "uuid",
  store_id:             "mumbai-andheri",
  lang:                 "hi",
  timestamp:            "2026-07-03T10:00:00Z",
  role:                 "user" | "maya",
  text:                 "Which washing machine is best for hard water?",
  product_recommended:  "Whirlpool 8 kg 5 Star"
}
```

**What to buy/use:**

| Tool | Purpose | Cost |
|---|---|---|
| **Supabase** | Store conversation logs | Free tier |
| **PostHog** | Event analytics dashboard | Free up to 1M events/mo |
| **Mixpanel** | Funnel analysis (did the customer buy?) | Free tier |
| **Google Looker Studio** | Visual reports from Supabase data | Free |

---

### 8.5 Better Speech Recognition for Indian Languages

**Problem:** Gemini's built-in VAD can miss soft speech or regional accents in Hindi/Marathi.

**Solutions:**

| Option | Description | Cost |
|---|---|---|
| **Google Cloud Speech-to-Text v2** | Best-in-class Hindi/Marathi, streaming | ~$0.006 / 15 sec |
| **Sarvam AI STT** | India-specific, 10 Indian languages natively | Freemium — sarvam.ai |
| **Bhashini API** (Govt of India) | Free Indian language STT + TTS | **Free** — bhashini.gov.in |
| **Whisper (self-hosted)** | Open-source, runs on your server | Server cost only |

> **Recommendation for Hindi/Marathi:** Use **Bhashini API** (free, government-backed) or **Sarvam AI** — both are built specifically for Indic languages and will massively improve accuracy over Gemini's generic VAD.

---

### 8.6 Better Text-to-Speech Output

**Problem:** Gemini's `Aoede` voice is English-centric; Hindi/Marathi sounds accented.

**Solution:** Use Gemini only for reasoning; pipe its text response through a dedicated Indian TTS.

| TTS Service | Languages | Cost |
|---|---|---|
| **Sarvam AI TTS** | Hindi, Marathi, 8 more Indian langs | Freemium |
| **Bhashini TTS** | All 22 scheduled Indian languages | **Free** |
| **Google Cloud TTS** Neural2 | Hindi `hi-IN`, good quality | $4–$16 per 1M chars |
| **ElevenLabs** | Realistic voices, Hindi support | $5/mo starter |
| **Murf AI** | Indian English + Hindi | $19/mo |

---

### 8.7 Offline / Low-Network Fallback

**Problem:** Kiosk at a store with bad internet → Gemini call fails.

**Solution:**
1. Detect connection loss → show "Please visit our staff for help" screen
2. Pre-cache common Q&A → use a local LLM for basic queries (Gemma 2B via Ollama)
3. Progressive Web App (PWA) → cache UI assets for instant load

```ts
window.addEventListener('offline', () => {
  setPhase('offline');
  setStatus('NO INTERNET – PLEASE WAIT');
});
```

---

### 8.8 Physical Kiosk Packaging

If deploying as a physical in-store kiosk:

| Hardware | Recommendation | Cost |
|---|---|---|
| **Display** | 10" touch screen, landscape | ₹4,000–8,000 |
| **Computer** | Raspberry Pi 5 (8GB) or mini PC | ₹8,000–15,000 |
| **Microphone** | ReSpeaker USB mic array (far-field) | ₹3,500 |
| **Speaker** | USB-powered 5W speaker | ₹800 |
| **OS** | Raspberry Pi OS + Chromium kiosk mode | Free |
| **Auto-start** | `--kiosk --app=http://localhost:5173` flag | Free |
| **Wake-word** | Porcupine ("Hey Maya") by Picovoice | Free self-hosted |

---

## 9. Recommended Production Architecture

```
                     ┌─────────────────┐
                     │  Supabase DB    │
                     │ - Products      │
                     │ - Sessions      │
                     │ - Logs          │
                     └────────┬────────┘
                              │ REST
              ┌───────────────▼────────────────┐
              │         Backend Server          │
              │    (Node.js on Railway/Fly)     │
              │                                 │
              │  - Auth / rate limiting         │
              │  - WebSocket relay to Gemini    │
              │  - Product prompt builder       │
              │  - Session logging              │
              └───────────────┬────────────────┘
                              │ WebSocket
          ┌───────────────────▼────────────────────┐
          │         React Frontend (Vercel)         │
          │    - Deployed at kiosk.stash21.in       │
          │    - Multiple store configs via URL      │
          │    - Hindi / Marathi / English          │
          └────────────────────────────────────────┘
                              ▲
                     Physical kiosks
                  (Raspberry Pi + Chromium)
```

---

## 10. Immediate Next Steps (Priority Order)

| # | Action | Effort | Impact |
|---|---|---|---|
| 1 | **Move API key to backend relay** | 2 days | Critical — security |
| 2 | **Integrate Bhashini/Sarvam TTS** | 1 day | High — Hindi/Marathi quality |
| 3 | **Move products to Supabase** | 1 day | High — non-dev updates |
| 4 | **Add conversation logging** | 1 day | Medium — analytics |
| 5 | **Deploy to Vercel + custom domain** | 2 hours | Medium — production URL |
| 6 | **Add offline fallback screen** | 2 hours | Medium — reliability |
| 7 | **Add wake-word ("Hey Maya")** | 1 day | Low — UX polish |
| 8 | **Multi-store / multi-tenant** | 3 days | Low — future scaling |

---

## 11. APIs & Services Cost Summary

| Service | What For | Free Tier | Paid |
|---|---|---|---|
| **Google Gemini Live API** | Core AI conversation | Current key | Pay-per-token |
| **Supabase** | DB + auth + REST API | 500MB / 2 projects | $25/mo |
| **Bhashini** (Govt of India) | Hindi/Marathi STT + TTS | **Fully free** | Free |
| **Sarvam AI** | Better Indian language AI | 1,000 req/day | Custom pricing |
| **Railway.app** | Backend relay hosting | $5 free credit | $5/mo |
| **Vercel** | Frontend hosting + CDN | 100GB bandwidth | $20/mo |
| **Cloudflare** | DNS + DDoS + edge cache | Free | $5/mo |
| **PostHog** | Usage analytics | 1M events/mo | $0–$450/mo |
| **Picovoice Porcupine** | Wake-word ("Hey Maya") | Self-hosted free | $0 |
| **ElevenLabs** | Premium TTS voices | 10k chars/mo | $5/mo |

---

*Document generated July 2026 — RHSP VTV Voice Kiosk Project*
