// content-youtube.js — YouTube caption observer

let lastSent = "";

function sendCaption(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 4 || trimmed === lastSent) return;
  lastSent = trimmed;
  chrome.runtime.sendMessage({ type: "caption", text: trimmed, platform: "youtube" });
}

function extractCaptionText() {
  const segments = document.querySelectorAll(".ytp-caption-segment");
  return Array.from(segments)
    .map(el => el.textContent)
    .join(" ")
    .trim();
}

const observer = new MutationObserver(() => {
  const text = extractCaptionText();
  if (text) sendCaption(text);
});

// YouTube loads the player after page load; poll until the caption container exists
function attachObserver() {
  const captionWindow = document.querySelector(".ytp-caption-window-container");
  if (captionWindow) {
    observer.observe(captionWindow, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    console.log("[LearnCaption] Observing YouTube captions");
  } else {
    setTimeout(attachObserver, 1000);
  }
}

attachObserver();
