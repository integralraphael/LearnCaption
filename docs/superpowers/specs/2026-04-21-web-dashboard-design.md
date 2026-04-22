# Web Dashboard — Design Spec

**Date:** 2026-04-21
**Status:** Approved

## Summary

Split LearnCaption into two UIs:
- **Tauri window**: real-time subtitle overlay + WordDetail panel (stays as-is)
- **Web dashboard** (`localhost:52341`): meeting history, vocab book, word lookup — launched automatically by Tauri, accessed in a normal browser

## Architecture

```
Tauri App (on startup)
├── WebSocket server :52340   ← Chrome extension (existing)
├── HTTP server :52341        ← NEW: REST API + static files
├── Tauri window              ← Real-time subtitles + WordDetail (unchanged)
└── SQLite DB                 ← Single source of truth, shared by both
```

- HTTP server starts alongside WS server in Tauri's async runtime
- Binds to `127.0.0.1` only (not exposed externally)
- Serves the web dashboard's static build output and REST API endpoints
- Uses `axum` for HTTP routing (lightweight, async, Tokio-native)

## REST API

All endpoints prefixed with `/api/`, bound to `127.0.0.1:52341`.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/meetings` | GET | List all meetings (id, title, started_at, ended_at) |
| `/api/meetings/:id/transcript` | GET | Get transcript lines for a meeting |
| `/api/vocab` | GET | List all vocabulary entries |
| `/api/vocab` | POST | Add a vocabulary entry |
| `/api/vocab/:id/master` | POST | Mark a vocab entry as mastered |
| `/api/vocab/:id/sentences` | GET | Get example sentences for a vocab entry |
| `/api/word/:word` | GET | Look up a word in ECDICT dictionary |
| `/api/tts` | POST | Speak text via macOS TTS |

These map 1:1 to existing Tauri commands. The Rust query logic is reused; only the HTTP handler layer is new.

## Web Frontend

Independent React project in a `web/` directory at the project root. Built separately, output served by the Rust HTTP server as static files.

### Pages

**Meeting History** — `/meetings`
- Left panel: meeting list sorted by date (title, start time, duration)
- Right panel: transcript of selected meeting with clickable words
- Clicking a word shows inline definition (via `/api/word/:word`)

**Vocab Book** — `/vocab`
- Table/list of all vocabulary entries (word, definition, occurrence count, familiarity)
- Sorting and filtering support
- Click to expand inline: full definition, example sentences from transcripts, mastery toggle, pronunciation button

### Tech Stack
- React (same ecosystem as Tauri frontend, no new framework to learn)
- Vite for build tooling
- Plain CSS or lightweight utility library (decided at implementation time)

## Tauri-Side Changes

### New
- HTTP server module (`src-tauri/src/http_server/`) using `axum`
- Starts in `main.rs` setup, same pattern as WS server (bind + spawn)
- Shares `AppDb` and `EcdictDictionary` via `axum::Extension` or state

### Unchanged
- Subtitle window, WordDetail panel, Token component
- WebSocket server, CaptionPipeline
- Chrome extension

### Deferred Removal
- VocabBook and ReviewPage components in Tauri frontend can be removed once the web dashboard is stable. Not part of the initial implementation — both UIs coexist during transition.

## Data Flow

```
Browser (web dashboard)
  → HTTP GET/POST to localhost:52341/api/*
    → axum handler
      → reuses existing DB query functions (list_meetings, list_entries, etc.)
      → reads/writes SQLite DB
    ← JSON response
  ← renders in React
```

No new database tables or schema changes required. All existing tables (meetings, transcript_lines, vocabulary, vocab_sentences) are sufficient.

## Non-Goals

- No authentication (localhost only)
- No real-time updates on the web dashboard (refresh to see new data is fine for v1)
- No mobile/responsive design (desktop browser is the target)
- No migration of subtitle window to web — Tauri overlay stays for always-on-top capability
