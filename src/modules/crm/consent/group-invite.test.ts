import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    defaultCampaignConsentButtons,
    getEnabledUrlButton,
    parseCampaignConsentButtons,
    toInteractiveSendButtons,
    toPreviewButtons,
    validateCampaignConsentButtons,
} from "./campaign-buttons";
import { validateWhatsappGroupInviteUrl } from "./group-invite-url";
import {
    signGroupInviteToken,
    verifyGroupInviteToken,
} from "@/modules/crm/group-invite/tracking";
import { classifyConsentReply } from "./classify";
import { CONSENT_BUTTON_IDS } from "./constants";
import {
    extractApprovedQuickReplyButtons,
    extractApprovedUrlButtons,
    assessConsentButtonPlacement,
} from "@/modules/datafy/campaigns/recipient-sequence";
import type { CampaignMessagePart } from "@/modules/datafy/campaigns/bulletin/types";

describe("group invite URL validation", () => {
    it("accepts official https chat.whatsapp.com invites", () => {
        const v = validateWhatsappGroupInviteUrl(
            "https://chat.whatsapp.com/AbCdEfGhIjKlMnOp"
        );
        assert.equal(v.ok, true);
        if (v.ok) {
            assert.equal(
                v.normalized,
                "https://chat.whatsapp.com/AbCdEfGhIjKlMnOp"
            );
        }
    });

    it("rejects http, wrong host, and malformed", () => {
        assert.equal(
            validateWhatsappGroupInviteUrl(
                "http://chat.whatsapp.com/AbCdEfGhIjKlMnOp"
            ).ok,
            false
        );
        assert.equal(
            validateWhatsappGroupInviteUrl(
                "https://evil.com/chat.whatsapp.com/x"
            ).ok,
            false
        );
        assert.equal(validateWhatsappGroupInviteUrl("not-a-url").ok, false);
        assert.equal(
            validateWhatsappGroupInviteUrl("https://chat.whatsapp.com/").ok,
            false
        );
    });
});

describe("campaign urlButton — terceiro botão", () => {
    it("ativa e desativa o botão de link", () => {
        const off = parseCampaignConsentButtons({
            enabled: true,
            buttons: [
                { id: "consent_yes", title: "Tenho interesse" },
                { id: "consent_no", title: "Não tenho interesse" },
            ],
            urlButton: {
                enabled: false,
                title: "Entrar no grupo exclusivo",
                url: "https://chat.whatsapp.com/AbCdEfGhIjKlMnOp",
            },
        });
        assert.equal(getEnabledUrlButton(off), null);

        const on = parseCampaignConsentButtons({
            enabled: true,
            buttons: [
                { id: "consent_yes", title: "Tenho interesse" },
                { id: "consent_no", title: "Não tenho interesse" },
            ],
            urlButton: {
                enabled: true,
                title: "Entrar no grupo exclusivo",
                url: "https://chat.whatsapp.com/AbCdEfGhIjKlMnOp",
            },
        });
        const ub = getEnabledUrlButton(on);
        assert.ok(ub);
        assert.equal(ub!.title, "Entrar no grupo exclusivo");
        assert.ok(ub!.url.includes("chat.whatsapp.com"));
    });

    it("prévia mostra 3 botões (2 reply + 1 url)", () => {
        const cfg = parseCampaignConsentButtons({
            enabled: true,
            buttons: [
                { id: "consent_yes", title: "Tenho interesse" },
                { id: "consent_no", title: "Não tenho interesse" },
            ],
            urlButton: {
                enabled: true,
                title: "Entrar no grupo exclusivo",
                url: "https://chat.whatsapp.com/AbCdEfGhIjKlMnOp",
            },
        });
        const preview = toPreviewButtons(cfg);
        assert.equal(preview.length, 3);
        assert.equal(preview[2].kind, "url");
        const replies = toInteractiveSendButtons(cfg);
        assert.equal(replies.length, 2);
        assert.ok(!replies.some((b) => b.id === CONSENT_BUTTON_IDS.GROUP_INVITE));
    });

    it("valida URL ao habilitar urlButton", () => {
        const bad = defaultCampaignConsentButtons();
        bad.enabled = true;
        bad.urlButton = {
            enabled: true,
            title: "Entrar no grupo exclusivo",
            url: "https://example.com/x",
        };
        const v = validateCampaignConsentButtons(bad);
        assert.equal(v.ok, false);
    });

    it("preenche default da organização no parse", () => {
        const cfg = parseCampaignConsentButtons(
            { enabled: false },
            "https://chat.whatsapp.com/OrgDefaultInviteXX"
        );
        assert.equal(
            cfg.urlButton?.url,
            "https://chat.whatsapp.com/OrgDefaultInviteXX"
        );
    });
});

