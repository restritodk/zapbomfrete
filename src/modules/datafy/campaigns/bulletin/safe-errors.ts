/**
 * Sanitize infrastructure / Prisma errors before returning to the client.
 * Technical details go to server logs only.
 */

import { logger } from "@/lib/logger";
import { redactSecrets } from "@/modules/datafy/crypto-secrets";

const DB_PERMISSION =
    /permission denied|42501|P2021|does not exist in the current database|DatafyTemplateSyncState/i;
const DB_UNAVAILABLE =
    /ECONNREFUSED|connection.*timeout|Can't reach database|P1001|P1017|too many connections/i;

export type SafeClientError = {
    statusCode: number;
    message: string;
    code: "db_permission" | "db_unavailable" | "sync_busy" | "auth" | "generic";
};

export function toSafeApprovalsError(
    err: unknown,
    context: string
): SafeClientError {
    const raw =
        err instanceof Error ? err.message : typeof err === "string" ? err : "";
    const safeLog = redactSecrets(raw || String(err));
    logger.error("DatafyApprovals", context, safeLog);

    if (/já em andamento|429/i.test(raw)) {
        return {
            statusCode: 429,
            message:
                "Uma sincronização já está em andamento. Aguarde alguns instantes e tente novamente.",
            code: "sync_busy",
        };
    }
    if (/401|não configurado|token/i.test(raw) && /datafy|canal/i.test(raw)) {
        return {
            statusCode: 401,
            message:
                "Não foi possível autenticar na Datafy. Verifique a configuração do canal com o administrador.",
            code: "auth",
        };
    }
    if (DB_PERMISSION.test(raw) || DB_PERMISSION.test(safeLog)) {
        return {
            statusCode: 503,
            message:
                "Não foi possível acessar o armazenamento de sincronização. A equipe técnica precisa aplicar as permissões do banco (script de grants).",
            code: "db_permission",
        };
    }
    if (DB_UNAVAILABLE.test(raw) || DB_UNAVAILABLE.test(safeLog)) {
        return {
            statusCode: 503,
            message:
                "Banco de dados temporariamente indisponível. Tente novamente em instantes.",
            code: "db_unavailable",
        };
    }

    return {
        statusCode: 500,
        message:
            "Não foi possível sincronizar os templates. Verifique a conexão com o serviço e tente novamente.",
        code: "generic",
    };
}
