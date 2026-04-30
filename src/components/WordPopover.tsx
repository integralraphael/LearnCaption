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
  const [mainPos, mainSize, scaleFactor] = await Promise.all([
    mainWin.outerPosition(),
    mainWin.outerSize(),
    mainWin.scaleFactor(),
  ]);

  const mainX = mainPos.x / scaleFactor;
  const mainY = mainPos.y / scaleFactor;
  const mainW = mainSize.width / scaleFactor;
  const mainH = mainSize.height / scaleFactor;

  const popoverWidth = 300;
  const popoverHeight = 280;

  // Horizontally: centered on the clicked word, clamped inside the main window
  const x = Math.round(
    Math.max(mainX, Math.min(mainX + mainW - popoverWidth,
      mainX + opts.anchorX - popoverWidth / 2))
  );

  // Vertically: overlap the bottom of the main window by 20px so it looks attached.
  // If the popover would go off-screen below, flip it to overlap the top instead.
  const yBelow = Math.round(mainY + mainH - 20);
  const yAbove = Math.round(mainY - popoverHeight + 20);
  const spaceBelow = window.screen.height - yBelow - popoverHeight;
  const y = spaceBelow >= 0 ? yBelow : yAbove;

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
