import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    estimateMessagesFromSelection,
    flattenBulletinSelections,
    isOrphanVersionId,
    orphanToBulletinPick,
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

    it("empty bulletin selection yields empty preview (not paste prompt)", () => {
        const preview = resolveCampaignPreviewText({
            contentKind: "bulletin",
            messageBody: "Cole o texto do boletim para analisar.",
            parts: [],
            partIndex: 0,
        });
        assert.equal(preview.text, "");
        assert.equal(preview.partCount, 0);
        assert.ok(!preview.text.includes("Cole o texto"));
    });

    it("orphan APPROVED template becomes selectable individual pick", () => {
        const orphanPick = orphanToBulletinPick({
            id: "mt1",
            technicalName: "boletim_v3_2_cargas",
            displayName: "Boletim 2 cargas",
            language: "pt_BR",
            category: "MARKETING",
            loadsPerMessage: 2,
            bodyPreview: "BODY REAL DO TEMPLATE",
        });
        assert.equal(isOrphanVersionId(orphanPick.versionId), true);
        const prepared = flattenBulletinSelections([orphanPick]);
        assert.equal(prepared.meta.cardCount, 1);
        assert.equal(prepared.parts[0].bodyText, "BODY REAL DO TEMPLATE");
        assert.equal(prepared.parts[0].templateName, "boletim_v3_2_cargas");
        assert.equal(prepared.parts[0].templateLanguage, "pt_BR");
        // Static BODY (no {{n}}) → ready; parameterized orphans stay blocked
        assert.equal(prepared.parts[0].readyForRealSend, true);
        const v = validateBulletinPicks([orphanPick]);
        assert.equal(v.ok, true);
        const preview = resolveCampaignPreviewText({
            contentKind: "bulletin",
            messageBody: "IGNORED",
            parts: prepared.parts,
            partIndex: 0,
        });
        assert.equal(preview.text, "BODY REAL DO TEMPLATE");
    });

    it("orphan with {{n}} placeholders is not readyForRealSend (prevents 132000)", () => {
        const orphanPick = orphanToBulletinPick({
            id: "mt2",
            technicalName: "boletim_v3_3_cargas",
            displayName: "v3 3",
            language: "pt_BR",
            category: "MARKETING",
            loadsPerMessage: 3,
            bodyPreview: "Origem {{1}} Destino {{2}} Frete {{3}}",
        });
        const prepared = flattenBulletinSelections([orphanPick]);
        assert.equal(prepared.parts[0].readyForRealSend, false);
        assert.match(prepared.parts[0].blockReason || "", /132000|parâmetro/i);
    });

    it("zero registered bulletins + three orphan templates → three selectable", () => {
        const names = [
            "boletim_v3_2_cargas",
            "boletim_v3_3_cargas",
            "atualizao_de_embarque_cotton",
        ];
        const picks = names.map((name, i) =>
            orphanToBulletinPick({
                id: `mt${i}`,
                technicalName: name,
                displayName: name,
                language: name.includes("cotton") ? "en" : "pt_BR",
                category: "MARKETING",
                loadsPerMessage: name.includes("3") ? 3 : 2,
                bodyPreview: `body ${name}`,
            })
        );
        assert.equal(picks.length, 3);
        const prepared = flattenBulletinSelections(picks);
        assert.equal(prepared.meta.cardCount, 3);
        assert.equal(prepared.parts[2].templateLanguage, "en");
        assert.equal(
            estimateMessagesFromSelection(139, picks),
            139 * 3
        );
    });
});
