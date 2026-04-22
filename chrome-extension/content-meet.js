// content-meet.js — Google Meet caption observer

// Guard: only one observer instance per page
if (window.__learnCaptionAttached) {
  // Already running — do nothing
} else {
  window.__learnCaptionAttached = true;

  // blockState: block element → array of sentence strings already sent
  // Each text node in the caption div is a sentence.
  // Only the last sentence can change (ASR revision); earlier ones are finalized.
  const blockState = new WeakMap();

  // action: "new_block" | "append" | "update"
  function sendCaption(text, speaker, avatar, action) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 4) return;
    console.log("[LearnCaption] send:", { action, speaker, text: trimmed });
    chrome.runtime.sendMessage({ type: "caption", text: trimmed, speaker, avatar, action, platform: "meet" });
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

  // Extract sentences from caption div's child nodes (text nodes or elements)
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

    const stored = blockState.get(block) || []; // array of sent sentence strings
    const isNewBlock = stored.length === 0;

    // Step 1: If previously-active sentence got finalized with changes, update it
    if (stored.length > 0 && sentences.length > stored.length) {
      const prevLastIdx = stored.length - 1;
      if (sentences[prevLastIdx] !== stored[prevLastIdx]) {
        sendCaption(sentences[prevLastIdx], name, avatar, "update");
      }
    }

    // Step 2: Send newly appeared finalized sentences (not the last — it's still active)
    for (let i = stored.length; i < sentences.length - 1; i++) {
      sendCaption(sentences[i], name, avatar, isNewBlock && i === 0 ? "new_block" : "append");
    }

    // Step 3: Handle the active (last) sentence
    const lastIdx = sentences.length - 1;
    const lastSentence = sentences[lastIdx];

    if (lastIdx < stored.length) {
      // Same index as before — text revised by ASR
      if (lastSentence !== stored[lastIdx]) {
        sendCaption(lastSentence, name, avatar, "update");
      }
    } else {
      // Brand new sentence
      sendCaption(lastSentence, name, avatar, isNewBlock && lastIdx === 0 ? "new_block" : "append");
    }

    blockState.set(block, sentences.slice());
  }

  // On attach: scan all existing speaker blocks and set state as baseline
  // without sending them (avoids flooding the UI with old history).
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
