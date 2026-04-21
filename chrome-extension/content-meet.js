// content-meet.js — Google Meet caption observer
// Handles multiple speakers: each speaker has their own caption div inside
// the jscontroller="KPn5nb" container.

const speakerTexts = new WeakMap(); // leaf div → last seen text
let lastSent = "";
let debounceTimer = null;

function sendCaption(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 4 || trimmed === lastSent) return;
  lastSent = trimmed;
  chrome.runtime.sendMessage({ type: "caption", text: trimmed, platform: "meet" });
}

function getCaptionContainer() {
  return document.querySelector('[jscontroller="KPn5nb"]') ||
         document.querySelector('[aria-label="字幕"][role="region"]') ||
         document.querySelector('[aria-label="Captions"][role="region"]');
}

// Caption text divs are leaf divs (no div children) with actual text.
function getCaptionLeaves(container) {
  return Array.from(container.querySelectorAll('div')).filter(
    el => el.querySelectorAll('div').length === 0 && (el.textContent?.trim().length || 0) > 3
  );
}

const observer = new MutationObserver(() => {
  const container = getCaptionContainer();
  if (!container) return;

  for (const leaf of getCaptionLeaves(container)) {
    const current = leaf.textContent?.trim() || "";
    const prev = speakerTexts.get(leaf) || "";
    if (!current || current === prev) continue;

    let newText;
    if (current.startsWith(prev) && prev.length > 0) {
      // Same speaker: only send the newly appended suffix
      newText = current.slice(prev.length).trim();
    } else {
      // New speaker block or reset
      newText = current;
    }
    speakerTexts.set(leaf, current);

    if (newText && newText.length >= 4) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => sendCaption(newText), 600);
    }
  }
});

function attachObserver() {
  const container = getCaptionContainer();
  if (container) {
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    console.log("[LearnCaption] Observing Meet captions");
  } else {
    setTimeout(attachObserver, 1000);
  }
}

attachObserver();
