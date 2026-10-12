import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    buildCompatibleCardOptions,
    cardLoadsCount,
    emptyCompatMessage,
    isLoadsCompatible,
    parseManagedAssociationRef,
} from "./association-compat";
import { canAssociateTemplateToCard } from "./grouping";

describe("association-compat — loads detection", () => {
    it("uses loadIndexes length, not digit count in summary", () => {
        assert.equal(
            cardLoadsCount({
                id: "c1",
                position: 1,
                loadIndexes: [0, 1],
                loadSummary: "Cargas 1, 2",
            }),
            2
        );
        // Regression: old UI used match(/\d+/g).length || 1 on summary only
        assert.equal(
            cardLoadsCount({
                id: "c2",
                position: 1,
                loadIndexes: [0, 1],
                loadSummary: "",
            }),
            2
        );
        assert.equal(
            cardLoadsCount({
                id: "c3",
                position: 1,
                loadIndexes: [],
                loadSummary: "Sem cargas",
            }),
            0
        );
    });

    it("boletim_v3_2_cargas (2 cargas) matches only 2-load cards", () => {
        const versions = [
            {
                publicKey: "BF-20261012-001",
                version: 1,
                versionId: "v1",
                cardCount: 3,
                cards: [
                    {
                        id: "a",
                        position: 1,
                        loadIndexes: [0],
                        loadSummary: "Carga 1",
                        language: "pt_BR",
                    },
                    {
                        id: "b",
                        position: 2,
                        loadIndexes: [0, 1],
                        loadSummary: "Cargas 1, 2",
                        language: "pt_BR",
                    },
                    {
                        id: "c",
                        position: 3,
                        loadIndexes: [0, 1, 2],
                        loadSummary: "Cargas 1, 2, 3",
                        language: "pt_BR",
                    },
                ],
            },
        ];
        const opts = buildCompatibleCardOptions(versions, {
            templateLoadsPerMessage: 2,
            templateLanguage: "pt_BR",
        });
        assert.equal(opts.length, 1);
        assert.equal(opts[0].value, "b");
        assert.equal(opts[0].loads, 2);
    });

    it("empty state when no compatible cards", () => {
        const opts = buildCompatibleCardOptions(
            [
                {
                    publicKey: "X",
                    version: 1,
                    versionId: "v",
                    cardCount: 1,
                    cards: [
                        {
                            id: "only1",
                            position: 1,
                            loadIndexes: [0],
                            language: "pt_BR",
                        },
                    ],
                },
            ],
            { templateLoadsPerMessage: 2, templateLanguage: "pt_BR" }
        );
        assert.equal(opts.length, 0);
        const msg = emptyCompatMessage({
            templateLoadsPerMessage: 2,
            templateLanguage: "pt_BR",
            totalCards: 1,
            totalVersions: 1,
        });
        assert.match(msg, /Nenhum card compatível/);
        assert.match(msg, /2 carga/);
    });

    it("excludes already linked when requested", () => {
        const opts = buildCompatibleCardOptions(
            [
                {
                    publicKey: "X",
                    version: 1,
                    versionId: "v",
                    cardCount: 2,
                    cards: [
                        {
                            id: "free",
                            position: 1,
                            loadIndexes: [0, 1],
                            language: "pt_BR",
                        },
                        {
                            id: "taken",
                            position: 2,
                            loadIndexes: [0, 1],
                            language: "pt_BR",
                            managedTemplateId: "m1",
                        },
                    ],
                },
            ],
            {
                templateLoadsPerMessage: 2,
                excludeAlreadyLinked: true,
            }
        );
        assert.equal(opts.length, 1);
        assert.equal(opts[0].value, "free");
    });

    it("server rule still blocks load mismatch", () => {
        assert.equal(
            canAssociateTemplateToCard({
                cardLoadsPerMessage: 1,
                templateLoadsPerMessage: 2,
                cardApprovalStatus: "DRAFT",
                templateRemoteStatus: "APPROVED",
            }).ok,
            false
        );
        assert.equal(isLoadsCompatible(2, 2), true);
        assert.equal(isLoadsCompatible(2, 1), false);
    });

    it("parses builtin association refs", () => {
        assert.deepEqual(parseManagedAssociationRef("builtin:boletim_v3_2_cargas"), {
            kind: "builtin",
            value: "boletim_v3_2_cargas",
        });
        assert.deepEqual(parseManagedAssociationRef("clxyz"), {
            kind: "id",
            value: "clxyz",
        });
    });
});
