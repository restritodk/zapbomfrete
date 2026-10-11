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
    it("utility + 139 importados + texto livre habilita o botão sem janela", () => {
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
        assert.equal(s.buttonEnabled, true);
        assert.equal(s.technicallySendableCount, 139);
        assert.equal(s.needsTemplateCount, 0);
        assert.equal(s.modality, "service_window");
    });

    it("transactional + texto livre habilita mesmo com 0 janelas", () => {
        const s = evaluateDirectLaunchScenario({
            purpose: "transactional",
            importedCount: 139,
            eligibleCount: 139,
            openWindowCount: 0,
            hasFreeformBody: true,
            hasApprovedTemplate: false,
            delaySeconds: 15,
        });
        assert.equal(s.buttonEnabled, true);
        assert.equal(s.technicallySendableCount, 139);
        assert.equal(s.modality, "service_window");
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
        const pick = pickFallbackApprovedTemplate(
            [
                {
                    name: "mkt",
                    language: "pt_BR",
                    status: "APPROVED",
                    category: "MARKETING",
                },
                {
                    name: "util",
                    language: "pt_BR",
                    status: "APPROVED",
                    category: "UTILITY",
                },
            ],
            "utility"
        );
        assert.equal(pick?.name, "util");
        assert.equal(templateKeyOf(pick!), "util::pt_BR");
    });

    it("variantes BR com/sem 9º dígito batem na mesma janela", () => {
        const withNine = "5511999887766";
        const withoutNine = "551199887766";
        assert.deepEqual(
            new Set(brazilianWaIdVariants(withNine)),
            new Set([withNine, withoutNine])
        );
    });

    it("fila envia freeform para utilidade mesmo sem janela aberta", () => {
        assert.equal(
            resolveRecipientSendMode({
                hasApprovedTemplate: false,
                purposeAllowsFreeform: true,
                hasFreeformBody: true,
                windowOpen: false,
            }),
            "freeform"
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
