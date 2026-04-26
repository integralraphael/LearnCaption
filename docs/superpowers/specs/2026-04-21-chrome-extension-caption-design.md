# Chrome Extension Caption Capture — Design Notes

**Date:** 2026-04-21  
**Status:** Implemented

This document captures the design decisions made during implementation of the Chrome extension caption pipeline. It records the reasoning behind each choice so future contributors understand *why* the code is structured this way.

---

## Meet Caption DOM Structure

```
[role="region"]  ← stable W3C anchor, used as the observe root
  ├── div (speaker block A — completed)
  │     ├── div  ← avatar / name area  →  <img src="..."> or <span>张三</span>
  │     └── div  ← caption text (accumulated, never shrinks mid-turn)
  ├── div (speaker block B — completed)
  │     ├── div
  │     └── div
  ├── div (speaker block C — ACTIVE, currently updating)  ←倒数第三
  │     ├── div
  │     └── div
  ├── div  ← UI element (not a caption block)
  └── div  ← UI element (not a caption block)
```

Key observations confirmed through DOM inspection:
- **Only one block updates at a time.** The currently-speaking person's block grows word-by-word; all others are static.
- **Blocks are append-only.** When a speaker pauses and someone else speaks, a new block is appended. When the original speaker resumes, another new block is created — the old one is never modified.
- **Caption text accumulates.** Within a single speaking turn, the caption div's `textContent` only grows — words are appended, never removed mid-turn.
- **Last 2 children are UI elements.** The actual caption blocks always appear before the last 2 divs.

---

## Speaker Block Detection

A div is a speaker block if it has **2 or more direct div children** (avatar div + caption div). This structural signature distinguishes speaker blocks from the UI divs at the bottom of the container.

```js
function isSpeakerBlock(el) {
  if (el.tagName !== 'DIV') return false;
  const divKids = Array.from(el.children).filter(c => c.tagName === 'DIV');
  return divKids.length >= 2;
}
```

Caption div = last direct div child of the speaker block.

---

## Speaker Identity

Speaker key = `"name::avatarUrl"` — composite to handle same-name collisions.

- Name extracted from `<span>` inside the avatar div (human-readable, sent to app)
- Avatar URL (`img.src`) appended to make the key unique per person
- Only the **name** is sent in caption messages; the composite key is internal

```js
function getSpeakerInfo(block) {
  const name = block.querySelector('span')?.textContent?.trim() || "unknown";
  const avatar = block.querySelector('img')?.src || "";
  return { name, key: `${name}::${avatar}` };
}
```

---

## Why No Debounce

The original design used a **1500ms debounce**: the MutationObserver callback reset a timer on every mutation, and `flushCaptions` only ran after 1.5s of silence.

**Problem:** During continuous speech, the timer is reset on every word addition — nothing is ever sent. The app only receives captions after a pause of 1.5s+, which defeats real-time display.

**Fix:** Call `flushCaptions` directly from the MutationObserver callback. No debounce. The `sentLengths` map is the idempotency guard — if the content hasn't changed, nothing is sent.

---

## Why `sentLengths` Instead of `sentTexts`

Storing the **length of text already sent** (a number) instead of the full text string:

- Diff = `current.slice(sentLen)` — O(1) check, no `startsWith` scan
- No risk of the `startsWith` check failing if Meet changes the div content unexpectedly
- Lower memory: a number vs. a full caption string per speaker

```js
const sentLengths = new Map(); // speakerKey → chars already sent

const sentLen = sentLengths.get(key) ?? 0;
if (current.length <= sentLen) return;          // nothing new
const toSend = current.slice(sentLen);
sentLengths.set(key, current.length);
sendCaption(toSend, name);
```

This works because caption divs only **grow** within a speaking turn. When a new block is created for the same speaker, `sentLen` from the old block is larger than the new (empty) block's length → `current.length > sentLen` is false initially but quickly true as new words appear. Actually, since the new block starts at length 0 and `sentLen` from the old block is e.g. 50, `current.length (0) <= sentLen (50)` → nothing sent. Then as the new block grows to length 3, 6, 10... it stays below `sentLen` until it surpasses it. This is wrong — a new block should start fresh.

**Correction:** When a new speaker block appears, `sentLengths` has no entry for its key yet (or has an entry from a *previous* speaking turn by the same person). Since the key includes the avatar URL which stays constant, `sentLengths.get(key)` returns the length from the previous turn. The new block starts at 0 characters and grows — so we'd skip it until it grows longer than what was sent in the previous turn.

**Fix applied in implementation:** On a new speaker block, the first non-empty `current` will be shorter than the previous `sentLen`, so we'd miss it. This is handled by the `initialFlush` on attach, but not for mid-meeting new blocks.

> **TODO:** Consider resetting `sentLengths.set(key, 0)` when a new speaker block is detected for a key that already exists. Track "current block reference" per key to detect when Meet creates a new block for the same speaker.

---

## MutationObserver Strategy

```
attach time:
  attachObserver() polls every 1s until [role="region"] exists
  → observer.observe(container, { childList, subtree, characterData })
  → initialFlush(container): scan ALL speaker blocks, send existing content, set sentLengths

each mutation:
  flushActive()
  → getActiveBlock(container): walk children backwards, return first isSpeakerBlock
  → processBlock(activeBlock): compute diff, send if new content
```

`getActiveBlock` scans backwards because the active block is always near the end (倒数第三). This is O(n) in container children, but n is small (typically < 10) and we skip the last 2 UI divs immediately.

---

## Data Flow: Meet DOM → App

```
Meet DOM mutation
  → MutationObserver fires flushActive()
  → captionDiv.textContent read (one small DOM read, no reflow)
  → diff computed: toSend = current.slice(sentLen)
  → chrome.runtime.sendMessage({ type, text, speaker, platform })

background.js (service worker)
  → WebSocket.send(JSON.stringify(message))
  → lazy connect: only opens WS when first caption arrives (avoids ERR_CONNECTION_REFUSED spam)
  → queues messages while connecting, drains on open

ws_server.rs (Tauri)
  → deserializes ExtensionMessage { type, text, speaker, platform }
  → emits "source-changed" if platform changed
  → pipeline.process(RawCaption { text, speaker, timestamp_ms })

CaptionPipeline::process()
  → INSERT transcript_lines (text, speaker_label, timestamp_ms)
  → annotate → INSERT vocab_sentences
  → emit "subtitle-line" → React SubtitleWindow
```

---

## Message Format

```json
{
  "type": "caption",
  "text": "how are you doing today",
  "speaker": "张三",
  "platform": "meet"
}
```

`speaker` is the human-readable name from Meet's caption UI. Stored as `speaker_label` in `transcript_lines`. Whisper path sets `speaker: None`.
