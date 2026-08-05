export const SCROLLBAR_HIDE_DELAY_MS = 900;

export function installAutoHideScrollbars(
  doc: Document = document,
): () => void {
  const view = doc.defaultView ?? window;
  const hideTimers = new Map<Element, number>();

  function hideScrollbar(element: Element): void {
    element.removeAttribute("data-scrollbar-active");
    hideTimers.delete(element);
  }

  function handleScroll(event: Event): void {
    const element =
      event.target instanceof Element ? event.target : doc.scrollingElement;

    if (!element) {
      return;
    }

    const existingTimer = hideTimers.get(element);
    if (existingTimer !== undefined) {
      view.clearTimeout(existingTimer);
    }

    element.setAttribute("data-scrollbar-active", "true");
    hideTimers.set(
      element,
      view.setTimeout(() => hideScrollbar(element), SCROLLBAR_HIDE_DELAY_MS),
    );
  }

  doc.addEventListener("scroll", handleScroll, {
    capture: true,
    passive: true,
  });

  return () => {
    doc.removeEventListener("scroll", handleScroll, true);
    for (const [element, timer] of hideTimers) {
      view.clearTimeout(timer);
      element.removeAttribute("data-scrollbar-active");
    }
    hideTimers.clear();
  };
}
