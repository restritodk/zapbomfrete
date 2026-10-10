import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
    verifyDatafySignature,
    signDatafyPayload,
    syntheticDeliveryId,
    extractDatafyWebhookHeaders,
    describeDatafyAuthPresence,
    DATAFY_SIGNATURE_HEADER,
    DATAFY_TIMESTAMP_HEADER,
    DATAFY_DELIVERY_ID_HEADER,
    DATAFY_TIMESTAMP_TOLERANCE_SEC,
} from "./hmac";
import { isPublicApiPath } from "@/lib/public-api-routes";
import { DatafyApiError, DatafyClient } from "./client";
import {
    maskSecret,
    encryptSecret,
    decryptSecret,
    redactSecrets,
    resolveEncryptionKeys,
} from "./crypto-secrets";
import {
    assertWebhookUrlSafeForEnvironment,
    isWebhookUrlHttps,
    toPublicStatus,
    type DatafyResolvedConfig,
} from "./config";
import { isDatafyProvider, DatafyProvider } from "./provider";

const SAMPLE_BODY = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
        {
            id: "1",
            changes: [{ field: "messages", value: { statuses: [] } }],
        },
    ],
});

describe("Datafy HMAC signature (official contract)", () => {
    const secret = "whsec_test_secret_value";

    it("accepts a valid signature within tolerance", () => {
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = signDatafyPayload(secret, ts, SAMPLE_BODY);
        const result = verifyDatafySignature({
            rawBody: SAMPLE_BODY,
            signatureHeader: sig,
            timestampHeader: ts,
            secret,
        });
        assert.equal(result.ok, true);
    });

    it("accepts uppercase hex in sha256= header (constant-time digest compare)", () => {
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = signDatafyPayload(secret, ts, SAMPLE_BODY).replace(
            "sha256=",
            "sha256="
        );
        const upper =
            "sha256=" + sig.slice("sha256=".length).toUpperCase();
        const result = verifyDatafySignature({
            rawBody: SAMPLE_BODY,
            signatureHeader: upper,
            timestampHeader: ts,
            secret,
        });
        assert.equal(result.ok, true);
    });

    it("rejects tampered body (raw body required)", () => {
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = signDatafyPayload(secret, ts, SAMPLE_BODY);
        const result = verifyDatafySignature({
            rawBody: SAMPLE_BODY + " ",
            signatureHeader: sig,
            timestampHeader: ts,
            secret,
        });
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.reason, "signature_mismatch");
    });

    it("rejects expired timestamp (replay window)", () => {
        const ts = String(
            Math.floor(Date.now() / 1000) - DATAFY_TIMESTAMP_TOLERANCE_SEC - 10
        );
        const sig = signDatafyPayload(secret, ts, SAMPLE_BODY);
        const result = verifyDatafySignature({
            rawBody: SAMPLE_BODY,
            signatureHeader: sig,
            timestampHeader: ts,
            secret,
        });
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.reason, "timestamp_out_of_tolerance");
    });

    it("rejects far-future timestamp", () => {
        const ts = String(Math.floor(Date.now() / 1000) + 600);
        const sig = signDatafyPayload(secret, ts, SAMPLE_BODY);
        const result = verifyDatafySignature({
            rawBody: SAMPLE_BODY,
            signatureHeader: sig,
            timestampHeader: ts,
            secret,
        });
        assert.equal(result.ok, false);
    });

    it("rejects missing signature with granular reason", () => {
        const result = verifyDatafySignature({
            rawBody: SAMPLE_BODY,
            signatureHeader: null,
            timestampHeader: String(Math.floor(Date.now() / 1000)),
            secret,
        });
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.reason, "missing_signature");
    });

    it("rejects missing timestamp with granular reason", () => {
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = signDatafyPayload(secret, ts, SAMPLE_BODY);
        const result = verifyDatafySignature({
            rawBody: SAMPLE_BODY,
            signatureHeader: sig,
            timestampHeader: null,
            secret,
        });
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.reason, "missing_timestamp");
    });

    it("rejects missing secret with granular reason", () => {
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = signDatafyPayload(secret, ts, SAMPLE_BODY);
        const result = verifyDatafySignature({
            rawBody: SAMPLE_BODY,
            signatureHeader: sig,
            timestampHeader: ts,
            secret: "",
        });
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.reason, "missing_secret");
    });

    it("accepts bare hex signature (sha256= prefix optional)", () => {
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = signDatafyPayload(secret, ts, SAMPLE_BODY);
        const bare = sig.slice("sha256=".length);
        const result = verifyDatafySignature({
            rawBody: SAMPLE_BODY,
            signatureHeader: bare,
            timestampHeader: ts,
            secret,
        });
        assert.equal(result.ok, true);
    });

    it("rejects invalid signature format", () => {
        const result = verifyDatafySignature({
            rawBody: SAMPLE_BODY,
            signatureHeader: "not-a-signature",
            timestampHeader: String(Math.floor(Date.now() / 1000)),
            secret,
        });
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.reason, "invalid_signature_format");
    });

    it("extracts official Datafy headers case-insensitively", () => {
        const headers = new Headers({
            "X-Datafy-Signature-256": "sha256=abcd",
            "X-Datafy-Timestamp": "1700000000",
            "X-Datafy-Delivery-Id": "deliv-1",
        });
        const extracted = extractDatafyWebhookHeaders(headers);
        assert.equal(extracted.signature, "sha256=abcd");
        assert.equal(extracted.timestamp, "1700000000");
        assert.equal(extracted.deliveryId, "deliv-1");
        assert.equal(DATAFY_SIGNATURE_HEADER, "x-datafy-signature-256");
        assert.equal(DATAFY_TIMESTAMP_HEADER, "x-datafy-timestamp");
        assert.equal(DATAFY_DELIVERY_ID_HEADER, "x-datafy-delivery-id");
    });

    it("describeDatafyAuthPresence never leaks values", () => {
        const desc = describeDatafyAuthPresence({
            signature: "sha256=supersecret",
            timestamp: "1700000000",
            secretConfigured: true,
            deliveryId: "uuid-secret",
        });
        assert.ok(desc.includes("sig=present"));
        assert.ok(desc.includes("ts=present"));
        assert.ok(!desc.includes("supersecret"));
        assert.ok(!desc.includes("uuid-secret"));
    });

    it("verifies a realistic Meta-shaped messages payload", () => {
        const body = JSON.stringify({
            object: "whatsapp_business_account",
            entry: [
                {
                    id: "WABA_ID",
                    changes: [
                        {
                            field: "messages",
                            value: {
                                messaging_product: "whatsapp",
                                metadata: {
                                    display_phone_number: "5511988887777",
                                    phone_number_id: "1234567890123456",
                                },
                                contacts: [
                                    {
                                        profile: { name: "Maria Souza" },
                                        wa_id: "5511999999999",
                                    },
                                ],
                                messages: [
                                    {
                                        from: "5511999999999",
                                        id: "wamid.HBgNNTUxMTk5OTk5OTk5ORUCABIYFjNFQjA=",
                                        timestamp: "1789529684",
                                        type: "text",
                                        text: { body: "Bom dia" },
                                    },
                                ],
                            },
                        },
                    ],
                },
            ],
        });
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = signDatafyPayload(secret, ts, body);
        const result = verifyDatafySignature({
            rawBody: body,
            signatureHeader: sig,
            timestampHeader: ts,
            secret,
        });
        assert.equal(result.ok, true);
        const delivery = syntheticDeliveryId(ts, body);
        assert.equal(delivery.length, 64);
        // Same payload + timestamp → same synthetic id (idempotency fallback)
        assert.equal(syntheticDeliveryId(ts, body), delivery);
    });

    it("synthetic delivery id is stable for same timestamp+body", () => {
        const a = syntheticDeliveryId("1700000000", SAMPLE_BODY);
        const b = syntheticDeliveryId("1700000000", SAMPLE_BODY);
        const c = syntheticDeliveryId("1700000001", SAMPLE_BODY);
        assert.equal(a, b);
        assert.notEqual(a, c);
        assert.equal(a.length, 64);
    });
});

