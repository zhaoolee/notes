import { create } from "zustand";
import { getInitialMarkdown, getInitialTheme } from "../lib/app-state";
import type { CopyState, PendingAction, ThemeId } from "../types/app";

interface AppStoreState {
  markdown: string;
  selectedTheme: ThemeId;
  isExporting: boolean;
  exportError: string;
  copyState: CopyState;
  pendingAction: PendingAction | null;
  setMarkdown: (markdown: string) => void;
  setSelectedTheme: (theme: ThemeId) => void;
  setIsExporting: (isExporting: boolean) => void;
  setExportError: (exportError: string) => void;
  setCopyState: (copyState: CopyState) => void;
  requestReplaceMarkdown: (
    nextMarkdown: string,
    title: string,
    description: string,
  ) => void;
  clearPendingAction: () => void;
  confirmReplaceMarkdown: () => void;
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  markdown: getInitialMarkdown(),
  selectedTheme: getInitialTheme(),
  isExporting: false,
  exportError: "",
  copyState: "idle",
  pendingAction: null,
  setMarkdown: (markdown) => set({ markdown }),
  setSelectedTheme: (selectedTheme) => set({ selectedTheme }),
  setIsExporting: (isExporting) => set({ isExporting }),
  setExportError: (exportError) => set({ exportError }),
  setCopyState: (copyState) => set({ copyState }),
  requestReplaceMarkdown: (nextMarkdown, title, description) =>
    set({
      pendingAction: {
        nextMarkdown,
        title,
        description,
      },
    }),
  clearPendingAction: () => set({ pendingAction: null }),
  confirmReplaceMarkdown: () => {
    const { pendingAction } = get();

    if (!pendingAction) {
      return;
    }

    set({
      markdown: pendingAction.nextMarkdown,
      pendingAction: null,
    });
  },
}));
