import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    bulkGrantSkipReason,
    validateBulkGrantEvidence,
} from "./grant-evidence";
import { evaluateEligibility } from "@/modules/datafy/campaigns/eligibility";

describe("validateBulkGrantEvidence", () => {
    it("rejects empty selection-only grant (no evidence)", () => {
        const r = validateBulkGrantEvidence({});
        assert.equal(r.ok, false);
    });

    it("rejects short evidence", () => {
        const r = validateBulkGrantEvidence({
            evidenceText: "curto",
            authorizedAt: new Date().toISOString(),
            consentSource: "manual_evidence",
            purpose: "marketing_offers",
        });
        assert.equal(r.ok, false);
    });

    it("accepts valid evidence package", () => {
        const r = validateBulkGrantEvidence({
            evidenceText: "Contrato assinado #12345 — arquivo CRM",
            authorizedAt: "2026-01-15T12:00:00.000Z",
            consentSource: "manual_evidence",
            purpose: "marketing_offers",
            wabaId: "waba_test",
            originLabel: "Contrato",
        });
        assert.equal(r.ok, true);
        if (r.ok) {
            assert.equal(r.purpose, "marketing_offers");
            assert.ok(r.evidenceText.includes("12345"));
        }
    });

    it("rejects future authorization date", () => {
        const future = new Date(Date.now() + 86_400_000).toISOString();
        const r = validateBulkGrantEvidence({
            evidenceText: "Evidência válida com referência",
            authorizedAt: future,
            consentSource: "manual_evidence",
        });
        assert.equal(r.ok, false);
    });
});

describe("bulkGrantSkipReason", () => {
    it("skips opted_out and already granted", () => {
        assert.equal(
            bulkGrantSkipReason({ consentStatus: "opted_out", active: true }),
            "opted_out"
        );
        assert.equal(
            bulkGrantSkipReason({ consentStatus: "granted", active: true }),
            "already_granted"
        );
        assert.equal(
            bulkGrantSkipReason({ consentStatus: "unknown", active: true }),
            null
        );
    });
});

describe("eligibility — blocked contacts", () => {
    it("blocks campaign inclusion without revoking consent", () => {
        const r = evaluateEligibility(
            {
                id: "c1",
                waId: "5511999998888",
                fullName: null,
                company: null,
                city: null,
                state: null,
                category: null,
                origin: "manual",
                active: true,
                blocked: true,
                consentStatus: "granted",
            },
            { purpose: "marketing", requireConsent: true }
        );
        assert.equal(r.ok, false);
        if (!r.ok) assert.equal(r.reason, "blocked");
    });

    it("allows active granted non-blocked contacts", () => {
        const r = evaluateEligibility(
            {
                id: "c1",
                waId: "5511999998888",
                fullName: null,
                company: null,
                city: null,
                state: null,
                category: null,
                origin: "manual",
                active: true,
                blocked: false,
                consentStatus: "granted",
            },
            { purpose: "marketing", requireConsent: true }
        );
        assert.equal(r.ok, true);
    });
});
