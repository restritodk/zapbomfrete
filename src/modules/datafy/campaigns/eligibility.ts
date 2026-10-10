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

/**
 * Marketing campaigns require explicit consent (granted).
 * Utility/transactional still respect opt-out and inactive.
 * Import never implies consent.
 */
export function evaluateEligibility(
    contact: EligibilityContact,
    opts: { purpose: CampaignPurpose | string; requireConsent: boolean }
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
            return "Opt-out / descadastro";
        case "denied":
            return "Consentimento negado";
        case "missing_consent":
            return "Sem consentimento para campanhas";
        case "duplicate":
            return "Número duplicado na campanha";
        default:
            return reason || "Excluído";
    }
}
