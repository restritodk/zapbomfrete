import { CONSENT_PURPOSE, CONSENT_SOURCE } from "../consent/constants";

export type BulkGrantEvidenceInput = {
    evidenceText?: string | null;
    consentSource?: string | null;
    authorizedAt?: string | null;
    purpose?: string | null;
    wabaId?: string | null;
    /** Human-readable origin label shown in UI (stored in evidence payload). */
    originLabel?: string | null;
};

export type BulkGrantEvidence =
    | {
          ok: true;
          evidenceText: string;
          consentSource: string;
          authorizedAt: Date;
          purpose: string;
          wabaId: string;
          originLabel: string | null;
      }
    | { ok: false; message: string };

/**
 * Bulk grant requires verifiable evidence — selecting contacts alone is never enough.
 */
export function validateBulkGrantEvidence(
    input: BulkGrantEvidenceInput
): BulkGrantEvidence {
    const evidenceText = String(input.evidenceText || "").trim();
    if (evidenceText.length < 10) {
        return {
            ok: false,
            message:
                "Informe evidência ou referência verificável (mínimo 10 caracteres).",
        };
    }
    if (evidenceText.length > 4000) {
        return {
            ok: false,
            message: "Evidência muito longa (máximo 4000 caracteres).",
        };
    }

    const consentSource = String(
        input.consentSource || CONSENT_SOURCE.MANUAL_EVIDENCE
    ).trim();
    if (!consentSource) {
        return { ok: false, message: "Informe a origem da autorização." };
    }
    const allowedSources = new Set<string>([
        CONSENT_SOURCE.MANUAL_EVIDENCE,
        CONSENT_SOURCE.INTERACTIVE_BUTTON,
        "manual",
        "formulario",
        "contrato",
        "ligacao",
        "presencial",
        "email",
        "outro",
    ]);
    if (!allowedSources.has(consentSource)) {
        return { ok: false, message: "Origem da autorização inválida." };
    }

    if (!input.authorizedAt) {
        return { ok: false, message: "Informe a data da autorização." };
    }
    const authorizedAt = new Date(input.authorizedAt);
    if (Number.isNaN(authorizedAt.getTime())) {
        return { ok: false, message: "Data da autorização inválida." };
    }
    if (authorizedAt.getTime() > Date.now() + 60_000) {
        return {
            ok: false,
            message: "A data da autorização não pode ser no futuro.",
        };
    }

    const purpose = String(
        input.purpose || CONSENT_PURPOSE.MARKETING_OFFERS
    ).trim();
    if (!purpose) {
        return { ok: false, message: "Informe a finalidade da autorização." };
    }

    const wabaId = String(input.wabaId || "").trim();
    const originLabel = String(input.originLabel || "").trim() || null;

    return {
        ok: true,
        evidenceText,
        consentSource,
        authorizedAt,
        purpose,
        wabaId,
        originLabel,
    };
}

/** Pure skip rules for bulk grant (no DB). */
export function bulkGrantSkipReason(
    contact: { consentStatus: string; active: boolean }
): string | null {
    if (!contact.active) return "inactive";
    if (contact.consentStatus === "opted_out") return "opted_out";
    if (contact.consentStatus === "granted") return "already_granted";
    return null;
}

export function bulkGrantSkipLabel(reason: string): string {
    switch (reason) {
        case "inactive":
            return "Contato inativo";
        case "opted_out":
            return "Opt-out / revogado — não pode conceder sem limpar opt-out";
        case "already_granted":
            return "Já possui consentimento concedido";
        case "not_found":
            return "Contato não encontrado na organização";
        default:
            return reason;
    }
}
