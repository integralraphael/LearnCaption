# Contextual Translation — Design Spec

**Date:** 2026-04-21
**Status:** Approved

## Summary

Replace ECDICT-only word lookup with a two-layer translation system:

1. **ECDICT** — instant fallback, shown immediately on click
2. **HY-MT 1.5B** — contextual AI translation (brings full sentence as context), replaces ECDICT result within ~500ms

No external dependencies. The model is embedded via `llama-cpp-rs` and downloaded automatically on first use, same pattern as the Whisper model.

Both the **Tauri subtitle window** and the **web dashboard transcript view** support the same interaction: click a word or drag-select a phrase to look it up.

---

## User Interaction

### Tauri subtitle window
- **Click** a single word token → look up that word, sentence = the line it came from
- **Drag-select** across tokens → look up the selected phrase, sentence = the same line

### Web dashboard (transcript view)
- **Click** a single word in transcript text → same lookup
- **Drag-select** a phrase in transcript text → same lookup

Both surfaces call the same underlying lookup pipeline and show the same WordDetail result.

---

## Translation Pipeline

```
User selects word or phrase
  │
  ├─► ECDICT lookup (sync, <1ms)
  │     → display basic definition immediately
  │
  └─► HY-MT 1.5B inference (async, ~300-700ms)
        prompt: word/phrase + full sentence context
        → replace ECDICT result in WordDetail panel
```

### Prompt template

```
You are a precise English-to-Chinese translator.

Sentence: "{full_sentence}"
Word/phrase: "{selection}"

Translate "{selection}" as used in this sentence. Output only the Chinese meaning (1-2 lines). If it is slang or an idiom, briefly note the nuance in parentheses.
```

---

## Model: HY-MT 1.5B

- **Format:** GGUF (Q4_K_M quantization, ~1.1GB)
- **Runtime:** `llama-cpp-rs` (Rust bindings to llama.cpp), Metal backend on Apple Silicon
- **Download:** automatic on first lookup, stored in Tauri app data dir alongside Whisper model
- **Inference:** runs in a dedicated Tokio blocking thread, does not block the UI

### Why HY-MT over Qwen
HY-MT is purpose-trained for translation (not chat), so it produces cleaner, more direct output for short word/phrase lookups. Qwen is kept as a fallback option if HY-MT GGUF is unavailable.

### ECDICT role after HY-MT lands
ECDICT remains for:
- Instant first-render (before HY-MT responds)
- Fallback if model not yet downloaded
- Real-time vocab highlighting (Aho-Corasick matching, zero-latency, unaffected)

---

## WordDetail Panel Changes (Tauri)

Current: shows ECDICT definition list, user picks relevant meaning.

New:
1. Panel opens immediately with ECDICT result (greyed out / "looking up…" indicator)
2. HY-MT result replaces it: single contextual definition + optional slang note
3. "Add to vocab" saves the word/phrase + HY-MT definition (not the ECDICT list)
4. ECDICT raw entries available as a collapsed "dictionary" section for reference

---

## Web Dashboard Integration

The web transcript view calls `POST /api/translate`:

```json
Request:  { "selection": "break a leg", "sentence": "Break a leg tonight!" }
Response: { "ecdict": "...", "hymt": "...", "hymt_ready": true }
```

The web frontend shows the same two-phase result (ECDICT → HY-MT) via a simple loading state.

---

## Phrase Selection

### Tauri
Subtitle tokens are rendered as individual `<span>` elements. Drag-select captures `window.getSelection()` — the selected text is sent as `selection`, the parent line's `rawText` as `sentence`.

### Web
Standard browser text selection on transcript text. Same `getSelection()` approach.

---

## Model Management

Mirrors existing Whisper model management:

| | Whisper | HY-MT |
|---|---|---|
| Check exists | `check_model()` | `check_translation_model()` |
| Download | `start_model_download()` | `start_translation_model_download()` |
| Storage | `{app_data}/whisper/` | `{app_data}/hymt/` |
| UI | Download prompt on first use | Same prompt pattern |

---

## Non-Goals

- No streaming output (word/phrase lookups are short; wait for full response)
- No Chinese-to-English or other language pairs
- No batch translation of entire transcript lines (only on-demand lookup)
- No fine-tuning or custom model training
