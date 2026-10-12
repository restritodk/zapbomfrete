import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    assertRecipientMajorOrder,
    assessConsentButtonPlacement,
    expectedMessageTotal,
    extractApprovedQuickReplyButtons,
    planRecipientMajorSendOrder,
} from "./recipient-sequence";
import type { CampaignMessagePart } from "./bulletin/types";

const COTTON_COMPONENTS = [
    {
        type: "BODY",
        text: "Olá! Atualização de embarque Cotton.",
    },
    {
        type: "BUTTONS",
        buttons: [
            { type: "QUICK_REPLY", text: "Continuar recebendo ofertas" },
            { type: "QUICK_REPLY", text: "Não receber mais novidades" },
        ],
    },
];

const NO_BUTTONS = [{ type: "BODY", text: "Boletim sem botões {{1}}" }];

function part(
    index: number,
    name: string,
    components: unknown
): CampaignMessagePart {
    return {
        index,
        label: name,
        bodyText: "body",
        loadIndexes: [0],
        charCount: 4,
        templateName: name,
        templateLanguage: "pt_BR",
        templateCategory: "MARKETING",
        templateApprovalStatus: "APPROVED",
        templateComponents: components,
        readyForRealSend: true,
    };
}

describe("recipient-sequence — ordem destinatário × templates", () => {
    it("139 dest × 3 templates = 417 mensagens na ordem correta", () => {
        const recipientIds = Array.from(
            { length: 139 },
            (_, i) => `dest_${String(i + 1).padStart(3, "0")}`
        );
        const parts = [
            { index: 0, templateName: "atualizao_de_embarque_cotton" },
            { index: 1, templateName: "boletim_v3_3_cargas" },
            { index: 2, templateName: "boletim_v3_2_cargas" },
        ];
        assert.equal(expectedMessageTotal(139, 3), 417);

        const plan = planRecipientMajorSendOrder({ recipientIds, parts });
        assert.equal(plan.length, 417);
        assert.equal(assertRecipientMajorOrder(plan), true);

        // First recipient: T1 → T2 → T3
        assert.deepEqual(
            plan.slice(0, 3).map((s) => s.templateName),
            [
                "atualizao_de_embarque_cotton",
                "boletim_v3_3_cargas",
                "boletim_v3_2_cargas",
            ]
        );
        assert.equal(plan[0].recipientId, "dest_001");
        assert.equal(plan[1].recipientId, "dest_001");
        assert.equal(plan[2].recipientId, "dest_001");
        assert.equal(plan[3].recipientId, "dest_002");

        // Never template-major: T1 for all then T2…
        const first139Names = plan.slice(0, 139).map((s) => s.templateName);
        assert.notEqual(
            first139Names.every((n) => n === "atualizao_de_embarque_cotton"),
            true,
            "não deve enviar template 1 para todos antes do 2"
        );

        // After pause/resume simulation: resume from globalOrder 10 keeps order
        const resumed = plan.slice(10);
        assert.equal(assertRecipientMajorOrder(resumed), true);
        assert.equal(resumed[0].globalOrder, 10);
    });

    it("detecta embaralhamento (template-major / retorno a destinatário)", () => {
        const bad = [
            { recipientId: "a", partIndex: 0 },
            { recipientId: "b", partIndex: 0 },
            { recipientId: "a", partIndex: 1 },
        ];
        assert.equal(assertRecipientMajorOrder(bad), false);
    });
});

describe("recipient-sequence — botões aprovados Meta", () => {
    it("extrai QUICK_REPLY reais do cotton (não textos da Etapa 1)", () => {
        const buttons = extractApprovedQuickReplyButtons(COTTON_COMPONENTS);
        assert.equal(buttons.length, 2);
        assert.equal(buttons[0].text, "Continuar recebendo ofertas");
        assert.equal(buttons[1].text, "Não receber mais novidades");
        assert.notEqual(buttons[0].text, "Tenho interesse");
    });

    it("last_only bloqueado quando templates anteriores têm botões", () => {
        const parts = [
            part(0, "atualizao_de_embarque_cotton", COTTON_COMPONENTS),
            part(1, "boletim_v3_3_cargas", NO_BUTTONS),
            part(2, "boletim_v3_2_cargas", NO_BUTTONS),
        ];
        const a = assessConsentButtonPlacement({
            preference: "last_only",
            parts,
            consentConfigured: true,
            freeformModality: false,
        });
        assert.equal(a.templateLastOnlyPossible, false);
        assert.equal(a.effectivePlacement, "per_template_approved");
        assert.ok(a.warnings.length >= 1);
        assert.equal(a.buttonsByPart[0].length, 2);
        assert.equal(a.buttonsByPart[1].length, 0);
    });

    it("last_only possível quando só o último tem botões", () => {
        const parts = [
            part(0, "boletim_v3_3_cargas", NO_BUTTONS),
            part(1, "boletim_v3_2_cargas", NO_BUTTONS),
            part(2, "atualizao_de_embarque_cotton", COTTON_COMPONENTS),
        ];
        const a = assessConsentButtonPlacement({
            preference: "last_only",
            parts,
            consentConfigured: true,
            freeformModality: false,
        });
        assert.equal(a.templateLastOnlyPossible, true);
        assert.equal(a.effectivePlacement, "last_only");
        assert.equal(a.buttonsByPart[2].length, 2);
    });

    it("freeform last_only possível na janela 24h", () => {
        const parts = [
            part(0, "a", NO_BUTTONS),
            part(1, "b", NO_BUTTONS),
        ];
        const a = assessConsentButtonPlacement({
            preference: "last_only",
            parts,
            consentConfigured: true,
            freeformModality: true,
        });
        assert.equal(a.freeformLastOnlyPossible, true);
    });
});
