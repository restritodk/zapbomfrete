import crypto from "node:crypto";

/** Official Datafy delivery headers — https://developers.datafyapi.com.br/api-reference/whatsapp/webhooks/receber-eventos */
export const DATAFY_SIGNATURE_HEADER = "x-datafy-signature-256";
export const DATAFY_TIMESTAMP_HEADER = "x-datafy-timestamp";
export const DATAFY_DELIVERY_ID_HEADER = "x-datafy-delivery-id";

/** Max age of webhook timestamp (seconds) — Datafy docs recommend 5 minutes. */
export const DATAFY_TIMESTAMP_TOLERANCE_SEC = 300;

/**
 * Read a header by official name, with case-insensitive scan fallback.
 * Does not invent alternate auth schemes — only resolves the documented names
 * (and underscore variants some proxies expose).
 */
export function readDatafyHeader(
    headers: Headers | { get(name: string): string | null },
    officialName: string
): string | null {
    const direct = headers.get(officialName);
    if (direct != null && String(direct).trim() !== "") {
        return String(direct).trim();
    }

    const wanted = officialName.toLowerCase();
    const wantedUnderscore = wanted.replace(/-/g, "_");

    if (typeof (headers as Headers).forEach === "function") {
        let found: string | null = null;
        (headers as Headers).forEach((value, key) => {
            if (found != null) return;
            const k = key.toLowerCase();
            if (k === wanted || k === wantedUnderscore) {
                const v = String(value || "").trim();
                if (v) found = v;
            }
        });
        if (found) return found;
    }

    return null;
}

export function extractDatafyWebhookHeaders(headers: Headers): {
    signature: string | null;
    timestamp: string | null;
    deliveryId: string | null;
} {
    return {
        signature: readDatafyHeader(headers, DATAFY_SIGNATURE_HEADER),
        timestamp: readDatafyHeader(headers, DATAFY_TIMESTAMP_HEADER),
        deliveryId: readDatafyHeader(headers, DATAFY_DELIVERY_ID_HEADER),
    };
}

/** Safe diagnostic flags (no secret values). */
export function describeDatafyAuthPresence(opts: {
    signature: string | null | undefined;
    timestamp: string | null | undefined;
    secretConfigured: boolean;
    deliveryId?: string | null | undefined;
}): string {
    return [
        `sig=${opts.signature ? "present" : "missing"}`,
        `ts=${opts.timestamp ? "present" : "missing"}`,
        `secret=${opts.secretConfigured ? "present" : "missing"}`,
        `delivery=${opts.deliveryId ? "present" : "missing"}`,
    ].join(" ");
}

function parseSha256Header(header: string): Buffer | null {
    const trimmed = header.trim();
    const withPrefix = /^sha256=([a-fA-F0-9]{64})$/i.exec(trimmed);
    if (withPrefix) return Buffer.from(withPrefix[1], "hex");
    // Bare 64-char hex (some gateways strip the sha256= prefix)
    if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
        return Buffer.from(trimmed, "hex");
    }
    return null;
}

/**
 * Verify Datafy webhook HMAC-SHA256 (official contract).
 * Signature = HMAC-SHA256(secret, `${timestamp}.${rawBody}`) as `sha256=<hex>`
 * Must use the raw request body exactly as received (before JSON.parse).
 * Digest comparison is constant-time via crypto.timingSafeEqual.
 */
export function verifyDatafySignature(opts: {
    rawBody: string;
    signatureHeader: string | null | undefined;
    timestampHeader: string | null | undefined;
    secret: string;
    nowSec?: number;
    toleranceSec?: number;
}): { ok: true } | { ok: false; reason: string } {
    const signature = (opts.signatureHeader || "").trim();
    const timestamp = (opts.timestampHeader || "").trim();
    const secret = opts.secret;

    if (!secret) {
        return { ok: false, reason: "missing_secret" };
    }
    if (!signature) {
        return { ok: false, reason: "missing_signature" };
    }
    if (!timestamp) {
        return { ok: false, reason: "missing_timestamp" };
    }

    if (!/^\d+$/.test(timestamp)) {
        return { ok: false, reason: "invalid_timestamp" };
    }

    const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
    const tolerance = opts.toleranceSec ?? DATAFY_TIMESTAMP_TOLERANCE_SEC;
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > tolerance) {
        return { ok: false, reason: "timestamp_out_of_tolerance" };
    }

    const provided = parseSha256Header(signature);
    if (!provided) {
        return { ok: false, reason: "invalid_signature_format" };
    }

    const expected = crypto
        .createHmac("sha256", secret)
        .update(`${timestamp}.${opts.rawBody}`, "utf8")
        .digest();

    if (
        provided.length !== expected.length ||
        !crypto.timingSafeEqual(provided, expected)
    ) {
        return { ok: false, reason: "signature_mismatch" };
    }

    return { ok: true };
}

/** Build a valid signature for tests / fixtures. */
export function signDatafyPayload(
    secret: string,
    timestamp: string | number,
    rawBody: string
): string {
    return (
        "sha256=" +
        crypto
            .createHmac("sha256", secret)
            .update(`${timestamp}.${rawBody}`, "utf8")
            .digest("hex")
    );
}

/** Stable synthetic delivery id when header is absent (replay-safe for same payload). */
export function syntheticDeliveryId(timestamp: string, rawBody: string): string {
    return crypto
        .createHash("sha256")
        .update(`${timestamp}.${rawBody}`, "utf8")
        .digest("hex");
}
