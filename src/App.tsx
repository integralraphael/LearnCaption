import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { AnnotatedLine } from "./types/subtitle";

export default function App() {
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    invoke<boolean>("check_model").then(setReady);
    listen<number>("model-download-progress", (e) => setProgress(e.payload));
    listen("model-download-done", () => setReady(true));
    listen<AnnotatedLine>("subtitle-line", (e) =>
      console.log("subtitle:", e.payload)
    );
  }, []);

  if (!ready)
    return (
      <div>
        <p>Downloading model... {Math.round(progress * 100)}%</p>
        <button onClick={() => invoke("start_model_download")}>Download</button>
      </div>
    );

  return (
    <div>
      <button onClick={() => invoke("start_recording")}>Start</button>
      <button onClick={() => invoke("stop_recording")}>Stop</button>
    </div>
  );
}
