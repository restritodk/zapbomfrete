import { NextRequest, NextResponse } from "next/server";
import {
    extractDatafyWebhookHeaders,
    describeDatafyAuthPresence,
    loadDatafyConfig,
    processDatafyWebhook,
    syntheticDeliveryId,
    verifyDatafySignature,
    type DatafyWebhookEnvelope,
} from "@/modules/datafy";
import { logger } from "@/lib/logger";
import { redactSecrets } from "@/modules/datafy/crypto-secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Datafy -> ZapBomFrete webhook receiver.
 * HTTPS path: {BASE_URL}/api/webhooks/datafy
 *
 * Official contract (developers.datafyapi.com.br):
 * - Headers: x-datafy-signature-256, x-datafy-timestamp, x-datafy-delivery-id
 * - HMAC-SHA256 over `${timestamp}.${rawBody}` → `sha256=<hex>`
 * - No session / API-key auth (signature is the auth)
 * - Isolated from Baileys
 */
export async function POST(request: NextRequest) {
    const rawBody = await request.text();

    const { signature, timestamp, deliveryId: headerDeliveryId } =
        extractDatafyWebhookHeaders(request.headers);
    const deliveryId =
        headerDeliveryId?.trim() ||
        (timestamp ? syntheticDeliveryId(timestamp, rawBody) : "");

    const cfg = await loadDatafyConfig();

    if (!cfg.enabled) {
        return NextResponse.json(
            { status: false, message: "Datafy integration disabled" },
            { status: 503 }
        );
    }

    if (!cfg.webhookSecret) {
        logger.warn("Datafy", "Webhook received but secret is not configured");
        return NextResponse.json(
            { status: false, message: "Webhook secret not configured" },
            { status: 503 }
        );
    }

    const authPresence = describeDatafyAuthPresence({
        signature,
        timestamp,
        secretConfigured: Boolean(cfg.webhookSecret),
        deliveryId: headerDeliveryId,
    });

    const verified = verifyDatafySignature({
        rawBody,
        signatureHeader: signature,
        timestampHeader: timestamp,
        secret: cfg.webhookSecret,
    });

    if (!verified.ok) {
        logger.warn(
            "Datafy",
            `Webhook signature rejected (${verified.reason}) [${authPresence}]`
        );
        return new NextResponse(null, { status: 401 });
    }

    if (!deliveryId) {
        return NextResponse.json(
            { status: false, message: "Missing delivery id" },
            { status: 400 }
        );
    }

    let envelope: DatafyWebhookEnvelope;
    try {
        envelope = JSON.parse(rawBody) as DatafyWebhookEnvelope;
    } catch {
        return NextResponse.json(
            { status: false, message: "Invalid JSON" },
            { status: 400 }
        );
    }

    setImmediate(() => {
        processDatafyWebhook({ deliveryId, envelope }).catch((err) => {
            const msg = err instanceof Error ? err.message : "unknown";
            logger.error(
                "Datafy",
                "Background webhook processing failed:",
                redactSecrets(msg)
            );
        });
    });

    return new NextResponse(null, { status: 200 });
}

/** Health ping for operators (no secrets). */
export async function GET() {
    const cfg = await loadDatafyConfig();
    return NextResponse.json({
        status: true,
        provider: "datafy",
        enabled: cfg.enabled,
        webhookReady: Boolean(cfg.enabled && cfg.webhookSecret),
    });
}
