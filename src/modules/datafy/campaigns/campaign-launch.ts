/**
 * Launch gate for Datafy campaign wizard (Etapa 5 — Iniciar disparo).
 * Pure helpers — no Prisma / no network — safe for client + tests.
 */

import {
    assessRealSendReadiness,
    hasApprovedTemplateContent,
    purposeAllowsServiceWindowFreeform,
    purposeUsesBaileysFreeform,
    type RealSendAssessment,
    type TemplatePartLite,
} from "./send-readiness";
import {
    DELAY_PRESETS_SEC,
    normalizeCampaignDelayMs,
    parseDelaySeconds,
} from "./pacing";
import {
    canUseTemplateAsFreeformFallback,
    validateTemplateBodyParamCount,
} from "./template-params";

export type LaunchTemplateLite = {
    name: string;
    language: string;
    status?: string | null;
    category?: string | null;
    components?: unknown;
    /** BODY text when known (managed library / sync). */
    bodyText?: string | null;
};

export function isApprovedTemplateStatus(
    status: string | null | undefined
): boolean {
    return String(status || "").toUpperCase() === "APPROVED";
}

/** Resolve whether the wizard currently has an APPROVED template for real send. */
export function resolveWizardHasApprovedTemplate(opts: {
    contentKind: "message" | "bulletin" | string;
    contentMode: "existing" | "custom" | "direct" | string;
    bulletinDeliveryMode?: string | null;
    selectedTemplate?: LaunchTemplateLite | null;
    submittedTemplate?: {
        templateName?: string | null;
        approvalStatus?: string | null;
    } | null;
    bulletinParts?: TemplatePartLite[] | null;
}): boolean {
    const isCompleteBulletin =
        opts.contentKind === "bulletin" &&
        opts.bulletinDeliveryMode === "complete_single";
    const isDirectFreeform =
        opts.contentMode === "direct" || isCompleteBulletin;

    if (isDirectFreeform) {
        return isApprovedTemplateStatus(opts.selectedTemplate?.status);
    }

    return hasApprovedTemplateContent({
        contentKind: opts.contentKind,
        templateName:
            opts.contentKind === "bulletin"
                ? opts.bulletinParts?.[0]?.templateName
                : opts.contentMode === "custom"
                  ? opts.submittedTemplate?.templateName
                  : opts.selectedTemplate?.name,
        templateApprovalStatus:
            opts.contentKind === "bulletin"
                ? opts.bulletinParts?.[0]?.templateApprovalStatus
                : opts.contentMode === "custom"
                  ? opts.submittedTemplate?.approvalStatus
                  : opts.selectedTemplate?.status,
        messageParts:
            opts.contentKind === "bulletin" ? opts.bulletinParts : null,
    });
}

export function assessWizardSendReadiness(opts: {
    purpose: string;
    consentEligibleCount: number;
    openWindowCount: number;
    hasApprovedTemplate: boolean;
    hasFreeformBody: boolean;
}): RealSendAssessment {
    return assessRealSendReadiness(opts);
}

/** Button "Iniciar disparo" / "Agendar disparo" enablement. */
export function canEnableStartDispatchButton(opts: {
    saving: boolean;
    simulationOnlyAudience: boolean;
    realSendReady: boolean;
    technicallySendableCount: number;
    scheduledAtRequired?: boolean;
    scheduledAt?: string | null;
}): boolean {
    if (opts.saving) return false;
    if (opts.simulationOnlyAudience) return false;
    if (!opts.realSendReady) return false;
    if (opts.technicallySendableCount <= 0) return false;
    if (opts.scheduledAtRequired && !opts.scheduledAt) return false;
    return true;
}

/**
 * Prefer UTILITY/TRANSACTIONAL APPROVED template as Envio Direto fallback
 * when no 24h window is open.
 *
 * Never pick a multi-parameter boletim template for freeform paste fallback —
 * that caused Meta #132000 (0/1 CRM tokens vs 12–18 BODY params).
 */
export function pickFallbackApprovedTemplate(
    templates: LaunchTemplateLite[],
    purpose: string,
    opts?: { variableMapping?: { body?: unknown[] | null } | null }
): LaunchTemplateLite | null {
    const mapping = opts?.variableMapping || { body: [] };
    const approved = templates.filter((t) => {
        if (!isApprovedTemplateStatus(t.status)) return false;
        return canUseTemplateAsFreeformFallback({
            templateName: t.name,
            bodyText: t.bodyText,
            templateComponents: t.components,
            variableMapping: mapping,
        });
    });
    if (!approved.length) return null;
    const p = String(purpose || "").toLowerCase();
    const want =
        p === "transactional"
            ? ["TRANSACTIONAL", "UTILITY"]
            : p === "utility"
              ? ["UTILITY", "TRANSACTIONAL"]
              : [];
    for (const cat of want) {
        const hit = approved.find(
            (t) => String(t.category || "").toUpperCase() === cat
        );
        if (hit) return hit;
    }
    return approved[0] || null;
}

