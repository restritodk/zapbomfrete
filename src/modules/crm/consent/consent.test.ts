import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyConsentReply, normalizeConsentText } from "./classify";
import {
    buildButtonsComponent,
    defaultConsentButtonsConfig,
    validateButtonsConfig,
} from "./buttons";
import {
    CONSENT_BUTTON_IDS,
    CONSENT_DECISION,
    META_QUICK_REPLY_TEXT_MAX,
    decisionToCrmStatus,
} from "./constants";
import { canManageConsents, canViewConsents } from "./access";
import {
    evaluateEligibility,
    summarizeConsentAudience,
} from "@/modules/datafy/campaigns/eligibility";
import { buildTemplateCreatePayload } from "@/modules/datafy/campaigns/bulletin/template-submit-payload";
import {
    META_BODY_CLOSING_STATIC,
    BULLETIN_TEMPLATE_LIBRARY,
    buildBulletinTemplateSubmission,
} from "@/modules/datafy/campaigns/bulletin/library";

describe("Phase 9 — consent classification", () => {
    it("grants on consent button id", () => {
        const r = classifyConsentReply({
            buttonId: CONSENT_BUTTON_IDS.GRANT,
            previousStatus: "unknown",
        });
        assert.equal(r.kind, "grant");
        if (r.kind !== "none") {
            assert.equal(r.decision, CONSENT_DECISION.GRANTED);
        }
    });

    it("denies on negative button when never granted", () => {
        const r = classifyConsentReply({
            buttonId: CONSENT_BUTTON_IDS.DENY,
            previousStatus: "unknown",
        });
        assert.equal(r.kind, "deny");
        if (r.kind !== "none") {
            assert.equal(r.decision, CONSENT_DECISION.DENIED);
        }
    });

    it("revokes when previous was granted", () => {
        const r = classifyConsentReply({
            buttonTitle: "Não quero receber",
            previousStatus: "granted",
        });
        assert.equal(r.kind, "revoke");
        if (r.kind !== "none") {
            assert.equal(r.decision, CONSENT_DECISION.REVOKED);
        }
    });

    it("keyword PARAR opts out; ambiguous text does not grant", () => {
        const stop = classifyConsentReply({
            textBody: "PARAR",
            previousStatus: "granted",
        });
        assert.equal(stop.kind, "revoke");
        const amb = classifyConsentReply({
            textBody: "talvez depois",
            previousStatus: "unknown",
        });
        assert.equal(amb.kind, "none");
        const yesTxt = classifyConsentReply({
            textBody: "sim quero",
            previousStatus: "unknown",
        });
        assert.equal(yesTxt.kind, "none");
    });

    it("normalizes accents for matching", () => {
        assert.equal(
            normalizeConsentText("Não quero receber"),
            "NAO QUERO RECEBER"
        );
    });
});

describe("Phase 9 — Meta BUTTONS payload", () => {
    it("builds QUICK_REPLY BUTTONS within Meta limits", () => {
        const cfg = defaultConsentButtonsConfig();
        const v = validateButtonsConfig(cfg);
        assert.equal(v.ok, true);
        for (const b of cfg.buttons) {
            assert.ok(b.text.length <= META_QUICK_REPLY_TEXT_MAX);
        }
        const comp = buildButtonsComponent(cfg);
        assert.ok(comp);
        assert.equal(comp!.type, "BUTTONS");
        assert.equal((comp!.buttons as unknown[]).length, 2);
    });

    it("rejects overlong button text", () => {
        const v = validateButtonsConfig({
            enabled: true,
            purpose: "consent_offers",
            buttons: [
                {
                    type: "QUICK_REPLY",
                    text: "x".repeat(META_QUICK_REPLY_TEXT_MAX + 1),
                    payload: "x",
                },
            ],
        });
        assert.equal(v.ok, false);
    });

    it("template without buttons keeps BODY only", () => {
        const built = buildTemplateCreatePayload({
            name: "aviso_sem_botoes",
            category: "MARKETING",
            bodyText: "Ola {{1}}, obrigado pelo contato.",
            exampleRow: ["Maria"],
        });
        assert.equal(built.ok, true);
        if (!built.ok) return;
        assert.equal(built.payload.components.length, 1);
        assert.equal(built.payload.components[0].type, "BODY");
    });

    it("template with consent buttons includes BUTTONS component", () => {
        const built = buildTemplateCreatePayload({
            name: "consentimento_ofertas",
            category: "MARKETING",
            bodyText:
                "*Ofertas de frete*\n\nVocê autoriza receber ofertas pelo WhatsApp?\n\nConfirme abaixo.",
            exampleRow: [],
            buttons: defaultConsentButtonsConfig(),
        });
        assert.equal(built.ok, true);
        if (!built.ok) return;
        assert.equal(built.payload.components.length, 2);
        assert.equal(built.payload.components[1].type, "BUTTONS");
    });
});

