import { auth } from "@/lib/auth";
import { isPublicApiPath } from "@/lib/public-api-routes";
import { publicUrl, safeCallbackPath } from "@/lib/public-origin";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function redirectTo(path: string, request: NextRequest, callbackPath?: string) {
    const url = publicUrl(path, request);
    if (callbackPath !== undefined) {
        url.searchParams.set("callbackUrl", safeCallbackPath(callbackPath));
    }
    return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Public routes that don't require authentication
    const publicRoutes = ["/auth/login", "/auth/register", "/api/auth", "/api/test", "/terms", "/privacy"];

    // Check if it's a public route
    const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));

    // Allow Next.js internals, favicon and uploaded branding assets
    if (
        pathname.startsWith("/_next") ||
        pathname === "/favicon.ico" ||
        pathname.startsWith("/branding/")
    ) {
        return NextResponse.next();
    }

    // Allow known static asset extensions in root path only (e.g. /vercel.svg)
    const staticExtensions = [".svg", ".ico", ".png", ".jpg", ".jpeg", ".webp", ".woff", ".woff2", ".ttf"];
    if (pathname.lastIndexOf("/") === 0 && staticExtensions.some(ext => pathname.endsWith(ext))) {
        return NextResponse.next();
    }

    // API routes: Check for API key or session
    if (pathname.startsWith("/api/")) {
        // Public webhooks / auth — handler-level auth (e.g. Datafy HMAC)
        if (isPublicApiPath(pathname)) {
            return NextResponse.next();
        }

        // Check for API key in header
        const apiKey = request.headers.get("x-api-key");
        if (apiKey) {
            // API key auth will be validated in the route handler
            return NextResponse.next();
        }

        // Check for session auth
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        return NextResponse.next();
    }

    // Dashboard routes: Require login
    if (pathname.startsWith("/dashboard")) {
        const session = await auth();

        if (!session?.user) {
            return redirectTo("/auth/login", request, pathname);
        }

        return NextResponse.next();
    }

    // Root path — never render landing; login or dashboard
    if (pathname === "/") {
        const session = await auth();
        if (session?.user) {
            return redirectTo("/dashboard", request);
        }
        return redirectTo("/auth/login", request);
    }

    // Public routes
    if (isPublicRoute) {
        const session = await auth();
        if (session?.user && (pathname.startsWith("/auth/login") || pathname.startsWith("/auth/register"))) {
            return redirectTo("/dashboard", request);
        }
        return NextResponse.next();
    }

    // Default: require auth for everything else (e.g. /login → public /auth/login)
    const session = await auth();
    if (!session?.user) {
        return redirectTo("/auth/login", request, pathname);
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        "/((?!_next/static|_next/image|favicon.ico).*)",
    ],
};
