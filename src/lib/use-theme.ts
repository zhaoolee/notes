import { useEffect, useState } from "react";
import type { ThemeId, ThemePreferenceId } from "../types/app.js";
import { resolveThemePreference } from "./themes.js";

const DARK_MODE_MEDIA_QUERY = "(prefers-color-scheme: dark)";

function getSystemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(DARK_MODE_MEDIA_QUERY).matches
  );
}

export function useResolvedTheme(preference: ThemePreferenceId): ThemeId {
  const [systemPrefersDark, setSystemPrefersDark] =
    useState(getSystemPrefersDark);

  useEffect(() => {
    if (preference !== "system" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia(DARK_MODE_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    setSystemPrefersDark(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, [preference]);

  return resolveThemePreference(preference, systemPrefersDark);
}
