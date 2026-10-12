/**
 * Paths that must bypass auth at the edge proxy so <img src> on public
 * pages (login) can load Next.js `public/` files.
 */

const STATIC_EXTENSIONS = [
    ".svg",
    ".ico",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".woff",
    ".woff2",
    ".ttf",
] as const;

/** True when pathname is a static file under /media (login branding, etc.). */
export function isPublicMediaAssetPath(pathname: string): boolean {
    if (!pathname.startsWith("/media/")) return false;
    if (pathname.includes("..") || pathname.includes("\\")) return false;
    const lower = pathname.toLowerCase();
    return STATIC_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Root-level public assets (e.g. /file.svg) — single path segment. */
export function isRootStaticAssetPath(pathname: string): boolean {
    if (pathname.lastIndexOf("/") !== 0) return false;
    if (pathname.includes("..")) return false;
    const lower = pathname.toLowerCase();
    return STATIC_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isPublicStaticAssetPath(pathname: string): boolean {
    return (
        pathname.startsWith("/_next") ||
        pathname === "/favicon.ico" ||
        pathname.startsWith("/branding/") ||
        isRootStaticAssetPath(pathname) ||
        isPublicMediaAssetPath(pathname)
    );
}
