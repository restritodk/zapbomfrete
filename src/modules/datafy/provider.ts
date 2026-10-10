import { DatafyApiError, DatafyClient } from "./client";
import {
    loadDatafyConfig,
    saveDatafyConfig,
    toPublicStatus,
    type SaveDatafyInput,
} from "./config";
import { redactSecrets } from "./crypto-secrets";
import type { DatafyPublicStatus, DatafyTemplatesResponse } from "./types";

/**
 * Modular Datafy provider — fully isolated from Baileys WhatsAppInstance.
 * Phase 1: auth, account probe, templates listing, webhook readiness.
 * Outbound campaigns / broadcast migration intentionally disabled.
 */
export class DatafyProvider {
    readonly name = "datafy" as const;

    async getPublicStatus(): Promise<DatafyPublicStatus> {
        const cfg = await loadDatafyConfig();
        return toPublicStatus(cfg);
    }

    async saveSettings(input: SaveDatafyInput) {
        await saveDatafyConfig(input);
        return this.getPublicStatus();
    }

    /**
     * Create an authenticated client if credentials exist.
     * Throws if token missing — never returns a client without auth.
     */
    async createClient(): Promise<DatafyClient> {
        const cfg = await loadDatafyConfig();
        if (!cfg.channelToken) {
            throw new DatafyApiError(
                "Token do canal Datafy não configurado",
                401
            );
        }
        return new DatafyClient({
            baseUrl: cfg.baseUrl,
            channelToken: cfg.channelToken,
        });
    }

    /** Verify credentials via GET /me and persist IDs. */
    async verifyConnection(): Promise<{
        ok: boolean;
        status: DatafyPublicStatus;
        me?: Awaited<ReturnType<DatafyClient["getMe"]>>;
        error?: string;
    }> {
        try {
            const client = await this.createClient();
            const me = await client.getMe();

            await saveDatafyConfig({
                phoneNumberId: me.phone_number_id || null,
                wabaId: me.waba_id || null,
                businessId: me.business_id || null,
                clienteId: me.cliente_id || null,
                lastVerifiedAt: new Date(),
                lastError: null,
            });

            return { ok: true, status: await this.getPublicStatus(), me };
        } catch (e) {
            const message =
                e instanceof DatafyApiError
                    ? e.message
                    : e instanceof Error
                      ? e.message
                      : "Falha ao verificar Datafy";

            // Never persist token material in lastError
            const redacted = redactSecrets(message);
            const safe =
                redacted.length > 240 ? redacted.slice(0, 240) + "…" : redacted;
            try {
                await saveDatafyConfig({ lastError: safe });
            } catch {
                /* ignore */
            }

            return {
                ok: false,
                status: await this.getPublicStatus(),
                error: safe,
            };
        }
    }

    /** List Meta message templates (approved/pending/…). Phase 1 read-only. */
    async listTemplates(opts?: {
        status?: string;
        name?: string;
        after?: string;
        limit?: number;
    }): Promise<DatafyTemplatesResponse> {
        const cfg = await loadDatafyConfig();
        if (!cfg.wabaId) {
            const verified = await this.verifyConnection();
            if (!verified.ok || !verified.me?.waba_id) {
                throw new DatafyApiError(
                    verified.error || "waba_id indisponível",
                    400
                );
            }
            cfg.wabaId = verified.me.waba_id;
        }

        const client = await this.createClient();
        return client.listTemplates(cfg.wabaId!, {
            status: opts?.status || "APPROVED",
            name: opts?.name,
            after: opts?.after,
            limit: opts?.limit ?? 50,
        });
    }

    /**
     * Phase 2 guard — real outbound campaign sends are not enabled yet.
     */
    assertOutboundDisabled(): never {
        throw new DatafyApiError(
            "Envio de campanhas via Datafy desabilitado nesta fase",
            403
        );
    }
}

export const datafyProvider = new DatafyProvider();

/** Provider registry — keeps Baileys and Datafy isolated. */
export type MessagingProviderName = "baileys" | "datafy";

export function isDatafyProvider(name: string): name is "datafy" {
    return name === "datafy";
}
