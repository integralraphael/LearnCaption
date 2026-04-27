import { createContext, useContext } from "react";

export type ColorMode = "single" | "proficiency";
export type TranslationPosition = "inline_bracket" | "below_stagger" | "none";

export interface DisplayConfig {
  colorMode: ColorMode;
  colorSingle: string;
  colorEasy: string;    // backend "yellow" tier
  colorMedium: string;  // backend "orange" tier
  colorHard: string;    // backend "red" tier
  /** Color applied to auto-translated tokens (frq > threshold, not in vocab book) */
  colorAutoTranslate: string;
  translationPosition: TranslationPosition;
  sentenceTranslation: boolean;
  /** Auto-annotate hard words (frq > calibration threshold) with ECDICT definitions inline */
  autoTranslate: boolean;
  /** Window background opacity 0–100 */
  opacity: number;
}

export const defaultDisplayConfig: DisplayConfig = {
  colorMode: "proficiency",
  colorSingle: "#fbbf24",
  colorEasy: "#fbbf24",
  colorMedium: "#f97316",
  colorHard: "#ef4444",
  colorAutoTranslate: "#94a3b8",
  translationPosition: "inline_bracket",
  sentenceTranslation: false,
  autoTranslate: false,
  opacity: 85,
};

export const DB_KEY_MAP: Record<keyof DisplayConfig, string> = {
  colorMode: "display_color_mode",
  colorSingle: "display_color_single",
  colorEasy: "display_color_easy",
  colorMedium: "display_color_medium",
  colorHard: "display_color_hard",
  colorAutoTranslate: "display_color_auto_translate",
  translationPosition: "display_translation_position",
  sentenceTranslation: "display_sentence_translation",
  autoTranslate: "auto_translate",
  opacity: "display_opacity",
};

export const PRESET_COLORS = [
  "#fbbf24", // amber
  "#f97316", // orange
  "#ef4444", // red
  "#34d399", // green
  "#60a5fa", // blue
  "#a78bfa", // purple
  "#94a3b8", // gray
];

export const DisplaySettingsContext = createContext<DisplayConfig>(defaultDisplayConfig);
export const useDisplaySettings = () => useContext(DisplaySettingsContext);
