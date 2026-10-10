/**
 * API paths that must not require session / x-api-key at the edge proxy.
 * Authentication for these routes is handled inside the route handler
 * (e.g. Datafy HMAC-SHA256 on /api/webhooks/datafy).
 */
export const PUBLIC_API_PREFIXES = [
    "/api/auth",
    "/api/test",
    "/api/webhooks/datafy",
] as const;

export function isPublicApiPath(pathname: string): boolean {
    return PUBLIC_API_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    );
}
