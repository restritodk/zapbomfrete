import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    assessBulletinLaunchIssues,
    createCampaignBodySchema,
    formatCreateCampaignZodError,
    mapSelectionSendMode,
    persistableBulletinVersionId,
    countNumberedPlaceholders,
} from "./create-payload";
import { orphanToBulletinPick, flattenBulletinSelections } from "./bulletin/selection";
import type { CampaignMessagePart } from "./bulletin/types";

function part(
    partial: Partial<CampaignMessagePart> & { templateName: string }
): CampaignMessagePart {
    return {
        index: 0,
        label: partial.templateName,
        bodyText: partial.bodyText || "Hello {{1}}",
        loadIndexes: [0],
        charCount: 20,
        templateLanguage: "pt_BR",
        templateCategory: "MARKETING",
        templateApprovalStatus: "APPROVED",
        readyForRealSend: true,
        compatibility: "ready",
        blockReason: null,
        ...partial,
    };
}

describe("create campaign payload contract", () => {
    it("accepts multi_bulletin and selected_cards send modes (3 orphan templates)", () => {
        const picks = [
            "atualizao_de_embarque_cotton",
            "boletim_v3_3_cargas",
            "boletim_v3_2_cargas",
        ].map((name, i) =>
            orphanToBulletinPick({
                id: `mt${i}`,
                technicalName: name,
                displayName: name,
                language: name.includes("cotton") ? "en" : "pt_BR",
                category: "MARKETING",
                loadsPerMessage: 2,
                bodyPreview: `body ${name} {{1}}`,
            })
        );
        const prepared = flattenBulletinSelections(picks);
        const mode = mapSelectionSendMode(prepared.meta.bulletinSendMode);
        assert.equal(mode, "multi_bulletin");

        const body = {
            name: "Disparo 01",
            purpose: "utility" as const,
            contentKind: "bulletin" as const,
            contentSource: "bulletin_parts",
            templateName: prepared.parts[0].templateName,
            templateLanguage: prepared.parts[0].templateLanguage,
            templateCategory: "MARKETING",
            templateApprovalStatus: "APPROVED",
            messageBody: prepared.parts[0].bodyText,
            messageParts: prepared.parts,
            bulletinMeta: prepared.meta,
            bulletinVersionId: persistableBulletinVersionId(
                prepared.meta.primaryVersionId
            ),
            bulletinSendMode: mode,
            segmentFilter: { source: "import" as const, phones: ["5541999999999", "5541888888888"] },
            dryRun: true,
            delayMs: 10_000,
            interactiveButtons: { enabled: false },
            variableMapping: { body: [] },
        };
        const parsed = createCampaignBodySchema.safeParse(body);
        if (!parsed.success) {
            assert.fail(formatCreateCampaignZodError(parsed.error));
        }
        assert.equal(body.bulletinVersionId, null);
    });

    it("rejects unknown bulletinSendMode with field-specific message", () => {
        const parsed = createCampaignBodySchema.safeParse({
            name: "x",
            bulletinSendMode: "split_templates",
        });
        assert.equal(parsed.success, false);
        if (!parsed.success) {
            const msg = formatCreateCampaignZodError(parsed.error);
            assert.match(msg, /bulletinSendMode/i);
            assert.notEqual(msg, "Payload inválido");
        }
    });

    it("nulls orphan bulletinVersionId for FK safety", () => {
        assert.equal(persistableBulletinVersionId("orphan:abc"), null);
        assert.equal(persistableBulletinVersionId("cuid_real_version"), "cuid_real_version");
    });

    it("flags utility + MARKETING as attention unless confirmed", () => {
        const parts = [
            part({
                templateName: "boletim_v3_2_cargas",
                bodyText: "static ok",
                templateCategory: "MARKETING",
            }),
        ];
        const a = assessBulletinLaunchIssues({
            purpose: "utility",
            parts,
            dryRun: true,
            confirmMarketingWithUtilityPurpose: false,
        });
        assert.equal(a.status, "attention");
        assert.ok(
            a.issues.some((i) => i.code === "purpose_category_mismatch")
        );
        const b = assessBulletinLaunchIssues({
            purpose: "utility",
            parts,
            dryRun: true,
            confirmMarketingWithUtilityPurpose: true,
        });
        assert.equal(b.status, "ready");
    });

    it("blocks real send when numbered placeholders lack mapping", () => {
        const parts = [
            part({
                templateName: "boletim_v3_3_cargas",
                bodyText: "A {{1}} B {{2}}",
                templateLanguage: "pt_BR",
            }),
        ];
        assert.equal(countNumberedPlaceholders(parts[0].bodyText), 2);
        const real = assessBulletinLaunchIssues({
            purpose: "utility",
            parts,
            dryRun: false,
            confirmMarketingWithUtilityPurpose: true,
        });
        assert.equal(real.ok, false);
        assert.ok(
            real.issues.some((i) => i.code === "param_mismatch_132000")
        );
        const sim = assessBulletinLaunchIssues({
            purpose: "utility",
            parts,
            dryRun: true,
            confirmMarketingWithUtilityPurpose: true,
        });
        assert.equal(sim.ok, true);
        assert.equal(sim.status, "attention");
    });

    it("preserves mixed languages without coercion", () => {
        const parts = [
            part({
                index: 0,
                templateName: "atualizao_de_embarque_cotton",
                bodyText: "Hello",
                templateLanguage: "en",
            }),
            part({
                index: 1,
                templateName: "boletim_v3_2_cargas",
                bodyText: "Oi",
                templateLanguage: "pt_BR",
            }),
        ];
        const r = assessBulletinLaunchIssues({
            purpose: "utility",
            parts,
            dryRun: true,
            confirmMarketingWithUtilityPurpose: true,
        });
        assert.ok(r.issues.some((i) => i.code === "mixed_languages"));
        assert.equal(parts[0].templateLanguage, "en");
        assert.equal(parts[1].templateLanguage, "pt_BR");
    });
});
