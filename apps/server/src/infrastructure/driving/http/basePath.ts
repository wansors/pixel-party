// BASE_PATH support: the request path as the app sees it. A proxy may pass the prefix through
// (`/pixel-party/api/rooms`) or strip it (`/api/rooms`); both are served the same, so either kind of
// proxy setup works with the one setting.
export function withinBase(pathname: string, base: string): string {
  if (!base) return pathname
  if (pathname === base || pathname.startsWith(`${base}/`))
    return pathname.slice(base.length) || '/'
  return pathname
}
