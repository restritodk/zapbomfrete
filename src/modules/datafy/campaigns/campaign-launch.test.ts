import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    assertDelayPresetSupported,
    canEnableStartDispatchButton,
    delayMsFromWizardSeconds,
    evaluateDirectLaunchScenario,
    isApprovedTemplateStatus,
    pickFallbackApprovedTemplate,
    resolveWizardHasApprovedTemplate,
    templateKeyOf,
} from "./campaign-launch";
import { DELAY_PRESETS_SEC } from "./pacing";
import { brazilianWaIdVariants } from "@/modules/datafy/chat/window";
import { resolveRecipientSendMode } from "./send-readiness";

describe("Iniciar disparo — Utilidade / Transacional", () => {
    it("utility + texto livre com janela fechada não habilita envio real", () => {
        const s = evaluateDirectLaunchScenario({
            purpose: "utility",
            importedCount: 139,
            eligibleCount: 139,
            openWindowCount: 0,
            hasFreeformBody: true,
            hasApprovedTemplate: false,
            delaySeconds: 10,
        });
        assert.equal(s.audiencePreserved, true);
        assert.equal(s.intervalOk, true);
        assert.equal(s.buttonEnabled, false);
        assert.equal(s.technicallySendableCount, 0);
        assert.equal(s.needsTemplateCount, 139);
    });

    it("transactional + texto livre com 0 janelas não é envio real", () => {
        const s = evaluateDirectLaunchScenario({
            purpose: "transactional",
            importedCount: 139,
            eligibleCount: 139,
            openWindowCount: 0,
            hasFreeformBody: true,
            hasApprovedTemplate: false,
            delaySeconds: 15,
        });
        assert.equal(s.buttonEnabled, false);
        assert.equal(s.technicallySendableCount, 0);
    });

    it("utility sem texto mantém botão desabilitado", () => {
        const s = evaluateDirectLaunchScenario({
            purpose: "utility",
            importedCount: 139,
            eligibleCount: 139,
            openWindowCount: 0,
            hasFreeformBody: false,
            hasApprovedTemplate: false,
            delaySeconds: 5,
        });
        assert.equal(s.buttonEnabled, false);
        assert.equal(s.technicallySendableCount, 0);
    });

    it("presets de intervalo 3–60s são aceitos e viram delayMs", () => {
        for (const sec of DELAY_PRESETS_SEC) {
            assert.equal(assertDelayPresetSupported(sec), true);
            assert.equal(delayMsFromWizardSeconds(sec), sec * 1000);
        }
        assert.equal(assertDelayPresetSupported(7), false);
        assert.equal(delayMsFromWizardSeconds(2), null);
    });

    it("canEnableStartDispatchButton bloqueia saving / simulação / 0 técnicos", () => {
        assert.equal(
            canEnableStartDispatchButton({
                saving: true,
                simulationOnlyAudience: false,
                realSendReady: true,
                technicallySendableCount: 10,
            }),
            false
        );
        assert.equal(
            canEnableStartDispatchButton({
                saving: false,
                simulationOnlyAudience: true,
                realSendReady: true,
                technicallySendableCount: 10,
            }),
            false
        );
        assert.equal(
            canEnableStartDispatchButton({
                saving: false,
                simulationOnlyAudience: false,
                realSendReady: true,
                technicallySendableCount: 0,
            }),
            false
        );
        assert.equal(
            canEnableStartDispatchButton({
                saving: false,
                simulationOnlyAudience: false,
                realSendReady: true,
                technicallySendableCount: 12,
            }),
            true
        );
    });

    it("status APPROVED é case-insensitive no wizard", () => {
        assert.equal(isApprovedTemplateStatus("APPROVED"), true);
        assert.equal(isApprovedTemplateStatus("approved"), true);
        assert.equal(
            resolveWizardHasApprovedTemplate({
                contentKind: "message",
                contentMode: "direct",
                selectedTemplate: {
                    name: "aviso",
                    language: "pt_BR",
                    status: "approved",
                },
            }),
            true
        );
    });

    it("pickFallbackApprovedTemplate prioriza categoria da finalidade", () => {
        const staticBody = {
            components: [{ type: "BODY", text: "Olá, mensagem estática." }],
        };
        const pick = pickFallbackApprovedTemplate(
            [
                {
                    name: "mkt",
                    language: "pt_BR",
                    status: "APPROVED",
                    category: "MARKETING",
                    ...staticBody,
                },
                {
                    name: "util",
                    language: "pt_BR",
                    status: "APPROVED",
                    category: "UTILITY",
                    ...staticBody,
                },
            ],
            "utility"
        );
        assert.equal(pick?.name, "util");
        assert.equal(templateKeyOf(pick!), "util::pt_BR");
    });

    it("pickFallback rejeita boletim multi-variável (evita Meta #132000)", () => {
        const pick = pickFallbackApprovedTemplate(
            [
                {
                    name: "boletim_v3_3_cargas",
                    language: "pt_BR",
                    status: "APPROVED",
                    category: "MARKETING",
                    components: [
                        {
                            type: "BODY",
                            text: "Origem {{1}} Destino {{2}} Frete {{3}}",
                        },
                    ],
                },
            ],
            "utility",
            { variableMapping: { body: ["fullName"] } }
        );
        assert.equal(pick, null);
    });

    it("variantes BR com/sem 9º dígito batem na mesma janela", () => {
        const withNine = "5511999887766";
        const withoutNine = "551199887766";
        assert.deepEqual(
            new Set(brazilianWaIdVariants(withNine)),
            new Set([withNine, withoutNine])
        );
    });

    it("fila não trata texto livre sem janela como envio real", () => {
        assert.equal(
            resolveRecipientSendMode({
                hasApprovedTemplate: false,
                purposeAllowsFreeform: true,
                hasFreeformBody: true,
                windowOpen: false,
            }),
            "skip_no_window"
        );
    });

    it("prevenção de disparo duplicado: saving desabilita o botão", () => {
        assert.equal(
            canEnableStartDispatchButton({
                saving: true,
                simulationOnlyAudience: false,
                realSendReady: true,
                technicallySendableCount: 50,
            }),
            false
        );
    });
});
