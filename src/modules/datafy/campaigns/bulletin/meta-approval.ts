/**
 * Meta template approval proposals for the Smart Bulletin Creator.
 *
 * Official limits (Meta Cloud API / Datafy mirror):
 * - Template BODY ≤ 1024 characters
 * - Each variable value ≤ 1024 at send time
 *
 * A full freight bulletin (~2628 chars, 8 loads) cannot be one APPROVED
 * template body. We never stuff long text into variables to bypass that.
 */

import { META_TEMPLATE_BODY_MAX, META_FREEFORM_TEXT_MAX } from "./types";
import type { BulletinEditableDraft } from "./types";
import { serializeBulletinDraft } from "./analyze";
import {
    BULLETIN_TEMPLATE_LIBRARY,
    buildBulletinTemplateSubmission,
    type BulletinTemplateSubmission,
} from "./library";

export type MetaApprovalUiStatus =
    | "draft"
    | "ready_to_submit"
    | "submitting"
    | "pending"
    | "approved"
    | "rejected"
    | "paused"
    | "disabled";

export type SingleBalloonAssessment = {
    /** True only if full bulletin text fits Meta template BODY (≤1024). */
    possibleAsSingleTemplate: boolean;
    charCount: number;
    loadCount: number;
    bodyLimit: typeof META_TEMPLATE_BODY_MAX;
    freeformLimit: typeof META_FREEFORM_TEXT_MAX;
    blockReasons: string[];
    explanations: string[];
};

export type LibraryProposalCard = {
    technicalName: string;
    displayName: string;
    category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
    language: "pt_BR";
    loadsPerMessage: 1 | 2 | 3;
    bodyText: string;
    bodyCharCount: number;
    variableCount: number;
    exampleRow: string[];
    previewFilled: string;
    readyForSubmit: boolean;
    notes: string[];
    /** Local/remote tracking */
    remoteStatus: string | null;
    remoteTemplateId: string | null;
    remoteRejectedReason: string | null;
    lastSubmittedAt: string | null;
    uiStatus: MetaApprovalUiStatus;
    canSubmit: boolean;
    submitBlockReason: string | null;
};

export type MetaApprovalProposal = {
    title: string;
    loadCount: number;
    fullText: string;
    fullTextCharCount: number;
    singleBalloon: SingleBalloonAssessment;
    recommendedCategory: "MARKETING";
    libraryProposals: LibraryProposalCard[];
    /** At least one library model ready for Meta submit */
    hasSubmittableProposal: boolean;
    summary: string;
};

export function mapRemoteToUiStatus(
    remoteStatus: string | null | undefined
): MetaApprovalUiStatus {
    const s = String(remoteStatus || "").toUpperCase();
    if (s === "APPROVED") return "approved";
    if (s === "PENDING") return "pending";
    if (s === "REJECTED") return "rejected";
    if (s === "PAUSED") return "paused";
    if (s === "DISABLED") return "disabled";
    return "draft";
}

export function assessSingleBalloonTemplate(
    fullText: string,
    loadCount: number
): SingleBalloonAssessment {
    const text = (fullText || "").replace(/\r\n/g, "\n").trim();
    const charCount = text.length;
    const blockReasons: string[] = [];
    const explanations: string[] = [];

    if (!text) {
        blockReasons.push("Cole e analise o boletim antes de propor um template.");
    }
    if (charCount > META_TEMPLATE_BODY_MAX) {
        blockReasons.push(
            `O boletim tem ${charCount} caracteres. O corpo (BODY) de template oficial da Meta limita a ${META_TEMPLATE_BODY_MAX} caracteres — não é possível aprovar este conteúdo integral em um único balão de template.`
        );
        explanations.push(
            "Não usamos variáveis longas nem conteúdo oculto para contornar o limite de 1.024 caracteres."
        );
        explanations.push(
            `Para texto livre integral (até ${META_FREEFORM_TEXT_MAX} chars) use “Boletim completo — mensagem única” no Disparo em massa, somente com finalidade Utilidade/Transacional e janela 24h — isso não é template Meta.`
        );
        explanations.push(
            "Para divulgação comercial (Marketing) fora da janela, envie templates reutilizáveis divididos (1–3 cargas por mensagem) após aprovação."
        );
    }

    return {
        possibleAsSingleTemplate:
            charCount > 0 && charCount <= META_TEMPLATE_BODY_MAX,
        charCount,
        loadCount,
        bodyLimit: META_TEMPLATE_BODY_MAX,
        freeformLimit: META_FREEFORM_TEXT_MAX,
        blockReasons,
        explanations,
    };
}

