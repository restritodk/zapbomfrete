import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    categoryForNewTemplateSubmit,
    detectPurposeCategoryMismatch,
    expectedBillingCategory,
    normalizeMetaCategory,
    purposeLabelPt,
    summarizeTemplateCategories,
} from "./purpose-category";

describe("purpose vs Meta category", () => {
    it("Finalidade Utility + template MARKETING → mismatch warning", () => {
        const m = detectPurposeCategoryMismatch({
            purpose: "utility",
            templateCategories: ["MARKETING"],
        });
        assert.equal(m.mismatch, true);
        assert.ok(m.message?.includes("Utilidade"));
        assert.ok(m.message?.includes("Marketing"));
        assert.ok(m.message?.includes("não será convertido"));
    });

    it("Finalidade Marketing + template MARKETING → no mismatch", () => {
        const m = detectPurposeCategoryMismatch({
            purpose: "marketing",
            templateCategories: ["MARKETING"],
        });
        assert.equal(m.mismatch, false);
        assert.equal(m.message, null);
    });

    it("template Utility aprovado com finalidade utility → no mismatch", () => {
        const m = detectPurposeCategoryMismatch({
            purpose: "utility",
            templateCategories: ["UTILITY"],
        });
        assert.equal(m.mismatch, false);
    });

    it("unknown category → billing Não confirmado", () => {
        const b = expectedBillingCategory(null);
        assert.equal(b.confirmed, false);
        assert.equal(b.label, "Não confirmado");
        assert.equal(normalizeMetaCategory("???"), "UNKNOWN");
    });

    it("múltiplos templates com categorias diferentes", () => {
        const m = detectPurposeCategoryMismatch({
            purpose: "utility",
            templateCategories: ["UTILITY", "MARKETING"],
        });
        assert.equal(m.mismatch, true);
        const summary = summarizeTemplateCategories([
            {
                templateName: "boletim_v3_3_cargas",
                templateCategory: "MARKETING",
                templateApprovalStatus: "APPROVED",
            },
            {
                templateName: "util_aviso",
                templateCategory: "UTILITY",
                templateApprovalStatus: "APPROVED",
            },
        ]);
        assert.equal(summary[0].category, "MARKETING");
        assert.equal(summary[0].billingLabel, "Marketing");
        assert.equal(summary[1].category, "UTILITY");
    });

    it("never maps purpose utility → UTILITY for new template submit", () => {
        assert.equal(
            categoryForNewTemplateSubmit({ purpose: "utility" }),
            "MARKETING"
        );
        assert.equal(
            categoryForNewTemplateSubmit({
                purpose: "utility",
                explicitCategory: "UTILITY",
            }),
            "UTILITY"
        );
        assert.equal(
            categoryForNewTemplateSubmit({
                purpose: "marketing",
                explicitCategory: "MARKETING",
            }),
            "MARKETING"
        );
    });

    it("purpose labels in PT", () => {
        assert.equal(purposeLabelPt("utility"), "Utilidade");
        assert.equal(purposeLabelPt("marketing"), "Marketing");
    });
});
