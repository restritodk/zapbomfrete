import crypto from "node:crypto";

export const DATAFY_SIGNATURE_HEADER = "x-datafy-signature-256";
export const DATAFY_TIMESTAMP_HEADER = "x-datafy-timestamp";
export const DATAFY_DELIVERY_ID_HEADER = "x-datafy-delivery-id";

/** Max age of webhook timestamp (seconds) — Datafy docs recommend 5 minutes. */
export const DATAFY_TIMESTAMP_TOLERANCE_SEC = 300;

function parseSha256Header(header: string): Buffer | null {
    const m = /^sha256=([a-fA-F0-9]{64})$/.exec(header.trim());
    if (!m) return null;
    return Buffer.from(m[1], "hex");
}

/**
 * Verify Datafy webhook HMAC-SHA256.
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

    if (!signature || !timestamp || !secret) {
        return { ok: false, reason: "missing_signature_or_timestamp_or_secret" };
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
