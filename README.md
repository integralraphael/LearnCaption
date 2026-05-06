# LearnCaption

A macOS overlay app that turns any English speech — meetings, lectures, videos — into an interactive language learning session. Captions appear in real time, difficult words are highlighted and translated inline, and everything is saved for review.

> **Platform:** macOS only (Apple Silicon recommended)

---

## Features

### Real-time Caption Overlay
Transparent window that sits on top of any app. Captures audio via Whisper (local, on-device) or reads Google Meet captions via a Chrome extension.

- Whisper large-v3 runs fully on-device with Metal acceleration
- Works with any audio source (meetings, YouTube, podcasts)
- Google Meet captions forwarded with near-zero latency via WebSocket

### Intelligent Word Highlighting
Words are color-coded by your proficiency level, calibrated during first-run setup:

| Color | Meaning |
|-------|---------|
| Yellow | Somewhat familiar |
| Orange | Difficult |
| Red | Unknown |
| Grey | Auto-detected hard word (above frequency threshold, not yet in vocab book) |

### Inline & Staggered Definitions
Definitions appear directly under difficult words — no lookup required.

- **Inline bracket** mode: `word [定义]`
- **Below-stagger** mode: definition floats under each word in a 2-row layout that avoids overlaps

### AI Translation (On-Device)
Uses [HY-MT1.5-1.8B](https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF) (Tencent Hunyuan MT) running locally via llama.cpp + Metal:

- **Click any word** → shows both AI translation and ECDICT dictionary definition side by side, each with its own **Add to vocab** button so you choose which definition to save
- **Select a phrase** → AI translates using the surrounding sentence as context (handles idioms like "blown away" correctly)
- **Sentence translation** → optional automatic Chinese translation below each caption line
- The AI model (~500 MB) downloads automatically in the background on first launch

### Vocab Book
Every word you look up can be saved to your vocabulary list with one click.

- Familiarity tracking
- Mark words as mastered
- Occurrence counter: how many times you've heard the word in sessions

### Web Dashboard
Browse past sessions at `http://127.0.0.1:52341` in any browser.

- Full transcript with speaker labels and timestamps
- Same word highlight + definition system as the overlay
- Click any word or drag-select a phrase for translation
- Per-sentence translation (on-demand or auto-translate all)
- Rename meetings

---

## Requirements

| Tool | Version |
|------|---------|
| macOS | 13 Ventura or later |
| Xcode Command Line Tools | `xcode-select --install` |
| Rust | ≥ 1.75 — [rustup.rs](https://rustup.rs) |
| Node.js | ≥ 18 |
| npm | ≥ 10 |

---

## Installation

```bash
git clone https://github.com/integralraphael/LearnCaption.git
cd LearnCaption

# Install frontend dependencies
npm install
npm install --prefix web

# Build the web dashboard
npm run build --prefix web

# Run (first run compiles Rust — allow 10–20 min)
npm run learncaption
```

On first launch the app downloads the Whisper model (~500 MB). The AI translation model (~500 MB) downloads automatically in the background — no manual step required.

### Chrome Extension (Google Meet)

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `chrome-extension/` folder in this repo

The extension connects automatically when you start a Browser capture session in the app.

---

## Usage

### Starting a Session

| Source | How |
|--------|-----|
| **Microphone / System audio** | Click **Start (Whisper)** in the sidebar |
| **Google Meet** | Join a Meet call with captions enabled, then click **Start (Browser)** |

### Overlay Controls

- **Click a word** → open translation panel
- **Drag to select a phrase** → translate the phrase in context
- **Scroll** → browse caption history
- **Jump button** → snap back to the latest caption

### Display Settings (sidebar)

- Word color scheme: proficiency tiers or single color
- Definition position: inline bracket / below-stagger / off
- Sentence translation: off / on-demand button / auto-all
- Window opacity

---

## Architecture

```
LearnCaption/
├── src/                    # Overlay UI (React + Tauri webview)
│   ├── components/
│   │   ├── SubtitleWindow  # Real-time caption display
│   │   ├── Token           # Individual word with highlight + definition
│   │   ├── WordDetail      # Translation panel (ECDICT + AI)
│   │   └── WordPopover     # Floating translation popup
│   └── contexts/
│       └── DisplaySettings # Shared display configuration
│
├── web/                    # Web dashboard (served at :52341)
│   └── src/pages/
│       ├── Meetings        # Transcript review
│       └── Vocab           # Vocabulary list
│
├── src-tauri/
│   ├── src/
│   │   ├── caption_source/ # WebSocket server (Chrome extension → app)
│   │   ├── pipeline/       # Annotation engine (vocab lookup + difficulty scoring)
│   │   ├── dictionary/     # ECDICT SQLite (100k words, loaded into memory)
│   │   ├── translation/    # llama.cpp inference (HY-MT1.5)
│   │   ├── http_server/    # REST API + static file server
│   │   └── db/             # SQLite (meetings, transcripts, vocab book)
│   └── whisper-worker/     # Separate binary: Whisper ASR + RMS energy VAD
│
└── chrome-extension/       # MV3 extension: forwards Google Meet captions
```

**Key technologies:**
- [whisper-rs](https://github.com/tazz4843/whisper-rs) — on-device speech recognition (Metal)
- [llama-cpp-2](https://github.com/utilityai/llama-cpp-rs) — on-device translation (Metal)
- [ECDICT](https://github.com/skywind3000/ECDICT) — offline English–Chinese dictionary (540k entries)
- [Tauri v2](https://tauri.app) — native macOS transparent overlay window
- RMS energy VAD — skips silent segments to prevent Whisper hallucinations

---

## Building for Distribution

```bash
npm run build --prefix web   # build web dashboard first
npx tauri build
# → src-tauri/target/release/bundle/macos/LearnCaption.app
```
