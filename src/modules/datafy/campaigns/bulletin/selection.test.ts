import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    estimateMessagesFromSelection,
    flattenBulletinSelections,
    resolveCampaignPreviewText,
    validateBulletinPicks,
    type BulletinVersionPick,
} from "./selection";

function pick(partial: Partial<BulletinVersionPick> & { versionId: string }): BulletinVersionPick {
    const cards = partial.cards || [
        {
            cardId: "c1",
            position: 1,
            loadIndexes: [0, 1],
            technicalName: "boletim_v3_2_cargas",
            displayName: "boletim_v3_2_cargas",
            approvalStatus: "APPROVED",
            loadSummary: "Cargas 1, 2",
            bodyPreview: "card one body",
            libraryTemplateId: "boletim_v3_2_cargas",
        },
        {
            cardId: "c2",
            position: 2,
            loadIndexes: [2],
            technicalName: "boletim_v3_1_carga",
            displayName: "boletim_v3_1_carga",
            approvalStatus: "APPROVED",
            loadSummary: "Carga 3",
            bodyPreview: "card two body",
            libraryTemplateId: "boletim_v3_1_carga",
        },
    ];
    return {
        bundleId: "b1",
        publicKey: "COTTON-20261012-001",
        title: "Cotton",
        version: 1,
        isCurrent: true,
        loadCount: 3,
        cardCount: 2,
        approvedCardCount: 2,
        approvalStatus: "fully_approved",
        mode: "complete_bulletin",
        cardPositions: [1, 2],
        cards,
        ...partial,
    };
}

describe("bulletin campaign selection", () => {
    it("flattens multiple bulletins preserving order", () => {
        const prepared = flattenBulletinSelections([
            pick({ versionId: "v1" }),
            pick({
                versionId: "v2",
                publicKey: "SOJA-20261012-001",
                title: "Soja",
                mode: "selected_cards",
                cardPositions: [1],
            }),
        ]);
        assert.equal(prepared.meta.bulletinCount, 2);
        assert.equal(prepared.meta.cardCount, 3);
        assert.equal(prepared.meta.bulletinSendMode, "multi_bulletin");
        assert.equal(prepared.parts[0].bulletinPublicKey, "COTTON-20261012-001");
        assert.equal(prepared.parts[2].bulletinPublicKey, "SOJA-20261012-001");
        assert.equal(prepared.parts[0].bodyText, "card one body");
    });

    it("rejects incomplete complete_bulletin picks", () => {
        const v = validateBulletinPicks([
            pick({
                versionId: "v1",
                approvedCardCount: 1,
                cardCount: 2,
                mode: "complete_bulletin",
                cardPositions: [1, 2],
            }),
        ]);
        assert.equal(v.ok, false);
    });

    it("estimates messages as recipients × cards", () => {
        assert.equal(
            estimateMessagesFromSelection(139, [pick({ versionId: "v1" })]),
            278
        );
    });

    it("preview uses parts body, never raw paste when bulletin selected", () => {
        const prepared = flattenBulletinSelections([pick({ versionId: "v1" })]);
        const preview = resolveCampaignPreviewText({
            contentKind: "bulletin",
            messageBody: "RAW PASTE 2628 CHARS SHOULD NOT APPEAR",
            parts: prepared.parts,
            partIndex: 1,
        });
        assert.equal(preview.text, "card two body");
        assert.ok(!preview.text.includes("RAW PASTE"));
        assert.equal(preview.partCount, 2);
    });
});