describe("Public API paths (edge proxy)", () => {
    it("allows Datafy webhook without session", () => {
        assert.equal(isPublicApiPath("/api/webhooks/datafy"), true);
        assert.equal(isPublicApiPath("/api/webhooks/datafy/"), true);
    });

    it("still protects other API routes", () => {
        assert.equal(isPublicApiPath("/api/integrations/datafy"), false);
        assert.equal(isPublicApiPath("/api/channels/datafy/campaigns"), false);
        assert.equal(isPublicApiPath("/api/webhooks/session-1"), false);
    });
});

describe("Datafy HTTP client auth & errors", () => {
    it("sends Bearer token and parses /me (real probe path)", async () => {
        const calls: Array<{ url: string; auth?: string | null }> = [];
        const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            calls.push({
                url,
                auth: (init?.headers as Record<string, string>)?.Authorization,
            });
            return new Response(
                JSON.stringify({
                    phone_number_id: "111",
                    waba_id: "222",
                    business_id: "333",
                    cliente_id: "cli_1",
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        }) as typeof fetch;

        const client = new DatafyClient({
            channelToken: "sk_live_test_token",
            fetchImpl,
        });
        const me = await client.getMe();
        assert.equal(me.waba_id, "222");
        assert.equal(calls[0].auth, "Bearer sk_live_test_token");
        assert.ok(calls[0].url.endsWith("/me"));
    });

    it("maps 401 / 402 / 429 errors without exposing token", async () => {
        const make = (status: number, message: string) =>
            new DatafyClient({
                channelToken: "sk_live_secret_should_not_appear",
                fetchImpl: (async () =>
                    new Response(JSON.stringify({ statusCode: status, message }), {
                        status,
                    })) as typeof fetch,
            });

        await assert.rejects(
            () => make(401, "Token inválido").getMe(),
            (e: unknown) =>
                e instanceof DatafyApiError &&
                e.statusCode === 401 &&
                !String(e.message).includes("sk_live_secret")
        );
        await assert.rejects(
            () => make(402, "Assinatura inativa").getMe(),
            (e: unknown) => e instanceof DatafyApiError && e.statusCode === 402
        );
        await assert.rejects(
            () =>
                make(
                    429,
                    "Rate limit excedido (60 req/min). Tente novamente em 12s."
                ).getMe(),
            (e: unknown) =>
                e instanceof DatafyApiError &&
                e.statusCode === 429 &&
                e.retryAfterSec === 12
        );
    });

    it("times out safely", async () => {
        const client = new DatafyClient({
            channelToken: "sk_live_x",
            timeoutMs: 20,
            fetchImpl: (async (_u, init) => {
                await new Promise((resolve, reject) => {
                    const t = setTimeout(resolve, 500);
                    init?.signal?.addEventListener("abort", () => {
                        clearTimeout(t);
                        reject(
                            Object.assign(new Error("Aborted"), {
                                name: "AbortError",
                            })
                        );
                    });
                });
                return new Response("{}", { status: 200 });
            }) as typeof fetch,
        });
        await assert.rejects(
            () => client.getMe(),
            (e: unknown) => e instanceof DatafyApiError && e.statusCode === 408
        );
    });
});

describe("Datafy secrets masking / crypto / rotation", () => {
    const prev = {
        AUTH_SECRET: process.env.AUTH_SECRET,
        DATAFY_ENCRYPTION_KEY: process.env.DATAFY_ENCRYPTION_KEY,
        NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    };

    beforeEach(() => {
        process.env.AUTH_SECRET = "test-auth-secret-32chars-minimum!!";
        delete process.env.DATAFY_ENCRYPTION_KEY;
    });

    afterEach(() => {
        process.env.AUTH_SECRET = prev.AUTH_SECRET;
        process.env.DATAFY_ENCRYPTION_KEY = prev.DATAFY_ENCRYPTION_KEY;
        process.env.NEXTAUTH_SECRET = prev.NEXTAUTH_SECRET;
    });

    it("masks tokens for UI", () => {
        assert.equal(maskSecret("sk_live_abcdefghij"), "sk_live_••••ghij");
        assert.equal(maskSecret("whsec_abcdefghij"), "whsec_••••ghij");
        assert.equal(maskSecret(null), null);
    });

    it("redacts secrets from error strings", () => {
        const raw =
            "fail Bearer sk_live_ABCDEFG123 and whsec_ZZZZYYYYXXXX Authorization: sk_live_ABCDEFG123";
        const clean = redactSecrets(raw);
        assert.ok(!clean.includes("ABCDEFG123"));
        assert.ok(!clean.includes("ZZZZYYYYXXXX"));
        assert.ok(clean.includes("whsec_••••"));
        assert.ok(clean.includes("Bearer ••••"));
        assert.ok(clean.includes("Authorization: ••••"));
    });

    it("encrypts with AUTH_SECRET when DEK absent (legacy compatible)", () => {
        const plain = "sk_live_roundtrip_value";
        const enc = encryptSecret(plain);
        assert.ok(enc.startsWith("auth."));
        assert.equal(decryptSecret(enc), plain);
    });

    it("prefers DATAFY_ENCRYPTION_KEY for new ciphertext", () => {
        process.env.DATAFY_ENCRYPTION_KEY = "datafy-dedicated-key-32chars-min!";
        const slots = resolveEncryptionKeys();
        assert.equal(slots[0].label, "dek");
        const enc = encryptSecret("sk_live_with_dek");
        assert.ok(enc.startsWith("dek."));
        assert.equal(decryptSecret(enc), "sk_live_with_dek");
    });

    it("still decrypts AUTH_SECRET ciphertext after introducing DATAFY_ENCRYPTION_KEY", () => {
        delete process.env.DATAFY_ENCRYPTION_KEY;
        const legacy = encryptSecret("sk_live_legacy_token");
        assert.ok(legacy.startsWith("auth."));

        process.env.DATAFY_ENCRYPTION_KEY = "datafy-dedicated-key-32chars-min!";
        // New writes use DEK
        const newer = encryptSecret("sk_live_new_token");
        assert.ok(newer.startsWith("dek."));
        // Legacy still readable
        assert.equal(decryptSecret(legacy), "sk_live_legacy_token");
        assert.equal(decryptSecret(newer), "sk_live_new_token");
    });

    it("decrypts unprefixed legacy iv.tag.data format with AUTH_SECRET", () => {
        // Build legacy 3-part payload manually using auth key path:
        // encrypt then strip the label prefix
        const labeled = encryptSecret("sk_live_unprefixed");
        const legacy = labeled.replace(/^auth\./, "");
        assert.equal(legacy.split(".").length, 3);
        assert.equal(decryptSecret(legacy), "sk_live_unprefixed");
    });
});

describe("Public status never exposes full secrets", () => {
    it("toPublicStatus only returns masked credentials", () => {
        const cfg: DatafyResolvedConfig = {
            enabled: true,
            baseUrl: "https://cloud.datafyapi.com.br",
            channelToken: "sk_live_SUPERSECRETTOKENVALUE",
            webhookSecret: "whsec_SUPERSECRETWEBHOOKVAL",
            phoneNumberId: "123",
            wabaId: "456",
            businessId: "789",
            displayPhoneNumber: "5511999999999",
            clienteId: "cli",
            webhookConfigured: true,
            lastVerifiedAt: null,
            lastError: "Token sk_live_SUPERSECRETTOKENVALUE invalid",
            tokenSource: "env",
            secretSource: "env",
        };
        const prevBase = process.env.BASE_URL;
        process.env.BASE_URL = "https://app.example.com";
        const pub = toPublicStatus(cfg);
        process.env.BASE_URL = prevBase;

        const json = JSON.stringify(pub);
        assert.ok(!json.includes("SUPERSECRETTOKENVALUE"));
        assert.ok(!json.includes("SUPERSECRETWEBHOOKVAL"));
        assert.ok(pub.channelTokenMasked?.includes("••••"));
        assert.ok(pub.webhookSecretMasked?.includes("••••"));
        assert.ok(pub.lastError?.includes("sk_live_••••"));
        assert.equal(pub.webhookUrlIsHttps, true);
        assert.equal(pub.outboundCampaignsEnabled, true);
        assert.equal(pub.webhookUrl, "https://app.example.com/api/webhooks/datafy");
    });
});

describe("Webhook URL HTTPS policy", () => {
    it("detects https", () => {
        assert.equal(isWebhookUrlHttps("https://x.com/api/webhooks/datafy"), true);
        assert.equal(isWebhookUrlHttps("http://localhost:3000/api/webhooks/datafy"), false);
    });

    it("requires https in production", () => {
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        assert.equal(
            assertWebhookUrlSafeForEnvironment(
                "http://example.com/api/webhooks/datafy"
            ).ok,
            false
        );
        assert.equal(
            assertWebhookUrlSafeForEnvironment(
                "https://example.com/api/webhooks/datafy"
            ).ok,
            true
        );
        process.env.NODE_ENV = prev;
    });
});

describe("Provider isolation", () => {
    it("identifies datafy provider without touching baileys", () => {
        assert.equal(isDatafyProvider("datafy"), true);
        assert.equal(isDatafyProvider("baileys"), false);
        const p = new DatafyProvider();
        assert.equal(p.name, "datafy");
        assert.throws(() => p.assertOutboundDisabled(), (e: unknown) => {
            return e instanceof DatafyApiError && e.statusCode === 403;
        });
    });
});

describe("Duplicate delivery claim (unit semantics)", () => {
    it("models first-vs-duplicate with a Set (same contract as DB unique)", () => {
        const seen = new Set<string>();
        const claim = (id: string) => {
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        };
        assert.equal(claim("del-1"), true);
        assert.equal(claim("del-1"), false);
        assert.equal(claim("del-2"), true);
    });
});
