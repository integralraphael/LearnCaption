// content-meet.js — Google Meet caption observer

let lastSent = "";
let debounceTimer = null;

function sendCaption(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 4 || trimmed === lastSent) return;
  lastSent = trimmed;
  chrome.runtime.sendMessage({ type: "caption", text: trimmed, platform: "meet" });
}

function findCaptionContainer() {
  // jscontroller is more stable than obfuscated class names
  return (
    document.querySelector('[jscontroller="KPn5nb"]') ||
    document.querySelector('.ygicle')
  );
}

// Send only newly added text nodes, not the full accumulated history
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
      for (const node of mutation.addedNodes) {
        const text = node.textContent?.trim();
        if (text && text.length > 3) {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => sendCaption(text), 600);
        }
      }
    } else if (mutation.type === "characterData") {
      const text = mutation.target.textContent?.trim();
      if (text && text.length > 3) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => sendCaption(text), 600);
      }
    }
  }
});

// Poll until the caption container appears (Meet loads it lazily)
function attachObserver() {
  const container = findCaptionContainer();
  if (container) {
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    console.log("[LearnCaption] Observing Meet captions");
  } else {
    setTimeout(attachObserver, 1000);
  }
}

attachObserver();
