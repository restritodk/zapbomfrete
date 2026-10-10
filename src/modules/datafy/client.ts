import type {
    DatafyHttpErrorBody,
    DatafyMeResponse,
    DatafyTemplatesResponse,
} from "./types";

export class DatafyApiError extends Error {
    readonly statusCode: number;
    readonly body: DatafyHttpErrorBody | null;
    readonly retryAfterSec?: number;

    constructor(
        message: string,
        statusCode: number,
        body: DatafyHttpErrorBody | null = null,
        retryAfterSec?: number
    ) {
        super(message);
        this.name = "DatafyApiError";
        this.statusCode = statusCode;
        this.body = body;
        this.retryAfterSec = retryAfterSec;
    }
}

export type DatafyClientOptions = {
    baseUrl?: string;
    channelToken: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
};

/**
 * HTTP client for Datafy WhatsApp Cloud API mirror.
 * Never logs the channel token.
 */
export class DatafyClient {
    readonly baseUrl: string;
    private readonly token: string;
    private readonly timeoutMs: number;
    private readonly fetchImpl: typeof fetch;

    constructor(opts: DatafyClientOptions) {
        this.baseUrl = (opts.baseUrl || "https://cloud.datafyapi.com.br").replace(
            /\/$/,
            ""
        );
        this.token = opts.channelToken;
        this.timeoutMs = opts.timeoutMs ?? 15_000;
        this.fetchImpl = opts.fetchImpl ?? fetch;
    }

