interface NavigatorLike {
  maxTouchPoints?: number;
  platform?: string;
  userAgent?: string;
}

export function shouldUseIosFormlessEditor(
  navigatorLike: NavigatorLike | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator,
): boolean {
  if (!navigatorLike) {
    return false;
  }

  const userAgent = navigatorLike.userAgent ?? "";
  const platform = navigatorLike.platform ?? "";

  return (
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && (navigatorLike.maxTouchPoints ?? 0) > 1)
  );
}