function cardFromSubmission(
    sub: BulletinTemplateSubmission,
    remote?: {
        remoteStatus?: string | null;
        remoteTemplateId?: string | null;
        remoteRejectedReason?: string | null;
        lastSubmittedAt?: Date | string | null;
    }
): LibraryProposalCard {
    const uiStatus = mapRemoteToUiStatus(remote?.remoteStatus);
    let canSubmit = sub.checks.readyForManualSubmit;
    let submitBlockReason: string | null = null;

    if (!sub.checks.bodyWithinLimit) {
        canSubmit = false;
        submitBlockReason = `BODY com ${sub.bodyCharCount} chars excede ${META_TEMPLATE_BODY_MAX}.`;
    } else if (uiStatus === "approved") {
        canSubmit = false;
        submitBlockReason =
            "Já APPROVED na Meta — use em Disparo em massa; não reenvie o mesmo nome/idioma.";
    } else if (uiStatus === "pending") {
        canSubmit = false;
        submitBlockReason =
            "Já PENDING na Meta — aguarde aprovação ou atualize o status.";
    } else if (uiStatus === "rejected") {
        canSubmit = false;
        submitBlockReason =
            "Rejeitado pela Meta — ajuste a estrutura (ou use outro nome técnico) antes de enviar novamente. Não há reenvio automático.";
    } else if (!sub.checks.readyForManualSubmit) {
        canSubmit = false;
        submitBlockReason =
            sub.checks.notes.find((n) => !n.startsWith("Submissão")) ||
            "Modelo inválido para submissão";
    }

    return {
        technicalName: sub.name,
        displayName: sub.name,
        category: sub.category,
        language: "pt_BR",
        loadsPerMessage: sub.loadsPerMessage,
        bodyText: sub.bodyText,
        bodyCharCount: sub.bodyCharCount,
        variableCount: sub.variableCount,
        exampleRow: sub.exampleRow,
        previewFilled: sub.previewFilled,
        readyForSubmit: sub.checks.readyForManualSubmit,
        notes: sub.checks.notes,
        remoteStatus: remote?.remoteStatus
            ? String(remote.remoteStatus).toUpperCase()
            : null,
        remoteTemplateId: remote?.remoteTemplateId || null,
        remoteRejectedReason: remote?.remoteRejectedReason || null,
        lastSubmittedAt: remote?.lastSubmittedAt
            ? new Date(remote.lastSubmittedAt).toISOString()
            : null,
        uiStatus: uiStatus === "draft" && canSubmit ? "ready_to_submit" : uiStatus,
        canSubmit,
        submitBlockReason,
    };
}

export function buildMetaApprovalProposal(
    draft: BulletinEditableDraft,
    remoteByName?: Record<
        string,
        {
            remoteStatus?: string | null;
            remoteTemplateId?: string | null;
            remoteRejectedReason?: string | null;
            lastSubmittedAt?: Date | string | null;
        }
    >
): MetaApprovalProposal {
    const fullText = serializeBulletinDraft({
        general: draft.general,
        loads: draft.loads,
    });
    const loadCount = draft.loads.length;
    const singleBalloon = assessSingleBalloonTemplate(fullText, loadCount);

    // Prefer v3 for new Meta approvals (v2 often rejected for density 2388293)
    const specs = BULLETIN_TEMPLATE_LIBRARY.filter((s) => s.generation === 3);
    const fallback = BULLETIN_TEMPLATE_LIBRARY.filter((s) => s.generation === 1);
    const chosen = specs.length ? specs : fallback;

    const libraryProposals = chosen.map((spec) => {
        const sub = buildBulletinTemplateSubmission(spec);
        const remote = remoteByName?.[spec.preferredName.toLowerCase()];
        return cardFromSubmission(sub, remote);
    });

    const hasSubmittableProposal = libraryProposals.some((p) => p.canSubmit);

    let summary: string;
    if (singleBalloon.possibleAsSingleTemplate) {
        summary =
            "O texto cabe no BODY de template (≤1024). Ainda assim, boletins diários de frete devem preferir modelos reutilizáveis com variáveis MARKETING.";
    } else if (hasSubmittableProposal) {
        summary = `Boletim com ${loadCount} carga(s) e ${singleBalloon.charCount} caracteres não cabe em um único template. Submeta os modelos reutilizáveis (1–3 cargas) para aprovação MARKETING.`;
    } else {
        summary =
            "Nenhum modelo pronto para nova submissão — verifique status APPROVED/PENDING ou corrija rejeições.";
    }

    return {
        title: draft.general.title || "Boletim",
        loadCount,
        fullText,
        fullTextCharCount: singleBalloon.charCount,
        singleBalloon,
        recommendedCategory: "MARKETING",
        libraryProposals,
        hasSubmittableProposal,
        summary,
    };
}

/** Pure helpers for webhook / list sync mapping. */
export function normalizeMetaTemplateEvent(value: {
    event?: string;
    message_template_id?: string | number;
    message_template_name?: string;
    message_template_language?: string;
    reason?: string;
}): {
    name: string | null;
    status: string | null;
    templateId: string | null;
    rejectedReason: string | null;
    language: string | null;
} {
    const event = String(value.event || "").toUpperCase();
    const statusMap: Record<string, string> = {
        APPROVED: "APPROVED",
        REJECTED: "REJECTED",
        PENDING: "PENDING",
        PAUSED: "PAUSED",
        DISABLED: "DISABLED",
        FLAGAGED: "PAUSED",
        IN_APPEAL: "PENDING",
    };
    return {
        name: value.message_template_name
            ? String(value.message_template_name)
            : null,
        status: statusMap[event] || (event || null),
        templateId:
            value.message_template_id != null
                ? String(value.message_template_id)
                : null,
        rejectedReason: value.reason ? String(value.reason) : null,
        language: value.message_template_language
            ? String(value.message_template_language)
            : null,
    };
}
