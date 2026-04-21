// content-meet.js — Google Meet caption observer

// Guard: only one observer instance per page
if (window.__learnCaptionAttached) {
  // Already running — do nothing
} else {
  window.__learnCaptionAttached = true;

  // blockState: block element → last text seen in that block
  // Using the block DOM element as key (WeakMap) is correct because:
  //   - same speaker in a NEW block (after a pause) = new utterance → WeakMap sees new element → isNew:true
  //   - same block updated by Meet = continuation → same element reference → isNew:false
  const blockState = new WeakMap();

  function sendCaption(text, speaker, avatar, isNew) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 4) return;
    console.log("[LearnCaption] send:", { isNew, speaker, text: trimmed });
    chrome.runtime.sendMessage({ type: "caption", text: trimmed, speaker, avatar, isNew, platform: "meet" });
  }

  function getCaptionContainer() {
    return document.querySelector('[aria-label="字幕"][role="region"]') ||
           document.querySelector('[aria-label="Captions"][role="region"]') ||
           document.querySelector('[jscontroller="KPn5nb"]');
  }

  function isSpeakerBlock(el) {
    if (el.tagName !== 'DIV') return false;
    const divKids = Array.from(el.children).filter(c => c.tagName === 'DIV');
    return divKids.length >= 2;
  }

  function getSpeakerInfo(block) {
    const span = block.querySelector('span');
    const name = span?.textContent?.trim() || "unknown";
    const img = block.querySelector('img');
    const avatar = img?.src || "";
    return { name, avatar };
  }

  function getCaptionDiv(block) {
    const divKids = Array.from(block.children).filter(el => el.tagName === 'DIV');
    return divKids.length >= 1 ? divKids[divKids.length - 1] : null;
  }

  // Find the last speaker block (active one — last 2 divs in container are UI elements)
  function getActiveBlock(container) {
    const children = Array.from(container.children);
    for (let i = children.length - 1; i >= 0; i--) {
      if (isSpeakerBlock(children[i])) return children[i];
    }
    return null;
  }

  let debounceTimer = null;

  function processBlock(block) {
    const captionDiv = getCaptionDiv(block);
    if (!captionDiv) return;
    const current = (captionDiv.textContent || "").replace(/\s+/g, " ").trim();
    if (!current) return;
    const { name, avatar } = getSpeakerInfo(block);

    const stored = blockState.get(block);
    if (current === stored) return;

    // Send full text every time — Meet's ASR may revise earlier words,
    // so diffs are unreliable. The backend replaces the current line.
    const isNew = (stored === undefined);
    blockState.set(block, current);
    sendCaption(current, name, avatar, isNew);
  }

  // On attach: scan all existing speaker blocks and set state as baseline
  // without sending them (avoids flooding the UI with old history).
  function initialFlush(container) {
    const children = Array.from(container.children);
    for (const child of children) {
      if (isSpeakerBlock(child)) {
        const captionDiv = getCaptionDiv(child);
        if (captionDiv) {
          const current = (captionDiv.textContent || "").replace(/\s+/g, " ").trim();
          if (current) blockState.set(child, current);
        }
      }
    }
  }

  // On each mutation: only process the active (last) speaker block
  function flushActive() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const container = getCaptionContainer();
      if (!container) return;
      const block = getActiveBlock(container);
      if (block) processBlock(block);
    }, 600);
  }

  const observer = new MutationObserver(flushActive);

  function attachObserver() {
    const container = getCaptionContainer();
    if (container) {
      observer.observe(container, { childList: true, subtree: true, characterData: true });
      console.log("[LearnCaption] Observing Meet captions");
      initialFlush(container);
    } else {
      setTimeout(attachObserver, 1000);
    }
  }

  attachObserver();
}
