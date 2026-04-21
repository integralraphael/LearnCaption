// content-meet.js — Google Meet caption observer

// Guard: only one observer instance per page
if (window.__learnCaptionAttached) {
  // Already running — do nothing
} else {
  window.__learnCaptionAttached = true;

  // Last text we actually SENT per speaker (key = avatar src or name)
  const sentTexts = new Map();
  let debounceTimer = null;

  function sendCaption(text) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 4) return;
    chrome.runtime.sendMessage({ type: "caption", text: trimmed, platform: "meet" });
  }

  function getCaptionContainer() {
    return document.querySelector('[aria-label="字幕"][role="region"]') ||
           document.querySelector('[aria-label="Captions"][role="region"]') ||
           document.querySelector('[jscontroller="KPn5nb"]');
  }

  function getSpeakerBlocks(container) {
    return Array.from(container.children).filter(block => {
      if (block.tagName !== 'DIV') return false;
      const divKids = Array.from(block.children).filter(el => el.tagName === 'DIV');
      return divKids.length >= 2;
    });
  }

  function getSpeakerKey(block) {
    const img = block.querySelector('img');
    if (img?.src) return img.src;
    const span = block.querySelector('span');
    return span?.textContent?.trim() || "unknown";
  }

  function getCaptionDiv(block) {
    const divKids = Array.from(block.children).filter(el => el.tagName === 'DIV');
    const last = divKids[divKids.length - 1];
    return (last && last.querySelector('div') === null) ? last : null;
  }

  // Called when debounce fires: read CURRENT caption state and send accumulated text
  function flushCaptions() {
    const container = getCaptionContainer();
    if (!container) return;
    for (const block of getSpeakerBlocks(container)) {
      const captionDiv = getCaptionDiv(block);
      if (!captionDiv) continue;
      const current = captionDiv.textContent?.trim() || "";
      if (!current) continue;
      const key = getSpeakerKey(block);
      const sent = sentTexts.get(key) || "";
      if (current === sent) continue;
      let toSend;
      if (current.startsWith(sent) && sent.length > 0) {
        toSend = current.slice(sent.length).trim();
      } else {
        toSend = current;
      }
      sentTexts.set(key, current);
      if (toSend.length >= 4) sendCaption(toSend);
    }
  }

  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushCaptions, 1500);
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
}
