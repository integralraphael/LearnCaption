// content-youtube.js — YouTube caption observer

let lastSentText = "";
let lastSentTime = 0;
const SESSION_GAP_MS = 3000; // 3 seconds gap means a new utterance

function sendCaption(text, isNew) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 2) return;
  chrome.runtime.sendMessage({
    type: "caption",
    text: trimmed,
    isNew,
    platform: "youtube"
  });
}

function extractCaptionText() {
  const segments = document.querySelectorAll(".ytp-caption-segment");
  return Array.from(segments)
    .map(el => el.textContent)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function flush() {
  const current = extractCaptionText();
  if (!current || current === lastSentText) return;

  const now = Date.now();
  const timeSinceLast = now - lastSentTime;

  // Send full text every time — backend replaces the current line.
  // A long gap means a new utterance.
  const isNew = !lastSentText || timeSinceLast > SESSION_GAP_MS;

  sendCaption(current, isNew);
  lastSentText = current;
  lastSentTime = now;
}

const observer = new MutationObserver(flush);

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