describe("Phase 9 — CRM status mapping & RBAC", () => {
    it("maps decisions to CRM statuses", () => {
        assert.equal(decisionToCrmStatus("GRANTED"), "granted");
        assert.equal(decisionToCrmStatus("DENIED"), "denied");
        assert.equal(decisionToCrmStatus("REVOKED"), "opted_out");
        assert.equal(decisionToCrmStatus("UNKNOWN"), "unknown");
    });

    it("OWNER and SUPERADMIN manage; STAFF view; USER blocked", () => {
        assert.equal(canManageConsents("OWNER"), true);
        assert.equal(canManageConsents("SUPERADMIN"), true);
        assert.equal(canManageConsents("STAFF"), false);
        assert.equal(canViewConsents("STAFF"), true);
        assert.equal(canViewConsents("USER"), false);
    });
});

describe("Phase 9 — audience consent summary & eligibility", () => {
    it("summarizes granted / missing / revoked / not_in_crm", () => {
        const s = summarizeConsentAudience([
            {
                id: "1",
                waId: "5511999990001",
                fullName: "A",
                company: null,
                city: null,
                state: null,
                category: null,
                origin: "manual",
                active: true,
                consentStatus: "granted",
            },
            {
                id: "2",
                waId: "5511999990002",
                fullName: "B",
                company: null,
                city: null,
                state: null,
                category: null,
                origin: "import",
                active: true,
                consentStatus: "unknown",
            },
            {
                id: "3",
                waId: "5511999990003",
                fullName: "C",
                company: null,
                city: null,
                state: null,
                category: null,
                origin: "import",
                active: true,
                consentStatus: "opted_out",
            },
            {
                id: "synth:5511999990004",
                waId: "5511999990004",
                fullName: null,
                company: null,
                city: null,
                state: null,
                category: null,
                origin: "import",
                active: true,
                consentStatus: "unknown",
            },
        ]);
        assert.equal(s.granted, 1);
        assert.equal(s.missingConsent, 1);
        assert.equal(s.deniedOrRevoked, 1);
        assert.equal(s.notInCrm, 1);
        assert.equal(s.inCrm, 3);
    });

    it("blocks opted_out and denied from marketing send", () => {
        const base = {
            id: "c1",
            waId: "5511987654321",
            fullName: "X",
            company: null,
            city: null,
            state: null,
            category: null,
            origin: "manual",
            active: true,
            consentStatus: "granted",
        };
        assert.equal(
            evaluateEligibility(
                { ...base, consentStatus: "opted_out" },
                { purpose: "marketing", requireConsent: true }
            ).ok,
            false
        );
        assert.equal(
            evaluateEligibility(
                { ...base, consentStatus: "denied" },
                { purpose: "marketing", requireConsent: true }
            ).ok,
            false
        );
        assert.equal(
            evaluateEligibility(base, {
                purpose: "marketing",
                requireConsent: true,
            }).ok,
            true
        );
    });
});

describe("Phase 9 — regression Meta 2388293 / 2388299", () => {
    it("v3 bodies still have closing static and valid payloads", () => {
        for (const spec of BULLETIN_TEMPLATE_LIBRARY.filter(
            (s) => s.generation === 3
        )) {
            const sub = buildBulletinTemplateSubmission(spec);
            assert.ok(sub.bodyText.includes(META_BODY_CLOSING_STATIC));
            const built = buildTemplateCreatePayload({
                name: sub.name,
                category: "MARKETING",
                bodyText: sub.bodyText,
                exampleRow: sub.exampleRow,
            });
            assert.equal(built.ok, true, spec.preferredName);
            if (!built.ok) continue;
            const body = String(built.payload.components[0].text || "");
            assert.ok(!/\{\{\d+\}\}[.!?]*\s*$/.test(body.trim()) || body.includes("Confirme"));
            assert.ok(body.length <= 1024);
        }
    });
});
