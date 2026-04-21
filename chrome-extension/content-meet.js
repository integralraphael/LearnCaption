// content-meet.js — Google Meet caption observer

let prevText = "";
let lastSent = "";
let debounceTimer = null;

function sendCaption(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 4 || trimmed === lastSent) return;
  lastSent = trimmed;
  chrome.runtime.sendMessage({ type: "caption", text: trimmed, platform: "meet" });
}

function getCaptionDiv() {
  // role="region" with aria-label is stable W3C accessibility markup
  const region = document.querySelector('[role="region"][aria-label]');
  if (region) return region.querySelector('div > div:first-child > div:last-child') || region;
  // Fallback: known class (may change with Meet updates)
  return document.querySelector('.ygicle') || document.querySelector('[jscontroller="KPn5nb"]');
}

const observer = new MutationObserver(() => {
  const el = getCaptionDiv();
  if (!el) return;

  const current = el.textContent?.trim() || "";
  if (!current || current === prevText) return;

  let newText;
  if (current.startsWith(prevText) && prevText.length > 0) {
    // Accumulation: extract only the newly appended suffix
    newText = current.slice(prevText.length).trim();
  } else {
    // Reset or new speaker: send the whole new text
    newText = current;
  }
  prevText = current;

  if (newText && newText.length >= 4) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => sendCaption(newText), 600);
  }
});

function attachObserver() {
  const container = document.querySelector('[role="region"][aria-label]') ||
                    document.querySelector('[jscontroller="KPn5nb"]');
  if (container) {
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    console.log("[LearnCaption] Observing Meet captions");
  } else {
    setTimeout(attachObserver, 1000);
  }
}

attachObserver();
