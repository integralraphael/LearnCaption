import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface PopoverOptions {
  word: string;
  context: string;
  isPhrase: boolean;
  /** Screen coordinates of the clicked word */
  anchorX: number;
  anchorY: number;
}

let popoverWindow: WebviewWindow | null = null;
let clickUnlisten: (() => void) | null = null;

export async function openWordPopover(opts: PopoverOptions) {
  // Close existing popover
  await closeWordPopover();

  const mainWin = getCurrentWindow();
  const mainPos = await mainWin.outerPosition();
  const scaleFactor = await mainWin.scaleFactor();

  // Position above the clicked word
  const popoverWidth = 300;
  const popoverHeight = 220;
  const x = Math.round(mainPos.x / scaleFactor + opts.anchorX - popoverWidth / 2);
  const y = Math.round(mainPos.y / scaleFactor - popoverHeight - 8);

  const base = window.location.origin;
  popoverWindow = new WebviewWindow("word-detail", {
    url: `${base}?popover=true&word=${encodeURIComponent(opts.word)}&context=${encodeURIComponent(opts.context)}&isPhrase=${opts.isPhrase}`,
    width: popoverWidth,
    height: popoverHeight,
    x: Math.max(0, x),
    y: Math.max(0, y),
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    focus: true,
    resizable: false,
    skipTaskbar: true,
  });

  // Close when the popover window loses focus (clicking another app)
  popoverWindow.onFocusChanged(({ payload: focused }) => {
    if (!focused) closeWordPopover();
  });

  // Close when the user clicks anywhere in the main window
  const handler = () => closeWordPopover();
  setTimeout(() => {
    document.addEventListener("click", handler);
    clickUnlisten = () => document.removeEventListener("click", handler);
  }, 0);
}

export async function closeWordPopover() {
  clickUnlisten?.();
  clickUnlisten = null;
  if (popoverWindow) {
    try {
      await popoverWindow.close();
    } catch {
      // Already closed
    }
    popoverWindow = null;
  }
}
