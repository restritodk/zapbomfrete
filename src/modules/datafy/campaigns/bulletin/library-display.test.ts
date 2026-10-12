import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    computeLibraryCounters,
    filterLibraryRows,
    formatSaoPaulo,
    libraryDateLines,
    normalizeMetaStatus,
    statusBucket,
    statusLabelPt,
    countComponents,
} from "./library-display";
import { getRejectionDisplay } from "./rejection-reason";

describe("library-display — status & rejection", () => {
    it("APPROVED + NONE → no rejection UI", () => {
        const d = getRejectionDisplay("APPROVED", "NONE");
        assert.equal(d.show, false);
        assert.equal(statusLabelPt("APPROVED"), "Aprovado");
    });

    it("APPROVED + null → no rejection UI", () => {
        const d = getRejectionDisplay("APPROVED", null);
        assert.equal(d.show, false);
    });

    it("APPROVED + old reason → still no rejection UI", () => {
        const d = getRejectionDisplay("APPROVED", "INVALID_FORMAT");
        assert.equal(d.show, false);
    });

    it("REJECTED + valid reason → shows reason", () => {
        const d = getRejectionDisplay("REJECTED", "INVALID_FORMAT");
        assert.equal(d.show, true);
        assert.equal(d.message, "INVALID_FORMAT");
    });

    it("REJECTED + NONE → neutral message, never NONE", () => {
        const d = getRejectionDisplay("REJECTED", "NONE");
        assert.equal(d.show, true);
        assert.ok(d.message && !/none/i.test(d.message));
    });

    it("PENDING + NONE → no rejection UI", () => {
        const d = getRejectionDisplay("PENDING", "NONE");
        assert.equal(d.show, false);
    });

    it("PAUSED/DISABLED → not treated as rejected", () => {
        assert.equal(statusBucket("PAUSED"), "paused");
        assert.equal(statusBucket("DISABLED"), "disabled");
        assert.equal(getRejectionDisplay("PAUSED", "NONE").show, false);
        assert.equal(getRejectionDisplay("DISABLED", "x").show, false);
    });

    it("normalizes NÃO ENVIADO", () => {
        assert.equal(normalizeMetaStatus("NÃO ENVIADO"), "NOT_SENT");
        assert.equal(statusBucket(null), "not_sent");
    });
});

describe("library-display — counters & filters", () => {
    const rows = [
        {
            id: "1",
            technicalName: "aprovado_assoc",
            category: "MARKETING",
            language: "pt_BR",
            remoteStatus: "APPROVED",
            kind: "custom",
            associated: true,
            remoteRejectedReason: "NONE",
        },
        {
            id: "2",
            technicalName: "aprovado_orfao",
            category: "MARKETING",
            language: "pt_BR",
            remoteStatus: "APPROVED",
            kind: "custom",
            associated: false,
            remoteRejectedReason: "NONE",
        },
        {
            id: "3",
            technicalName: "pendente",
            category: "UTILITY",
            language: "en",
            remoteStatus: "PENDING",
            kind: "custom",
            associated: false,
        },
        {
            id: "4",
            technicalName: "rejeitado",
            category: "MARKETING",
            language: "pt_BR",
            remoteStatus: "REJECTED",
            kind: "custom",
            associated: false,
            remoteRejectedReason: "SCAM",
        },
        {
            id: "5",
            technicalName: "local_draft",
            category: "MARKETING",
            language: "pt_BR",
            remoteStatus: null,
            kind: "builtin",
            associated: false,
        },
    ];

    it("computes real counters without treating NONE as rejected", () => {
        const c = computeLibraryCounters(rows);
        assert.equal(c.total, 5);
        assert.equal(c.approved, 2);
        assert.equal(c.pending, 1);
        assert.equal(c.rejected, 1);
        assert.equal(c.notSent, 1);
        assert.equal(c.unassociatedApproved, 1);
        assert.equal(c.local, 5);
    });

    it("filters by tab unassociated", () => {
        const f = filterLibraryRows(rows, { tab: "unassociated" });
        assert.equal(f.length, 1);
        assert.equal(f[0].technicalName, "aprovado_orfao");
    });

    it("combines search + status filter", () => {
        const f = filterLibraryRows(rows, {
            q: "rejeitado",
            status: "REJECTED",
        });
        assert.equal(f.length, 1);
    });

    it("filters by category and language", () => {
        const f = filterLibraryRows(rows, {
            category: "UTILITY",
            language: "en",
        });
        assert.equal(f.length, 1);
        assert.equal(f[0].technicalName, "pendente");
    });
});

describe("library-display — dates", () => {
    it("APPROVED never uses sync time as approval", () => {
        const lines = libraryDateLines({
            id: "x",
            technicalName: "t",
            remoteStatus: "APPROVED",
            lastSubmittedAt: "2026-10-12T21:00:03.000Z",
            lastSyncedAt: "2026-10-12T21:30:00.000Z",
            createdAt: "2026-10-01T12:00:00.000Z",
        });
        const approved = lines.find((l) => l.label === "Aprovado");
        assert.ok(approved);
        assert.equal(approved!.value, "Data de aprovação indisponível");
        assert.ok(lines.some((l) => l.label === "Enviado"));
    });

    it("formats America/Sao_Paulo", () => {
        const s = formatSaoPaulo("2026-10-12T21:00:03.000Z");
        assert.ok(s);
        assert.match(s!, /\d{2}\/\d{2}\/\d{4}/);
    });

    it("counts components from content", () => {
        assert.equal(
            countComponents({
                headerText: "H",
                bodyText: "Body",
                footerText: "F",
                buttons: { enabled: true, buttons: [{ text: "A" }] },
            }),
            4
        );
    });
});
