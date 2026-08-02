export const RESET_TEST_DATA_SEARCH_PARAM = "resetTestData";

export function getUrlAfterConsumingTestDataReset(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(RESET_TEST_DATA_SEARCH_PARAM);

  return `${url.pathname}${url.search}${url.hash}`;
}

export function consumeTestDataResetFromCurrentUrl(): void {
  if (typeof window === "undefined") {
    return;
  }

  const resetValue = new URLSearchParams(window.location.search).get(
    RESET_TEST_DATA_SEARCH_PARAM,
  );

  if (resetValue !== "1") {
    return;
  }

  window.history.replaceState(
    window.history.state,
    "",
    getUrlAfterConsumingTestDataReset(window.location.href),
  );
}
