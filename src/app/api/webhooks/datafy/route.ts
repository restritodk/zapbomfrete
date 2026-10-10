import { NextRequest, NextResponse } from "next/server";
import {
    DATAFY_DELIVERY_ID_HEADER,
    DATAFY_SIGNATURE_HEADER,
    DATAFY_TIMESTAMP_HEADER,
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
 * - No user/session auth (signature is the auth)
 * - HMAC-SHA256 over `${timestamp}.${rawBody}`
 * - Idempotent via x-datafy-delivery-id
 * - Isolated from Baileys
 */
export async function POST(request: NextRequest) {
    const rawBody = await request.text();

    const signature = request.headers.get(DATAFY_SIGNATURE_HEADER);
    const timestamp = request.headers.get(DATAFY_TIMESTAMP_HEADER) || "";
    const headerDeliveryId = request.headers.get(DATAFY_DELIVERY_ID_HEADER);
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

    const verified = verifyDatafySignature({
        rawBody,
        signatureHeader: signature,
        timestampHeader: timestamp,
        secret: cfg.webhookSecret,
    });

    if (!verified.ok) {
        logger.warn(
            "Datafy",
            `Webhook signature rejected (${verified.reason})`
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