/** True when selected APPROVED template can be sent with the given mapping. */
export function templateParamsReadyForSend(opts: {
    template?: LaunchTemplateLite | null;
    variableMapping?: { body?: unknown[] | null } | null;
    /** Bulletin parts already carry their own mapping. */
    bulletinParts?: Array<{
        templateName?: string | null;
        templateLanguage?: string | null;
        bodyText?: string | null;
        templateComponents?: unknown;
        variableMapping?: { body?: string[] | null } | null;
        readyForRealSend?: boolean;
    }> | null;
    contentKind?: string;
}): { ok: boolean; message: string | null } {
    if (opts.contentKind === "bulletin" && opts.bulletinParts?.length) {
        for (const part of opts.bulletinParts) {
            const check = validateTemplateBodyParamCount({
                templateName: part.templateName,
                language: part.templateLanguage,
                bodyText: part.bodyText,
                templateComponents: part.templateComponents,
                variableMapping: part.variableMapping || { body: [] },
            });
            if (!check.ok) {
                return { ok: false, message: check.message };
            }
        }
        return { ok: true, message: null };
    }
    if (!opts.template || !isApprovedTemplateStatus(opts.template.status)) {
        return { ok: true, message: null };
    }
    const check = validateTemplateBodyParamCount({
        templateName: opts.template.name,
        language: opts.template.language,
        bodyText: opts.template.bodyText,
        templateComponents: opts.template.components,
        variableMapping: opts.variableMapping || { body: [] },
    });
    return { ok: check.ok, message: check.message };
}

export function shouldAutoPickFallbackTemplate(opts: {
    purpose: string;
    contentMode: string;
    contentKind: string;
    bulletinDeliveryMode?: string | null;
    eligibleCount: number;
    openWindowCount: number;
    templateKey: string;
}): boolean {
    if (purposeUsesBaileysFreeform(opts.purpose)) return false;
    if (opts.eligibleCount <= 0) return false;
    if (opts.templateKey) return false;
    if ((opts.openWindowCount || 0) > 0) return false;
    if (!purposeAllowsServiceWindowFreeform(opts.purpose)) return false;
    const direct =
        opts.contentMode === "direct" ||
        (opts.contentKind === "bulletin" &&
            opts.bulletinDeliveryMode === "complete_single");
    return direct;
}

export function templateKeyOf(t: LaunchTemplateLite): string {
    return `${t.name}::${t.language}`;
}

/** Interval presets used by Etapa 4 — must stay wired to the queue delayMs. */
export function assertDelayPresetSupported(seconds: number): boolean {
    return (DELAY_PRESETS_SEC as readonly number[]).includes(seconds);
}

export function delayMsFromWizardSeconds(seconds: number): number | null {
    const parsed = parseDelaySeconds(seconds);
    if (!parsed.ok) return null;
    return normalizeCampaignDelayMs(parsed.delayMs);
}

/**
 * Scenario contract for Utilidade/Transacional with imported audience
 * (e.g. 139 contacts) — used by tests.
 */
export function evaluateDirectLaunchScenario(opts: {
    purpose: "utility" | "transactional" | string;
    importedCount: number;
    eligibleCount: number;
    openWindowCount: number;
    hasFreeformBody: boolean;
    hasApprovedTemplate: boolean;
    delaySeconds: number;
}): {
    audiencePreserved: boolean;
    intervalOk: boolean;
    buttonEnabled: boolean;
    technicallySendableCount: number;
    needsTemplateCount: number;
    modality: string;
} {
    const assessment = assessRealSendReadiness({
        purpose: opts.purpose,
        consentEligibleCount: opts.eligibleCount,
        openWindowCount: opts.openWindowCount,
        hasApprovedTemplate: opts.hasApprovedTemplate,
        hasFreeformBody: opts.hasFreeformBody,
    });
    return {
        audiencePreserved:
            opts.eligibleCount > 0 &&
            opts.eligibleCount <= opts.importedCount,
        intervalOk: assertDelayPresetSupported(opts.delaySeconds),
        buttonEnabled: canEnableStartDispatchButton({
            saving: false,
            simulationOnlyAudience: false,
            realSendReady: assessment.realSendReady,
            technicallySendableCount: assessment.technicallySendableCount,
        }),
        technicallySendableCount: assessment.technicallySendableCount,
        needsTemplateCount: assessment.needsTemplateCount,
        modality: assessment.modality,
    };
}