    async request<T>(
        method: string,
        path: string,
        init?: { query?: Record<string, string | undefined>; body?: unknown }
    ): Promise<T> {
        const url = new URL(
            path.startsWith("http") ? path : `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`
        );
        if (init?.query) {
            for (const [k, v] of Object.entries(init.query)) {
                if (v !== undefined && v !== "") url.searchParams.set(k, v);
            }
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const res = await this.fetchImpl(url.toString(), {
                method,
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    Accept: "application/json",
                    ...(init?.body !== undefined
                        ? { "Content-Type": "application/json" }
                        : {}),
                },
                body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
                signal: controller.signal,
            });

            const text = await res.text();
            let parsed: DatafyHttpErrorBody | T | null = null;
            if (text) {
                try {
                    parsed = JSON.parse(text) as DatafyHttpErrorBody | T;
                } catch {
                    parsed = null;
                }
            }

            if (!res.ok) {
                const errBody = (parsed as DatafyHttpErrorBody) || null;
                const msg =
                    errBody?.message ||
                    errBody?.error?.message ||
                    `Datafy HTTP ${res.status}`;
                let retryAfter: number | undefined;
                const m = /Tente novamente em (\d+)s/i.exec(msg);
                if (m) retryAfter = Number(m[1]);
                throw new DatafyApiError(msg, res.status, errBody, retryAfter);
            }

            return (parsed as T) ?? ({} as T);
        } catch (e) {
            if (e instanceof DatafyApiError) throw e;
            if ((e as Error)?.name === "AbortError") {
                throw new DatafyApiError("Datafy request timeout", 408);
            }
            throw new DatafyApiError(
                e instanceof Error ? e.message : "Datafy request failed",
                502
            );
        } finally {
            clearTimeout(timer);
        }
    }

    /** GET /me — Datafy-specific account IDs. */
    getMe(): Promise<DatafyMeResponse> {
        return this.request<DatafyMeResponse>("GET", "/me");
    }

    /** GET /v1/{waba_id}/message_templates — list Meta-approved templates. */
    listTemplates(
        wabaId: string,
        opts?: {
            status?: string;
            name?: string;
            fields?: string;
            limit?: number;
            after?: string;
        }
    ): Promise<DatafyTemplatesResponse> {
        return this.request<DatafyTemplatesResponse>(
            "GET",
            `/v1/${encodeURIComponent(wabaId)}/message_templates`,
            {
                query: {
                    status: opts?.status,
                    name: opts?.name,
                    fields:
                        opts?.fields ||
                        "name,status,category,language,id,rejected_reason",
                    limit: opts?.limit != null ? String(opts.limit) : undefined,
                    after: opts?.after,
                },
            }
        );
    }

    /** GET /v1/{waba_id}/phone_numbers — connection/quality/limits. */
    getPhoneNumbers(
        wabaId: string,
        fields =
            "id,display_phone_number,verified_name,quality_rating,status,whatsapp_business_manager_messaging_limit,throughput,platform_type"
    ): Promise<{
        data?: Array<{
            id?: string;
            display_phone_number?: string;
            verified_name?: string;
            quality_rating?: string;
            status?: string;
        }>;
    }> {
        return this.request("GET", `/v1/${encodeURIComponent(wabaId)}/phone_numbers`, {
            query: { fields },
        });
    }

    /** POST /v1/{phone_number_id}/messages — text (24h window). */
    sendText(
        phoneNumberId: string,
        body: {
            to: string;
            text: string;
            previewUrl?: boolean;
            contextMessageId?: string;
        }
    ): Promise<DatafySendMessageResponse> {
        return this.request<DatafySendMessageResponse>(
            "POST",
            `/v1/${encodeURIComponent(phoneNumberId)}/messages`,
            {
                body: {
                    messaging_product: "whatsapp",
                    recipient_type: "individual",
                    to: body.to,
                    type: "text",
                    text: {
                        preview_url: Boolean(body.previewUrl),
                        body: body.text,
                    },
                    ...(body.contextMessageId
                        ? { context: { message_id: body.contextMessageId } }
                        : {}),
                },
            }
        );
    }

    /** POST /v1/{phone_number_id}/messages — approved template. */
    sendTemplate(
        phoneNumberId: string,
        body: {
            to: string;
            name: string;
            languageCode: string;
            components?: unknown[];
        }
    ): Promise<DatafySendMessageResponse> {
        return this.request<DatafySendMessageResponse>(
            "POST",
            `/v1/${encodeURIComponent(phoneNumberId)}/messages`,
            {
                body: {
                    messaging_product: "whatsapp",
                    recipient_type: "individual",
                    to: body.to,
                    type: "template",
                    template: {
                        name: body.name,
                        language: { code: body.languageCode },
                        ...(body.components?.length
                            ? { components: body.components }
                            : {}),
                    },
                },
            }
        );
    }

    /**
     * POST /v1/{phone_number_id}/messages — mark inbound message as read.
     * Meta Cloud API shape.
     */
    markAsRead(phoneNumberId: string, wamid: string): Promise<unknown> {
        return this.request(
            "POST",
            `/v1/${encodeURIComponent(phoneNumberId)}/messages`,
            {
                body: {
                    messaging_product: "whatsapp",
                    status: "read",
                    message_id: wamid,
                },
            }
        );
    }

    /** GET /media/{id} — Datafy helper: durable download URL for inbound media. */
    getInboundMedia(mediaId: string): Promise<{
        url?: string;
        mime_type?: string;
        size?: number;
    }> {
        return this.request("GET", `/media/${encodeURIComponent(mediaId)}`);
    }

    /**
     * POST /v1/{waba_id}/message_templates — submit template for Meta approval.
     * Returns PENDING; cannot send until APPROVED.
     */
    createTemplate(
        wabaId: string,
        body: {
            name: string;
            language: string;
            category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
            parameter_format?: "POSITIONAL" | "NAMED";
            components: unknown[];
        }
    ): Promise<{ id?: string; status?: string; category?: string }> {
        return this.request("POST", `/v1/${encodeURIComponent(wabaId)}/message_templates`, {
            body,
        });
    }

    /**
     * POST /uploads — Datafy helper: public URL → Meta file handle
     * (required for template HEADER IMAGE example.header_handle).
     */
    createFileHandle(url: string): Promise<{ handle?: string }> {
        return this.request("POST", "/uploads", {
            body: { url },
        });
    }
}

export type DatafySendMessageResponse = {
    messaging_product?: string;
    contacts?: Array<{ input?: string; wa_id?: string }>;
    messages?: Array<{ id?: string; message_status?: string }>;
};
