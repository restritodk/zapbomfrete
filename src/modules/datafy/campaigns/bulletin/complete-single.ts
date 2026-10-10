/**
 * Boletim completo — uma única mensagem free-form por destinatário.
 *
 * Só é tecnicamente viável na Modalidade B (janela 24h + finalidade
 * utility/transactional). Marketing exige template APPROVED (Modalidade A),
 * cujo BODY Meta limita a 1024 chars — não cabe um boletim multi-carga integral.
 */

import { purposeAllowsServiceWindowFreeform } from "../send-readiness";
import {
    META_FREEFORM_TEXT_MAX,
    META_TEMPLATE_BODY_MAX,
    type BulletinAnalysis,
    type BulletinDeliveryMode,
    type CampaignMessagePart,
} from "./types";

export type CompleteBulletinAssessment = {
    mode: "complete_single";
    charCount: number;
    loadCount: number;
    withinFreeformLimit: boolean;
    purposeAllowsFreeform: boolean;
    /** Content+purpose side: can attempt Modalidade B (still needs open window per recipient). */
    contentReady: boolean;
    /** True only when contentReady — real send still needs open 24h windows. */
    readyForRealSend: boolean;
    blockReasons: string[];
    explanations: string[];
    alternatives: Array<{
        mode: BulletinDeliveryMode;
        label: string;
        note: string;
    }>;
};

export function assessCompleteBulletin(
    rawText: string,
    analysis: BulletinAnalysis | null,
    purpose: string
): CompleteBulletinAssessment {
    const text = (rawText || "").replace(/\r\n/g, "\n").trim();
    const charCount = text.length;
    const loadCount = analysis?.loadCount ?? 0;
    const withinFreeformLimit = charCount > 0 && charCount <= META_FREEFORM_TEXT_MAX;
    const purposeAllowsFreeform = purposeAllowsServiceWindowFreeform(purpose);

    const blockReasons: string[] = [];
    const explanations: string[] = [];

    if (!text) {
        blockReasons.push("Cole o boletim completo antes de escolher esta modalidade.");
    }
    if (charCount > META_FREEFORM_TEXT_MAX) {
        blockReasons.push(
            `O texto tem ${charCount} caracteres e excede o limite de ${META_FREEFORM_TEXT_MAX} da mensagem de texto livre da Meta (Cloud API). Não truncamos o boletim.`
        );
    }
    if (!purposeAllowsFreeform) {
        blockReasons.push(
            "Finalidade marketing (ou equivalente comercial) exige template APPROVED (Modalidade A). A janela de 24h não autoriza divulgação comercial em texto livre."
        );
        explanations.push(
            `Templates Meta limitam o corpo a ${META_TEMPLATE_BODY_MAX} caracteres — um boletim multi-carga integral não cabe em um único template. Use “Envio dividido por templates” ou altere a finalidade para Utilidade/Transacional apenas se a política Meta permitir (não é contorno de marketing).`
        );
    } else {
        explanations.push(
            `Modalidade B: texto livre até ${META_FREEFORM_TEXT_MAX} chars, somente para destinatários com janela de atendimento aberta (últimas 24h). Quem estiver fora da janela será ignorado/bloqueado no envio real.`
        );
    }

    explanations.push(
        "O link de grupo permanece só no texto — não adiciona participantes automaticamente."
    );

    const contentReady =
        Boolean(text) && withinFreeformLimit && purposeAllowsFreeform;

    const alternatives: CompleteBulletinAssessment["alternatives"] = [
        {
            mode: "split_templates",
            label: "Envio dividido por templates aprovados",
            note: `Divide em partes de 1–3 cargas com templates MARKETING APPROVED (corpo ≤ ${META_TEMPLATE_BODY_MAX} chars cada). Adequado para campanhas comerciais.`,
        },
    ];

    return {
        mode: "complete_single",
        charCount,
        loadCount,
        withinFreeformLimit,
        purposeAllowsFreeform,
        contentReady,
        readyForRealSend: contentReady,
        blockReasons,
        explanations,
        alternatives,
    };
}

/** One campaign part with the original bulletin text preserved verbatim. */
export function composeCompleteBulletinPart(
    rawText: string,
    analysis: BulletinAnalysis,
    purpose: string
): CampaignMessagePart[] {
    const assessment = assessCompleteBulletin(rawText, analysis, purpose);
    const bodyText = (rawText || "").replace(/\r\n/g, "\n").trim();
    const loadIndexes = analysis.loads.map((l) => l.index);

    return [
        {
            index: 0,
            label: `${analysis.title || "Boletim"} — mensagem única`,
            bodyText,
            loadIndexes,
            charCount: bodyText.length,
            templateName: null,
            templateLanguage: null,
            templateCategory: null,
            templateApprovalStatus: null,
            templateComponents: null,
            variableMapping: null,
            libraryTemplateId: null,
            readyForRealSend: assessment.readyForRealSend,
            compatibility: assessment.contentReady ? "ready" : "blocked",
            blockReason: assessment.blockReasons.join(" ") || null,
            policyWarning: assessment.explanations[0] || null,
        },
    ];
}

export function deliveryModeNeedsUserChoice(
    analysis: BulletinAnalysis | null,
    splitPartCount: number
): boolean {
    if (!analysis?.loadCount) return false;
    // Multi-load or multi-part split → must not auto-split silently
    return analysis.loadCount > 1 || splitPartCount > 1;
}
