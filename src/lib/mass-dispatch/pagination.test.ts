import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    buildPageMeta,
    clampPage,
    rangeLabel,
    visiblePageNumbers,
} from "./pagination";

describe("mass-dispatch pagination", () => {
    it("handles 0 campaigns", () => {
        const m = buildPageMeta(0, 1, 10);
        assert.deepEqual(m, { total: 0, page: 1, limit: 10, totalPages: 1 });
        assert.equal(rangeLabel(m), "Exibindo 0 de 0 campanhas");
    });

    it("handles exactly 10", () => {
        const m = buildPageMeta(10, 1, 10);
        assert.equal(m.totalPages, 1);
        assert.equal(rangeLabel(m), "Exibindo 1 a 10 de 10 campanhas");
    });

    it("handles 11 → 2 pages and clamps page", () => {
        const m = buildPageMeta(11, 99, 10);
        assert.equal(m.totalPages, 2);
        assert.equal(m.page, 2);
        assert.equal(rangeLabel(m), "Exibindo 11 a 11 de 11 campanhas");
    });

    it("handles 20 and 24", () => {
        assert.equal(buildPageMeta(20, 2, 10).totalPages, 2);
        assert.equal(buildPageMeta(24, 1, 10).totalPages, 3);
        assert.equal(
            rangeLabel(buildPageMeta(24, 1, 10)),
            "Exibindo 1 a 10 de 24 campanhas"
        );
    });

    it("visible pages window", () => {
        assert.deepEqual(visiblePageNumbers(1, 3), [1, 2, 3]);
        assert.deepEqual(visiblePageNumbers(2, 5), [1, 2, 3]);
        assert.equal(clampPage(0, 5), 1);
    });
});
