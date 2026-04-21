// content-meet.js — Google Meet caption observer

// Key: speaker identity (avatar src or name), Value: last seen caption text
const speakerTexts = new Map();
let lastSent = "";
let debounceTimer = null;

function sendCaption(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 4 || trimmed === lastSent) return;
  lastSent = trimmed;
  chrome.runtime.sendMessage({ type: "caption", text: trimmed, platform: "meet" });
}

function getCaptionContainer() {
  return document.querySelector('[aria-label="字幕"][role="region"]') ||
         document.querySelector('[aria-label="Captions"][role="region"]') ||
         document.querySelector('[jscontroller="KPn5nb"]');
}

// Each speaker block: direct div child of container with 2+ div children.
// Structure: [avatar/name div, caption text div (leaf)]
function getSpeakerBlocks(container) {
  return Array.from(container.children).filter(block => {
    if (block.tagName !== 'DIV') return false;
    const divKids = Array.from(block.children).filter(el => el.tagName === 'DIV');
    return divKids.length >= 2;
  });
}

// Stable identity for a speaker block: avatar src > speaker name > fallback
function getSpeakerKey(block) {
  const img = block.querySelector('img');
  if (img?.src) return img.src;
  const span = block.querySelector('span');
  if (span?.textContent?.trim()) return span.textContent.trim();
  return block.textContent?.trim().slice(0, 20) || "unknown";
}

function getCaptionDiv(block) {
  const divKids = Array.from(block.children).filter(el => el.tagName === 'DIV');
  const last = divKids[divKids.length - 1];
  return (last && last.querySelector('div') === null) ? last : null;
}

const observer = new MutationObserver(() => {
  const container = getCaptionContainer();
  if (!container) return;

  for (const block of getSpeakerBlocks(container)) {
    const captionDiv = getCaptionDiv(block);
    if (!captionDiv) continue;

    const current = captionDiv.textContent?.trim() || "";
    if (!current) continue;

    const key = getSpeakerKey(block);
    const prev = speakerTexts.get(key) || "";
    if (current === prev) continue;

    let newText;
    if (current.startsWith(prev) && prev.length > 0) {
      // Same speaker accumulating: only send the newly appended suffix
      newText = current.slice(prev.length).trim();
    } else {
      // New speaker turn or reset
      newText = current;
    }
    speakerTexts.set(key, current);

    if (newText && newText.length >= 4) {
      clearTimeout(debounceTimer);
      // 1500ms debounce: wait for a natural pause before sending
      debounceTimer = setTimeout(() => sendCaption(newText), 1500);
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
