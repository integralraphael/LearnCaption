// Service worker: manages WebSocket connection to LearnCaption desktop app.
// Connects lazily — only when a caption message arrives, not on startup.

const WS_URL = "ws://127.0.0.1:52340";
let ws = null;
const queue = [];

function connect() {
  if (ws && ws.readyState !== WebSocket.CLOSED) return;
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log("[LearnCaption] Connected to desktop app");
    queue.splice(0).forEach(msg => ws.send(msg));
  };

  ws.onclose = () => {
    ws = null;
    // Retry if there are queued messages waiting for a server to come up
    if (queue.length > 0) setTimeout(connect, 1000);
  };

  ws.onerror = () => {
    // Suppress — expected when desktop app isn't running yet
    ws?.close();
  };
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "caption") return;
  const json = JSON.stringify(message);
  if (ws?.readyState === WebSocket.OPEN) {
    console.log("[LearnCaption] ws.send:", json);
    ws.send(json);
  } else {
    queue.push(json);
    connect(); // connect on demand; queued messages sent on open
  }
});
