import { normalizeBrazilianPhone } from "@/lib/phone-br";
import type { CampaignPurpose } from "./constants";

export type EligibilityContact = {
    id: string;
    waId: string;
    fullName: string | null;
    company: string | null;
    city: string | null;
    state: string | null;
    category: string | null;
    origin: string;
    active: boolean;
    consentStatus: string;
};

export type EligibilityResult =
    | { ok: true; waId: string }
    | { ok: false; reason: string };

export type EligibilityOpts = {
    purpose: CampaignPurpose | string;
    requireConsent: boolean;
    /**
     * Dry-run only: allow numbers that lack marketing consent / are not in CRM,
     * without treating them as authorized. Still blocks opt-out, denied, inactive, invalid.
     */
    simulationRelaxConsent?: boolean;
};

function isNotInCrm(contact: EligibilityContact): boolean {
    return contact.id.startsWith("synth:");
}

/**
 * Marketing campaigns require explicit consent (granted).
 * Utility/transactional still respect opt-out and inactive.
 * Import never implies consent.
 */
export function evaluateEligibility(
    contact: EligibilityContact,
    opts: EligibilityOpts
): EligibilityResult {
    const waId = normalizeBrazilianPhone(contact.waId);
    if (!waId || waId.length < 10) {
        return { ok: false, reason: "invalid_phone" };
    }
    if (!contact.active) {
        return { ok: false, reason: "inactive" };
    }
    if (contact.consentStatus === "opted_out") {
        return { ok: false, reason: "opted_out" };
    }
    if (contact.consentStatus === "denied") {
        return { ok: false, reason: "denied" };
    }

    const purpose = opts.purpose || "marketing";
    const needsConsent =
        opts.requireConsent &&
        (purpose === "marketing" || purpose === "other");

    if (needsConsent && contact.consentStatus !== "granted") {
        if (opts.simulationRelaxConsent) {
            // Simulation path — valid phone, not opted out; not authorized for real send
            return { ok: true, waId };
        }
        if (isNotInCrm(contact)) {
            return { ok: false, reason: "not_in_crm" };
        }
        return { ok: false, reason: "missing_consent" };
    }

    return { ok: true, waId };
}

export function skipReasonLabel(reason: string | null | undefined): string {
    switch (reason) {
        case "invalid_phone":
            return "Telefone inválido";
        case "inactive":
            return "Contato desativado";
        case "opted_out":
            return "Recusado / revogado (opt-out)";
        case "denied":
            return "Consentimento recusado";
        case "missing_consent":
            return "Sem consentimento válido";
        case "not_in_crm":
            return "Número não encontrado no CRM";
        case "duplicate":
            return "Número duplicado na campanha";
        case "no_service_window":
            return "Janela de atendimento fechada (precisa de template)";
        case "consent_revoked_runtime":
            return "Consentimento revogado durante a campanha";
        default:
            return reason || "Excluído";
    }
}

/** Ordered keys for UI breakdown */
export const EXCLUSION_REASON_ORDER = [
    "missing_consent",
    "not_in_crm",
    "opted_out",
    "denied",
    "inactive",
    "invalid_phone",
    "duplicate",
    "consent_revoked_runtime",
] as const;

/** Audience consent counters (independent of final eligibility). */
export function summarizeConsentAudience(
    contacts: EligibilityContact[]
): {
    inCrm: number;
    granted: number;
    missingConsent: number;
    deniedOrRevoked: number;
    notInCrm: number;
} {
    let inCrm = 0;
    let granted = 0;
    let missingConsent = 0;
    let deniedOrRevoked = 0;
    let notInCrm = 0;
    for (const c of contacts) {
        if (isNotInCrm(c)) {
            notInCrm++;
            continue;
        }
        inCrm++;
        if (c.consentStatus === "granted") granted++;
        else if (
            c.consentStatus === "opted_out" ||
            c.consentStatus === "denied"
        ) {
            deniedOrRevoked++;
        } else {
            missingConsent++;
        }
    }
    return { inCrm, granted, missingConsent, deniedOrRevoked, notInCrm };
}
