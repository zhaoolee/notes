export type NoteRouteView = "editor" | "preview";

export interface NoteRoute {
  noteId: string;
  view: NoteRouteView;
}

export type NoteRouteHistoryMode = "push" | "replace";

export function parseNoteRouteHash(hash: string): NoteRoute | null {
  if (!hash.startsWith("#")) {
    return null;
  }

  const params = new URLSearchParams(hash.slice(1));
  const noteId = params.get("note")?.trim() ?? "";
  const view = params.get("view");

  if (!noteId || (view !== "editor" && view !== "preview")) {
    return null;
  }

  return {
    noteId,
    view,
  };
}

export function buildNoteRouteHash(route: NoteRoute): string {
  const params = new URLSearchParams();
  params.set("note", route.noteId);
  params.set("view", route.view);
  return `#${params.toString()}`;
}

export function getUrlWithNoteRoute(
  href: string,
  route: NoteRoute | null,
): string {
  const url = new URL(href);
  url.hash = route ? buildNoteRouteHash(route) : "";
  return `${url.pathname}${url.search}${url.hash}`;
}

export function writeCurrentNoteRoute(
  route: NoteRoute | null,
  mode: NoteRouteHistoryMode = "replace",
): void {
  if (typeof window === "undefined") {
    return;
  }

  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const nextUrl = getUrlWithNoteRoute(window.location.href, route);

  if (currentUrl === nextUrl) {
    return;
  }

  window.history[mode === "push" ? "pushState" : "replaceState"](
    window.history.state,
    "",
    nextUrl,
  );
}
