// content-meet.js — Google Meet caption observer

// Guard: only one observer instance per page load
if (window.__learnCaptionAttached) {
  // Already running — do nothing
} else {
  window.__learnCaptionAttached = true;

  // blockState: block element → array of sentence strings already sent
  const blockState = new WeakMap();

  // Safely send a message; if the extension context is gone, tear everything down.
  function safeSend(msg) {
    try {
      if (!chrome.runtime?.id) { teardown(); return; }
      // Pass a no-op callback so Chrome routes errors through lastError
      // instead of reporting them as uncaught console errors.
      chrome.runtime.sendMessage(msg, () => {
        if (chrome.runtime.lastError) {
          // Context invalidated or background not reachable — stop everything.
          teardown();
        }
      });
    } catch (e) {
      teardown();
    }
  }

  function teardown() {
    captionObserver.disconnect();
    bodyObserver.disconnect();
    isObserving = false;
    stopReconnect();
  }

  // action: "new_block" | "append" | "update"
  function sendCaption(text, speaker, avatar, action) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 4) return;
    console.log("[LearnCaption] send:", { action, speaker, text: trimmed });
    safeSend({ type: "caption", text: trimmed, speaker, avatar, action, platform: "meet" });
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

  function getActiveBlock(container) {
    const children = Array.from(container.children);
    for (let i = children.length - 1; i >= 0; i--) {
      if (isSpeakerBlock(children[i])) return children[i];
    }
    return null;
  }

  function getSentences(captionDiv) {
    const sentences = [];
    for (const node of captionDiv.childNodes) {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (text) sentences.push(text);
    }
    console.log("[LearnCaption] sentences:", sentences, "childNodes:", captionDiv.childNodes.length);
    return sentences;
  }

  function processBlock(block) {
    const captionDiv = getCaptionDiv(block);
    if (!captionDiv) return;
    const { name, avatar } = getSpeakerInfo(block);
    const sentences = getSentences(captionDiv);
    if (sentences.length === 0) return;

    const stored = blockState.get(block) || [];
    const isNewBlock = stored.length === 0;

    // Step 1: finalized version of previously-active sentence
    if (stored.length > 0 && sentences.length > stored.length) {
      const prevLastIdx = stored.length - 1;
      if (sentences[prevLastIdx] !== stored[prevLastIdx]) {
        sendCaption(sentences[prevLastIdx], name, avatar, "update");
      }
    }

    // Step 2: newly finalized sentences (all except the last)
    for (let i = stored.length; i < sentences.length - 1; i++) {
      sendCaption(sentences[i], name, avatar, isNewBlock && i === 0 ? "new_block" : "append");
    }

    // Step 3: active (last) sentence
    const lastIdx = sentences.length - 1;
    const lastSentence = sentences[lastIdx];
    if (lastIdx < stored.length) {
      if (lastSentence !== stored[lastIdx]) {
        sendCaption(lastSentence, name, avatar, "update");
      }
    } else {
      sendCaption(lastSentence, name, avatar, isNewBlock && lastIdx === 0 ? "new_block" : "append");
    }

    blockState.set(block, sentences.slice());
  }

  function initialFlush(container) {
    const children = Array.from(container.children);
    for (const child of children) {
      if (isSpeakerBlock(child)) {
        const captionDiv = getCaptionDiv(child);
        if (captionDiv) {
          const sentences = getSentences(captionDiv);
          if (sentences.length > 0) blockState.set(child, sentences);
        }
      }
    }
  }

  function flushActive() {
    const container = getCaptionContainer();
    if (!container) return;
    const block = getActiveBlock(container);
    if (block) processBlock(block);
  }

  // Inner observer: watches caption content mutations
  const captionObserver = new MutationObserver(flushActive);
  let isObserving = false;

  // Reconnect polling: only runs while CC is active
  let reconnectTimer = null;

  function startReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setInterval(() => {
      safeSend({ type: "ensure_connected" });
    }, 3000);
  }

  function stopReconnect() {
    clearInterval(reconnectTimer);
    reconnectTimer = null;
  }

  function onCCEnabled(container) {
    if (isObserving) return;
    captionObserver.observe(container, { childList: true, subtree: true, characterData: true });
    isObserving = true;
    console.log("[LearnCaption] CC enabled — observing captions");
    initialFlush(container);
    startReconnect();
  }

  function onCCDisabled() {
    if (!isObserving) return;
    captionObserver.disconnect();
    isObserving = false;
    stopReconnect();
    console.log("[LearnCaption] CC disabled — observer disconnected");
  }

  // Outer observer: watches for the caption container appearing/disappearing
  // Handles CC toggle (on/off) without needing a page reload
  const bodyObserver = new MutationObserver(() => {
    const container = getCaptionContainer();
    if (container && !isObserving) {
      onCCEnabled(container);
    } else if (!container && isObserving) {
      onCCDisabled();
    }
  });

  bodyObserver.observe(document.body, { childList: true, subtree: true });

  // Initial check in case CC is already on when the script loads
  const initialContainer = getCaptionContainer();
  if (initialContainer) onCCEnabled(initialContainer);
}
