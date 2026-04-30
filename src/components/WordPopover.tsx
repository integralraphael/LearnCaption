import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";

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
  const [mainPos, scaleFactor] = await Promise.all([
    mainWin.outerPosition(),
    mainWin.scaleFactor(),
  ]);

  const popoverWidth = 300;
  const popoverHeight = 280;

  // Work entirely in physical pixels so multi-monitor / mixed-DPI setups are correct.
  // outerPosition() is already physical; anchorX/Y are logical CSS pixels → multiply by sf.
  const clickPhysX = mainPos.x + Math.round(opts.anchorX * scaleFactor);
  const clickPhysY = mainPos.y + Math.round(opts.anchorY * scaleFactor);
  const physW = Math.round(popoverWidth * scaleFactor);
  const physH = Math.round(popoverHeight * scaleFactor);

  const physX = clickPhysX - Math.round(physW / 2);
  const physY = opts.anchorY > window.innerHeight * 0.55
    ? clickPhysY - physH - Math.round(8 * scaleFactor)
    : clickPhysY + Math.round(8 * scaleFactor);

  const base = window.location.origin;
  // Start hidden so we can set position before the window appears (no flash).
  popoverWindow = new WebviewWindow("word-detail", {
    url: `${base}?popover=true&word=${encodeURIComponent(opts.word)}&context=${encodeURIComponent(opts.context)}&isPhrase=${opts.isPhrase}`,
    width: popoverWidth,
    height: popoverHeight,
    visible: false,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    focus: false,
    resizable: false,
    skipTaskbar: true,
  });

  popoverWindow.once("tauri://created", async () => {
    if (!popoverWindow) return;
    await popoverWindow.setPosition(new PhysicalPosition(physX, physY));
    await popoverWindow.show();
    await popoverWindow.setFocus();
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
