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
    shouldAutoPickFallbackTemplate,
    templateKeyOf,
} from "./campaign-launch";
import { DELAY_PRESETS_SEC } from "./pacing";
import { brazilianWaIdVariants } from "@/modules/datafy/chat/window";

describe("Iniciar disparo — Utilidade / Transacional", () => {
    it("utility + 139 importados + janelas parciais habilita o botão", () => {
        const s = evaluateDirectLaunchScenario({
            purpose: "utility",
            importedCount: 139,
            eligibleCount: 139,
            openWindowCount: 40,
            hasFreeformBody: true,
            hasApprovedTemplate: false,
            delaySeconds: 10,
        });
        assert.equal(s.audiencePreserved, true);
        assert.equal(s.intervalOk, true);
        assert.equal(s.buttonEnabled, true);
        assert.equal(s.technicallySendableCount, 40);
        assert.equal(s.needsTemplateCount, 99);
        assert.equal(s.modality, "service_window");
    });

    it("transactional + template APPROVED habilita mesmo com 0 janelas", () => {
        const s = evaluateDirectLaunchScenario({
            purpose: "transactional",
            importedCount: 139,
            eligibleCount: 139,
            openWindowCount: 0,
            hasFreeformBody: true,
            hasApprovedTemplate: true,
            delaySeconds: 15,
        });
        assert.equal(s.buttonEnabled, true);
        assert.equal(s.technicallySendableCount, 139);
        assert.equal(s.modality, "template_approved");
    });

    it("utility sem janela e sem template mantém botão desabilitado", () => {
        const s = evaluateDirectLaunchScenario({
            purpose: "utility",
            importedCount: 139,
            eligibleCount: 139,
            openWindowCount: 0,
            hasFreeformBody: true,
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
        assert.equal(isApprovedTemplateStatus("Approved"), true);
        assert.equal(isApprovedTemplateStatus("PENDING"), false);
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

    it("auto-pick fallback só quando Envio Direto sem janela e sem templateKey", () => {
        assert.equal(
            shouldAutoPickFallbackTemplate({
                purpose: "utility",
                contentMode: "direct",
                contentKind: "message",
                eligibleCount: 139,
                openWindowCount: 0,
                templateKey: "",
            }),
            true
        );
        assert.equal(
            shouldAutoPickFallbackTemplate({
                purpose: "utility",
                contentMode: "direct",
                contentKind: "message",
                eligibleCount: 139,
                openWindowCount: 10,
                templateKey: "",
            }),
            false
        );
        assert.equal(
            shouldAutoPickFallbackTemplate({
                purpose: "marketing",
                contentMode: "direct",
                contentKind: "message",
                eligibleCount: 139,
                openWindowCount: 0,
                templateKey: "",
            }),
            false
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
        assert.deepEqual(
            new Set(brazilianWaIdVariants(withoutNine)),
            new Set([withNine, withoutNine])
        );
    });

    it("create+start contract: botão ligado implica create/start reais (não simulação)", () => {
        const ready = evaluateDirectLaunchScenario({
            purpose: "utility",
            importedCount: 139,
            eligibleCount: 139,
            openWindowCount: 20,
            hasFreeformBody: true,
            hasApprovedTemplate: false,
            delaySeconds: 30,
        });
        assert.equal(ready.buttonEnabled, true);
        // Worker path: only technicallySendableCount are freeform; rest need template/skip
        assert.equal(ready.technicallySendableCount, 20);
        assert.equal(ready.needsTemplateCount, 119);
    });

    it("falhas de envio não fabricam sucesso: skip_no_window conta como não enviado", () => {
        const blocked = evaluateDirectLaunchScenario({
            purpose: "utility",
            importedCount: 139,
            eligibleCount: 139,
            openWindowCount: 0,
            hasFreeformBody: true,
            hasApprovedTemplate: false,
            delaySeconds: 10,
        });
        assert.equal(blocked.buttonEnabled, false);
        assert.equal(blocked.technicallySendableCount, 0);
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
