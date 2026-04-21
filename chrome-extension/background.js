// Service worker: manages WebSocket connection to LearnCaption desktop app.
// Content scripts send messages here; we relay them over the WebSocket.

const WS_URL = "ws://127.0.0.1:52340";
let ws = null;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log("[LearnCaption] Connected to desktop app");
  };

  ws.onclose = () => {
    // Auto-reconnect every 3 seconds while app is open
    setTimeout(connect, 3000);
  };

  ws.onerror = () => {
    ws.close(); // triggers onclose → reconnect
  };
}

connect();

// Relay caption messages from content scripts to the desktop app
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "caption" && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
});
