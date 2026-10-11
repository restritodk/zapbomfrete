import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    getConfiguredPublicOrigin,
    getPublicOrigin,
    publicUrl,
    resolveNextHostname,
    safeCallbackPath,
} from "./public-origin";

describe("public-origin — configured production URL", () => {
    const prodEnv = {
        BASE_URL: "https://zapbomfrete.microhardcenter.com.br",
        NEXTAUTH_URL: "https://zapbomfrete.microhardcenter.com.br",
        NEXT_PUBLIC_APP_URL: "https://zapbomfrete.microhardcenter.com.br",
        HOSTNAME: "localhost",
        PORT: "3000",
    } as unknown as NodeJS.ProcessEnv;

    it("reads configured origin ignoring HOSTNAME=localhost", () => {
        assert.equal(
            getConfiguredPublicOrigin(prodEnv),
            "https://zapbomfrete.microhardcenter.com.br"
        );
    });

    it("redirects /login → public /auth/login with callback", () => {
        const poisoned = {
            url: "https://localhost:3000/login",
            nextUrl: new URL("https://localhost:3000/login"),
            headers: new Headers({
                host: "evil.example",
                "x-forwarded-host": "evil.example",
                "x-forwarded-proto": "https",
            }),
        };
        const login = publicUrl("/auth/login", poisoned, undefined, prodEnv);
        login.searchParams.set("callbackUrl", safeCallbackPath("/login"));
        assert.equal(
            login.href,
            "https://zapbomfrete.microhardcenter.com.br/auth/login?callbackUrl=%2Flogin"
        );
    });

    it("preserves dashboard callback on public origin", () => {
        const req = {
            url: "https://localhost:3000/dashboard/contatos",
            nextUrl: new URL("https://localhost:3000/dashboard/contatos"),
        };
        const login = publicUrl("/auth/login", req, undefined, prodEnv);
        login.searchParams.set(
            "callbackUrl",
            safeCallbackPath("/dashboard/contatos")
        );
        assert.equal(
            login.href,
            "https://zapbomfrete.microhardcenter.com.br/auth/login?callbackUrl=%2Fdashboard%2Fcontatos"
        );
    });

    it("root and auth/login authenticated redirects stay on public host", () => {
        const req = {
            url: "https://localhost:3000/",
            nextUrl: new URL("https://localhost:3000/"),
        };
        assert.equal(
            publicUrl("/dashboard", req, undefined, prodEnv).href,
            "https://zapbomfrete.microhardcenter.com.br/dashboard"
        );
        assert.equal(
            publicUrl("/auth/login", req, undefined, prodEnv).href,
            "https://zapbomfrete.microhardcenter.com.br/auth/login"
        );
    });

    it("malicious forwarded host cannot override redirect origin", () => {
        const origin = getPublicOrigin(
            {
                url: "https://localhost:3000/dashboard",
                nextUrl: new URL("https://localhost:3000/dashboard"),
                headers: new Headers({
                    host: "attacker.test",
                    "x-forwarded-host": "attacker.test",
                }),
            },
            prodEnv
        );
        assert.equal(origin, "https://zapbomfrete.microhardcenter.com.br");
        assert.ok(!origin.includes("attacker"));
    });

    it("resolveNextHostname uses public host not HOSTNAME env", () => {
        assert.equal(
            resolveNextHostname(prodEnv),
            "zapbomfrete.microhardcenter.com.br"
        );
    });
});

describe("public-origin — local development", () => {
    const emptyEnv = { PORT: "3030" } as unknown as NodeJS.ProcessEnv;

    it("uses loopback request origin when no public URL configured", () => {
        const req = {
            url: "http://localhost:3030/dashboard",
            nextUrl: new URL("http://localhost:3030/dashboard"),
        };
        assert.equal(getPublicOrigin(req, emptyEnv), "http://localhost:3030");
        assert.equal(
            publicUrl("/auth/login", req, undefined, emptyEnv).href,
            "http://localhost:3030/auth/login"
        );
    });

    it("does not trust non-loopback request origin without config", () => {
        const req = {
            url: "https://evil.example/dashboard",
            nextUrl: new URL("https://evil.example/dashboard"),
            headers: new Headers({ host: "evil.example" }),
        };
        assert.equal(getPublicOrigin(req, emptyEnv), "http://localhost:3030");
    });
});

describe("safeCallbackPath", () => {
    it("allows relative paths", () => {
        assert.equal(safeCallbackPath("/dashboard"), "/dashboard");
        assert.equal(safeCallbackPath("/login"), "/login");
    });

    it("rejects absolute and protocol-relative URLs", () => {
        assert.equal(safeCallbackPath("https://evil.test/x"), "/dashboard");
        assert.equal(safeCallbackPath("//evil.test/x"), "/dashboard");
        assert.equal(safeCallbackPath("dashboard"), "/dashboard");
    });
});
