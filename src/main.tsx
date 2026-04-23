import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { WordDetail } from "./components/WordDetail";
import "./App.css";

const params = new URLSearchParams(window.location.search);
const isPopover = params.get("popover") === "true";

function PopoverApp() {
  const word = params.get("word") ?? "";
  const context = params.get("context") ?? "";
  const isPhrase = params.get("isPhrase") === "true";

  return (
    <div style={{
      background: "rgba(15,23,42,0.95)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      borderRadius: "10px",
      border: "1px solid rgba(255,255,255,0.08)",
      padding: "8px 12px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
      color: "#e2e8f0",
      height: "100vh",
      overflow: "auto",
    }}>
      <WordDetail
        word={word}
        context={context}
        isPhrase={isPhrase}
        onClose={() => {
          import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
            getCurrentWindow().close();
          });
        }}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isPopover ? <PopoverApp /> : <App />}
  </React.StrictMode>,
);
