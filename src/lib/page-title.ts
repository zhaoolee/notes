export const DOMAIN_PAGE_TITLE = "开源版锤子便签";
export const IP_PAGE_TITLE = "本地化开源版锤子便签";

function isIpv4Address(hostname: string): boolean {
  const segments = hostname.split(".");

  return (
    segments.length === 4 &&
    segments.every(
      (segment) =>
        /^\d{1,3}$/.test(segment) && Number.parseInt(segment, 10) <= 255,
    )
  );
}

export function isIpAddress(hostname: string): boolean {
  const normalizedHostname = hostname
    .trim()
    .replace(/^\[|\]$/g, "")
    .toLowerCase();

  if (isIpv4Address(normalizedHostname)) {
    return true;
  }

  return (
    normalizedHostname.includes(":") &&
    /^[0-9a-f:.]+$/.test(normalizedHostname)
  );
}

export function getPageTitle(hostname: string): string {
  return isIpAddress(hostname) ? IP_PAGE_TITLE : DOMAIN_PAGE_TITLE;
}
