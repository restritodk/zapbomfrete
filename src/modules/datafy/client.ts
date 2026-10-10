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

    /** GET /v1/{waba_id}/phone_numbers — connection/quality/limits (prepared). */
    getPhoneNumbers(wabaId: string): Promise<unknown> {
        return this.request("GET", `/v1/${encodeURIComponent(wabaId)}/phone_numbers`);
    }
}
