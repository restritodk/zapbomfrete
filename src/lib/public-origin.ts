/**
 * Canonical public origin for absolute redirects behind reverse proxies.
 *
 * Custom Next servers bind to localhost:PORT; request.url / nextUrl often
 * inherit that internal host (and may pick https from X-Forwarded-Proto),
 * producing Location: https://localhost:3000/... in production.
 *
 * Prefer configured public URLs; never trust arbitrary client Host /
 * X-Forwarded-Host for redirect targets.
 */

const PUBLIC_ORIGIN_ENV_KEYS = [
    "AUTH_URL",
    "NEXTAUTH_URL",
    "BASE_URL",
    "NEXT_PUBLIC_APP_URL",
] as const;

function parseOrigin(raw: string | undefined | null): string | null {
    if (!raw?.trim()) return null;
    try {
        const url = new URL(raw.trim());
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        return url.origin;
    } catch {
        return null;
    }
}

function isLoopbackHostname(hostname: string): boolean {
    const h = hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
}

export type OriginRequestLike = {
    nextUrl?: URL;
    url?: string;
    headers?: Headers;
};

/** Configured public origin (no trailing slash), or null if unset/invalid. */
export function getConfiguredPublicOrigin(
    env: NodeJS.ProcessEnv = process.env
): string | null {
    for (const key of PUBLIC_ORIGIN_ENV_KEYS) {
        const origin = parseOrigin(env[key]);
        if (origin) return origin;
    }
    return null;
}

/**
 * Origin used for absolute redirects.
 * - Production / configured: AUTH_URL → NEXTAUTH_URL → BASE_URL → NEXT_PUBLIC_APP_URL
 * - Local dev without config: loopback request origin only
 * - Never returns an origin from untrusted forwarded Host headers
 */
export function getPublicOrigin(
    request?: OriginRequestLike,
    env: NodeJS.ProcessEnv = process.env
): string {
    const configured = getConfiguredPublicOrigin(env);
    if (configured) return configured;

    const candidates: string[] = [];
    if (request?.nextUrl?.origin) candidates.push(request.nextUrl.origin);
    if (request?.url) {
        try {
            candidates.push(new URL(request.url).origin);
        } catch {
            /* ignore */
        }
    }

    for (const origin of candidates) {
        try {
            if (isLoopbackHostname(new URL(origin).hostname)) return origin;
        } catch {
            /* ignore */
        }
    }

    const port = env.PORT || "3000";
    return `http://localhost:${port}`;
}

/**
 * Build an absolute URL on the public origin.
 * `path` may include a query string; extra search params are merged.
 */
export function publicUrl(
    path: string,
    request?: OriginRequestLike,
    searchParams?: Record<string, string> | URLSearchParams,
    env: NodeJS.ProcessEnv = process.env
): URL {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(normalized, getPublicOrigin(request, env));
    if (searchParams) {
        const sp =
            searchParams instanceof URLSearchParams
                ? searchParams
                : new URLSearchParams(searchParams);
        sp.forEach((value, key) => {
            url.searchParams.set(key, value);
        });
    }
    return url;
}

/** Relative in-app callback only — blocks protocol-relative / absolute open redirects. */
export function safeCallbackPath(
    raw: string | null | undefined,
    fallback = "/dashboard"
): string {
    if (!raw) return fallback;
    if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
    if (raw.includes("://")) return fallback;
    return raw;
}

/**
 * Hostname for `next({ hostname })` — prefer public URL host so Next does not
 * stamp absolute URLs as localhost. Binding remains via server.listen(port).
 */
export function resolveNextHostname(env: NodeJS.ProcessEnv = process.env): string {
    const configured = getConfiguredPublicOrigin(env);
    if (configured) {
        try {
            return new URL(configured).hostname;
        } catch {
            /* fall through */
        }
    }
    // Avoid process.env.HOSTNAME (OS machine name / mistaken localhost default).
    return env.LISTEN_HOST || env.HOST || "localhost";
}
