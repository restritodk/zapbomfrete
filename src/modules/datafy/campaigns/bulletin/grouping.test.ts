import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    aggregateCardApprovalStatus,
    canAssociateTemplateToCard,
    cardSeedsFromMessageParts,
    expectedMessagesForCampaign,
    formatBulletinDateKey,
    formatBulletinPublicKey,
    parseBulletinPublicKey,
    partsFromBulletinCards,
    slugifyBulletinTitle,
    splitCurrentAndHistory,
    summarizeLoadIndexes,
} from "./grouping";
import type { CampaignMessagePart } from "./types";

describe("bulletin grouping helpers", () => {
    it("slugifies bulletin titles to stable tokens", () => {
        assert.equal(
            slugifyBulletinTitle("ATUALIZAÇÃO DE EMBARQUE COTTON ✅"),
            "COTTON"
        );
        assert.equal(slugifyBulletinTitle("Boletim Soja MT"), "SOJA");
        assert.equal(slugifyBulletinTitle(""), "BOLETIM");
    });

    it("formats and parses public keys", () => {
        const key = formatBulletinPublicKey("COTTON", "20261012", 1);
        assert.equal(key, "COTTON-20261012-001");
        const parsed = parseBulletinPublicKey(key);
        assert.deepEqual(parsed, {
            slug: "COTTON",
            dateKey: "20261012",
            sequence: 1,
        });
        assert.equal(formatBulletinDateKey(new Date("2026-10-12T15:00:00Z")), "20261012");
    });

    it("builds ordered card seeds from message parts", () => {
        const parts: CampaignMessagePart[] = [
            {
                index: 0,
                label: "P1",
                bodyText: "card1",
                loadIndexes: [0, 1, 2],
                charCount: 5,
                templateName: "boletim_v3_3_cargas",
                templateLanguage: "pt_BR",
                templateApprovalStatus: "APPROVED",
                libraryTemplateId: "boletim_v3_3_cargas",
                readyForRealSend: true,
            },
            {
                index: 1,
                label: "P2",
                bodyText: "card2",
                loadIndexes: [3, 4, 5],
                charCount: 5,
                templateName: "boletim_v3_3_cargas",
                templateApprovalStatus: "PENDING",
            },
            {
                index: 2,
                label: "P3",
                bodyText: "card3",
                loadIndexes: [6, 7, 8],
                charCount: 5,
                templateName: "boletim_v3_3_cargas",
                templateApprovalStatus: "APPROVED",
            },
        ];
        const seeds = cardSeedsFromMessageParts(parts);
        assert.equal(seeds.length, 3);
        assert.equal(seeds[0].position, 1);
        assert.equal(seeds[0].loadSummary, "Cargas 1, 2, 3");
        assert.equal(seeds[1].approvalStatus, "PENDING");
        assert.equal(
            aggregateCardApprovalStatus(seeds.map((s) => s.approvalStatus)),
            "partially_approved"
        );
        assert.equal(
            aggregateCardApprovalStatus(["APPROVED", "APPROVED", "APPROVED"]),
            "fully_approved"
        );
    });

    it("never mixes versions when splitting current vs history", () => {
        const { current, history } = splitCurrentAndHistory([
            {
                bundleId: "b1",
                publicKey: "COTTON-20261012-001",
                name: "Cotton",
                versionId: "v2",
                version: 2,
                isCurrent: true,
                title: "Cotton v2",
                loadCount: 9,
                cardCount: 3,
                approvalStatus: "fully_approved",
                approvedCardCount: 3,
                createdAt: "2026-10-12T12:00:00.000Z",
                updatedAt: "2026-10-12T13:00:00.000Z",
                cards: [],
            },
            {
                bundleId: "b1",
                publicKey: "COTTON-20261012-001",
                name: "Cotton",
                versionId: "v1",
                version: 1,
                isCurrent: false,
                title: "Cotton v1",
                loadCount: 9,
                cardCount: 3,
                approvalStatus: "fully_approved",
                approvedCardCount: 3,
                createdAt: "2026-10-11T12:00:00.000Z",
                updatedAt: "2026-10-11T13:00:00.000Z",
                cards: [],
            },
        ]);
        assert.equal(current.length, 1);
        assert.equal(current[0].versionId, "v2");
        assert.equal(history.length, 1);
        assert.equal(history[0].versionId, "v1");
    });

    it("builds campaign parts only from approved cards in order", () => {
        const parts = partsFromBulletinCards(
            [
                {
                    position: 2,
                    loadIndexes: [3, 4],
                    bodyPreview: "two",
                    technicalName: "t2",
                    approvalStatus: "APPROVED",
                },
                {
                    position: 1,
                    loadIndexes: [0, 1, 2],
                    bodyPreview: "one",
                    technicalName: "t1",
                    approvalStatus: "APPROVED",
                },
                {
                    position: 3,
                    loadIndexes: [5],
                    bodyPreview: "three",
                    technicalName: "t3",
                    approvalStatus: "PENDING",
                },
            ],
            { onlyApproved: true }
        );
        assert.equal(parts.length, 2);
        assert.equal(parts[0].templateName, "t1");
        assert.equal(parts[1].templateName, "t2");
        assert.equal(expectedMessagesForCampaign({ eligibleRecipients: 139, cardCount: 3 }), 417);
        assert.equal(summarizeLoadIndexes([0, 1, 2]), "Cargas 1, 2, 3");
    });

    it("blocks incompatible template association by loadsPerMessage", () => {
        const bad = canAssociateTemplateToCard({
            cardLoadsPerMessage: 3,
            templateLoadsPerMessage: 1,
            cardApprovalStatus: "DRAFT",
            templateRemoteStatus: "APPROVED",
        });
        assert.equal(bad.ok, false);
        const good = canAssociateTemplateToCard({
            cardLoadsPerMessage: 3,
            templateLoadsPerMessage: 3,
            cardApprovalStatus: "DRAFT",
            templateRemoteStatus: "APPROVED",
        });
        assert.equal(good.ok, true);
    });
});
