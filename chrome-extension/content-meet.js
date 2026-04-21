// content-meet.js — Google Meet caption observer

// Known caption container selectors (in order of preference).
// Meet's DOM changes with updates; the aria-live fallback is most stable.
const CAPTION_SELECTORS = [
  '.ygicle.VbkSUe',          // Caption text container (Meet 2025)
  '.nMcdL.bj4p3b',           // Caption window fallback
  '[jsname="tgaKEf"]',       // Older Meet versions
  '[aria-live="polite"]',
  '[aria-live="assertive"]',
];

let lastSent = "";
let debounceTimer = null;

function getCaptionText() {
  for (const sel of CAPTION_SELECTORS) {
    const el = document.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text && text.length > 3) return text;
  }
  return "";
}

function sendCaption(text) {
  const trimmed = text.trim();
  // Skip if empty, too short, or identical to last sent
  if (!trimmed || trimmed.length < 4 || trimmed === lastSent) return;
  lastSent = trimmed;
  chrome.runtime.sendMessage({ type: "caption", text: trimmed, platform: "meet" });
}

// Observe all DOM changes; debounce to avoid sending partial words
const observer = new MutationObserver(() => {
  const text = getCaptionText();
  if (!text) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => sendCaption(text), 600);
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
});