describe("tracking token + org isolation", () => {
    it("assina e verifica token; org keys não se misturam no payload", () => {
        const tA = signGroupInviteToken({
            organizationKey: "org_a",
            waId: "5511999999999",
            inviteUrl: "https://chat.whatsapp.com/AbCdEfGhIjKlMnOp",
            campaignId: "camp1",
        });
        const tB = signGroupInviteToken({
            organizationKey: "org_b",
            waId: "5511888888888",
            inviteUrl: "https://chat.whatsapp.com/XyZ1234567890abc",
        });
        const a = verifyGroupInviteToken(tA);
        const b = verifyGroupInviteToken(tB);
        assert.equal(a.ok, true);
        assert.equal(b.ok, true);
        if (a.ok && b.ok) {
            assert.equal(a.payload.organizationKey, "org_a");
            assert.equal(b.payload.organizationKey, "org_b");
            assert.notEqual(a.payload.waId, b.payload.waId);
        }
        assert.equal(verifyGroupInviteToken(tA + "x").ok, false);
    });
});

describe("templates APPROVED — CTA URL vs sem CTA", () => {
    it("extrai URL CTA aprovado sem alterar texto", () => {
        const components = [
            { type: "BODY", text: "Olá" },
            {
                type: "BUTTONS",
                buttons: [
                    { type: "QUICK_REPLY", text: "Tenho interesse" },
                    { type: "QUICK_REPLY", text: "Não tenho interesse" },
                    {
                        type: "URL",
                        text: "Entrar no grupo exclusivo",
                        url: "https://chat.whatsapp.com/ApprovedCode123",
                    },
                ],
            },
        ];
        const qr = extractApprovedQuickReplyButtons(components);
        const url = extractApprovedUrlButtons(components);
        assert.equal(qr.length, 2);
        assert.equal(url.length, 1);
        assert.equal(url[0].text, "Entrar no grupo exclusivo");
        assert.ok(url[0].url.includes("chat.whatsapp.com"));
    });

    it("template sem CTA URL retorna lista vazia", () => {
        const components = [
            {
                type: "BUTTONS",
                buttons: [{ type: "QUICK_REPLY", text: "Ok" }],
            },
        ];
        assert.equal(extractApprovedUrlButtons(components).length, 0);
    });
});

describe("consentimento automático + 24h", () => {
    it("registra grant/deny por QUICK_REPLY; group_invite não altera consent", () => {
        assert.equal(
            classifyConsentReply({ buttonId: "consent_yes" }).kind,
            "grant"
        );
        assert.equal(
            classifyConsentReply({ buttonId: "consent_no" }).kind,
            "deny"
        );
        assert.equal(
            classifyConsentReply({
                buttonId: CONSENT_BUTTON_IDS.GROUP_INVITE,
            }).kind,
            "none"
        );
    });
});

describe("multi-template last_only + url button preference", () => {
    it("last_only possível quando só o último tem botões aprovados", () => {
        const part = (
            index: number,
            name: string,
            components: unknown
        ): CampaignMessagePart => ({
            index,
            label: name,
            bodyText: "x",
            loadIndexes: [0],
            charCount: 1,
            templateName: name,
            templateComponents: components,
            templateApprovalStatus: "APPROVED",
            readyForRealSend: true,
        });
        const parts = [
            part(0, "t1", [{ type: "BODY", text: "a" }]),
            part(1, "t2", [{ type: "BODY", text: "b" }]),
            part(2, "t3", [
                {
                    type: "BUTTONS",
                    buttons: [
                        { type: "QUICK_REPLY", text: "Tenho interesse" },
                        {
                            type: "URL",
                            text: "Entrar no grupo exclusivo",
                            url: "https://chat.whatsapp.com/FinalInviteCode1",
                        },
                    ],
                },
            ]),
        ];
        const a = assessConsentButtonPlacement({
            preference: "last_only",
            parts,
            consentConfigured: true,
            freeformModality: false,
        });
        assert.equal(a.templateLastOnlyPossible, true);
        assert.equal(extractApprovedUrlButtons(parts[2].templateComponents).length, 1);
    });
});
