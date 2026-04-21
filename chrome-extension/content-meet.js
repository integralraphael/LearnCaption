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

// Each speaker block is a direct div child of the container with 2+ div children:
//   [0] avatar/name area  [last] caption text (leaf, no div descendants)
function getCaptionLeaves(container) {
  const results = [];
  for (const block of container.children) {
    if (block.tagName !== 'DIV') continue;
    const divKids = Array.from(block.children).filter(el => el.tagName === 'DIV');
    if (divKids.length < 2) continue;
    const captionDiv = divKids[divKids.length - 1];
    if (captionDiv.querySelector('div') === null &&
        (captionDiv.textContent?.trim().length || 0) > 3) {
      results.push(captionDiv);
    }
  }
  return results;
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
