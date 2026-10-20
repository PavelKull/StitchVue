/** C-003 mock only — not read from GitHub / plugin. */
export const MOCK_INSTALLED_VERSION = "0.1.0";
export const MOCK_AVAILABLE_VERSION = "0.2.0";

export const MOCK_RELEASE_NOTES = `• Faster folder scrolling on large albums
• Viewer neighbor preload improvements
• Settings dialog height stays stable when changing language`;

/** Dev: auto-open update dialog once per session — opt-in via VITE_MOCK_UPDATE_AUTO_PROMPT=true */
export const MOCK_UPDATE_AUTO_PROMPT_DEV =
  import.meta.env.DEV &&
  import.meta.env.MODE !== "test" &&
  import.meta.env.VITE_MOCK_UPDATE_AUTO_PROMPT === "true";
