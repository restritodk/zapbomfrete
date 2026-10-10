/**
 * Boletim completo — uma única mensagem free-form por destinatário.
 *
 * Limite de tamanho (4096) ≠ autorização de envio real.
 * - Wizard/navegação: basta o texto caber em 4096.
 * - Envio real: finalidade utility/transactional + janela 24h + elegibilidade.
 * Marketing não usa texto livre nem “Utilidade” como contorno — use templates.
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
    charLimit: typeof META_FREEFORM_TEXT_MAX;
    withinFreeformLimit: boolean;
    purposeAllowsFreeform: boolean;
    /**
     * Tamanho OK para configurar/revisar a campanha (wizard).
     * Não implica autorização de disparo real.
     */
    sizeReady: boolean;
    /** @deprecated alias de sizeReady — navegação do assistente */
    contentReady: boolean;
    /**
     * Conteúdo + finalidade permitem tentar Modalidade B.
     * Ainda exige janela 24h aberta por destinatário no envio real.
     */
    realSendContentReady: boolean;
    readyForRealSend: boolean;
    sizeBlockReasons: string[];
    realSendBlockReasons: string[];
    /** Motivos que impedem sizeReady (usado no wizard) */
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
    const withinFreeformLimit =
        charCount > 0 && charCount <= META_FREEFORM_TEXT_MAX;
    const purposeAllowsFreeform = purposeAllowsServiceWindowFreeform(purpose);

    const sizeBlockReasons: string[] = [];
    const realSendBlockReasons: string[] = [];
    const explanations: string[] = [];

    if (!text) {
        sizeBlockReasons.push(
            "Cole o boletim completo antes de escolher esta modalidade."
        );
    }
    if (charCount > META_FREEFORM_TEXT_MAX) {
        sizeBlockReasons.push(
            `O texto tem ${charCount} caracteres e excede o limite de ${META_FREEFORM_TEXT_MAX} da mensagem de texto livre da Meta (Cloud API). Não truncamos o boletim.`
        );
    }

    if (!purposeAllowsFreeform) {
        realSendBlockReasons.push(
            "Finalidade marketing (ou equivalente comercial) exige template APPROVED (Modalidade A). A janela de 24h e o texto livre não autorizam divulgação comercial."
        );
        explanations.push(
            `Para campanhas comerciais use “Envio dividido por templates” (corpo ≤ ${META_TEMPLATE_BODY_MAX} chars por parte). Não altere a finalidade para Utilidade só para contornar regras de Marketing da Meta.`
        );
    } else {
        explanations.push(
            `Modalidade B: texto livre até ${META_FREEFORM_TEXT_MAX} chars, somente para destinatários com janela de atendimento aberta (últimas 24h). Quem estiver fora da janela será bloqueado no envio real.`
        );
    }

    explanations.push(
        "O link de grupo permanece só no texto — não adiciona participantes automaticamente."
    );
    explanations.push(
        "Preparar/revisar a campanha não autoriza o disparo — o envio real só ocorre se todas as regras Meta forem satisfeitas."
    );

    const sizeReady = Boolean(text) && withinFreeformLimit;
    const realSendContentReady = sizeReady && purposeAllowsFreeform;

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
        charLimit: META_FREEFORM_TEXT_MAX,
        withinFreeformLimit,
        purposeAllowsFreeform,
        sizeReady,
        contentReady: sizeReady,
        realSendContentReady,
        readyForRealSend: realSendContentReady,
        sizeBlockReasons,
        realSendBlockReasons,
        blockReasons: sizeBlockReasons,
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

    const blockBits = [
        ...assessment.sizeBlockReasons,
        ...assessment.realSendBlockReasons,
    ];

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
            // Size overflow blocks content; purpose only blocks real send
            readyForRealSend: assessment.realSendContentReady,
            compatibility: !assessment.sizeReady
                ? "param_overflow"
                : assessment.realSendContentReady
                  ? "ready"
                  : "blocked",
            blockReason: blockBits.length ? blockBits.join(" ") : null,
            policyWarning: assessment.explanations[0] || null,
        },
    ];
}

export function deliveryModeNeedsUserChoice(
    analysis: BulletinAnalysis | null,
    splitPartCount: number
): boolean {
    if (!analysis?.loadCount) return false;
    return analysis.loadCount > 1 || splitPartCount > 1;
}
