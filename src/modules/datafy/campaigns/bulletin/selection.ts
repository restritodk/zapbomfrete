/**
 * Structured multi-bulletin campaign selection (wizard Step 1 → queue).
 * Flattened CampaignMessagePart[] is the single source of truth for preview + send.
 */

import type { CampaignMessagePart } from "./types";
import { expectedMessagesForCampaign } from "./grouping";

export type BulletinCardPick = {
    cardId: string;
    position: number;
    loadIndexes: number[];
    technicalName: string | null;
    displayName: string | null;
    approvalStatus: string;
    loadSummary: string;
    bodyPreview: string | null;
    libraryTemplateId: string | null;
    language?: string | null;
    category?: string | null;
};

/** Synthetic pick for an APPROVED template not yet linked to a bulletin card. */
export type OrphanTemplateSource = {
    id: string;
    technicalName: string;
    displayName: string;
    language: string;
    category: string;
    loadsPerMessage: number;
    bodyPreview: string;
    remoteStatus?: string | null;
};

export function isOrphanVersionId(versionId: string): boolean {
    return versionId.startsWith("orphan:");
}

export function orphanToBulletinPick(
    orphan: OrphanTemplateSource
): BulletinVersionPick {
    const loads = Math.max(1, orphan.loadsPerMessage || 1);
    const loadIndexes = Array.from({ length: loads }, (_, i) => i);
    return {
        bundleId: `orphan-bundle:${orphan.id}`,
        versionId: `orphan:${orphan.id}`,
        publicKey: orphan.technicalName,
        title: orphan.displayName || orphan.technicalName,
        version: 1,
        isCurrent: true,
        loadCount: loads,
        cardCount: 1,
        approvedCardCount: 1,
        approvalStatus: "fully_approved",
        mode: "selected_cards",
        cardPositions: [1],
        cards: [
            {
                cardId: `orphan-card:${orphan.id}`,
                position: 1,
                loadIndexes,
                technicalName: orphan.technicalName,
                displayName: orphan.displayName || orphan.technicalName,
                approvalStatus: "APPROVED",
                loadSummary:
                    loads === 1 ? "1 carga" : `${loads} cargas`,
                bodyPreview: orphan.bodyPreview || "",
                libraryTemplateId: orphan.id,
                language: orphan.language || "pt_BR",
                category: orphan.category || "MARKETING",
            },
        ],
    };
}

export type BulletinVersionPick = {
    bundleId: string;
    versionId: string;
    publicKey: string;
    title: string;
    version: number;
    isCurrent: boolean;
    loadCount: number;
    cardCount: number;
    approvedCardCount: number;
    approvalStatus: string;
    /** complete = all approved cards; selected = subset by position */
    mode: "complete_bulletin" | "selected_cards";
    cardPositions: number[];
    cards: BulletinCardPick[];
};

export type CampaignContentSelection = {
    kind: "message" | "bulletin";
    bulletins: BulletinVersionPick[];
};

export type PreparedBulletinSend = {
    parts: CampaignMessagePart[];
    meta: {
        contentKind: "bulletin";
        bulletinSendMode: "multi_bulletin" | "complete_bulletin" | "selected_cards";
        selections: Array<{
            order: number;
            versionId: string;
            publicKey: string;
            title: string;
            version: number;
            isHistorical: boolean;
            mode: "complete_bulletin" | "selected_cards";
            cardPositions: number[];
            cardCount: number;
            loadCount: number;
        }>;
        bulletinCount: number;
        cardCount: number;
        loadCount: number;
        primaryVersionId: string | null;
    };
};

export function flattenBulletinSelections(
    picks: BulletinVersionPick[]
): PreparedBulletinSend {
    if (!picks.length) {
        return {
            parts: [],
            meta: {
                contentKind: "bulletin",
                bulletinSendMode: "selected_cards",
                selections: [],
                bulletinCount: 0,
                cardCount: 0,
                loadCount: 0,
                primaryVersionId: null,
            },
        };
    }

    const parts: CampaignMessagePart[] = [];
    const selections: PreparedBulletinSend["meta"]["selections"] = [];
    let globalIndex = 0;
    let totalLoads = 0;

    for (let bi = 0; bi < picks.length; bi++) {
        const pick = picks[bi];
        const positions = [...pick.cardPositions].sort((a, b) => a - b);
        const cards = positions
            .map((pos) => pick.cards.find((c) => c.position === pos))
            .filter((c): c is BulletinCardPick => Boolean(c));

        for (const card of cards) {
            const approval = String(card.approvalStatus || "").toUpperCase();
            const bodyText = card.bodyPreview || "";
            const placeholderCount = (
                bodyText.match(/\{\{(\d+)\}\}/g) || []
            ).length;
            // Orphan / card without filled variableMapping cannot send when BODY has {{n}}
            const ready =
                approval === "APPROVED" &&
                Boolean(card.technicalName) &&
                placeholderCount === 0;
            parts.push({
                index: globalIndex,
                label: isOrphanVersionId(pick.versionId)
                    ? `Template · ${card.technicalName}`
                    : `${pick.publicKey} v${pick.version} · Card ${card.position}/${pick.cardCount}`,
                bodyText,
                loadIndexes: card.loadIndexes || [],
                charCount: bodyText.length,
                templateName: card.technicalName,
                templateLanguage: card.language || "pt_BR",
                templateCategory: card.category || "MARKETING",
                templateApprovalStatus: approval,
                libraryTemplateId: card.libraryTemplateId,
                variableMapping: { body: [] },
                readyForRealSend: ready,
                compatibility: ready
                    ? "ready"
                    : placeholderCount > 0
                      ? "incomplete_fields"
                      : "missing_template",
                blockReason: ready
                    ? null
                    : placeholderCount > 0
                      ? `Template exige ${placeholderCount} parâmetro(s) no BODY — associe a um boletim com cargas ou preencha o mapeamento (evita Meta #132000).`
                      : "Card sem template APPROVED nesta versão.",
                bulletinPublicKey: pick.publicKey,
                bulletinVersion: pick.version,
                bulletinVersionId: pick.versionId,
                bulletinTitle: pick.title,
                cardPosition: card.position,
            });
            globalIndex++;
        }

        totalLoads += pick.loadCount;
        selections.push({
            order: bi + 1,
            versionId: pick.versionId,
            publicKey: pick.publicKey,
            title: pick.title,
            version: pick.version,
            isHistorical: !pick.isCurrent,
            mode: pick.mode,
            cardPositions: positions,
            cardCount: cards.length,
            loadCount: pick.loadCount,
        });
    }

    const allComplete = picks.every(
        (p) =>
            p.mode === "complete_bulletin" &&
            p.cardPositions.length === p.cardCount &&
            p.approvedCardCount === p.cardCount
    );

    return {
        parts,
        meta: {
            contentKind: "bulletin",
            bulletinSendMode:
                picks.length > 1
                    ? "multi_bulletin"
                    : allComplete
                      ? "complete_bulletin"
                      : "selected_cards",
            selections,
            bulletinCount: picks.length,
            cardCount: parts.length,
            loadCount: totalLoads,
            primaryVersionId: picks[0]?.versionId || null,
        },
    };
}

export function validateBulletinPicks(picks: BulletinVersionPick[]): {
    ok: boolean;
    errors: string[];
} {
    const errors: string[] = [];
    if (!picks.length) {
        errors.push(
            "Selecione ao menos um boletim ou template APPROVED."
        );
        return { ok: false, errors };
    }
    for (const pick of picks) {
        if (!pick.cardPositions.length) {
            errors.push(
                `${pick.publicKey} v${pick.version}: nenhum card selecionado.`
            );
            continue;
        }
        if (pick.mode === "complete_bulletin") {
            if (pick.approvedCardCount !== pick.cardCount || pick.cardCount < 1) {
                errors.push(
                    `${pick.publicKey} v${pick.version}: boletim incompleto (${pick.approvedCardCount}/${pick.cardCount} aprovados).`
                );
            }
            if (pick.cardPositions.length !== pick.cardCount) {
                errors.push(
                    `${pick.publicKey} v${pick.version}: envio completo exige todos os cards.`
                );
            }
        }
        for (const pos of pick.cardPositions) {
            const card = pick.cards.find((c) => c.position === pos);
            if (!card) {
                errors.push(
                    `${pick.publicKey}: card ${pos} não encontrado nesta versão.`
                );
                continue;
            }
            if (String(card.approvalStatus).toUpperCase() !== "APPROVED") {
                errors.push(
                    `${pick.publicKey} Card ${pos}: não está APPROVED.`
                );
            }
            if (!card.technicalName) {
                errors.push(
                    `${pick.publicKey} Card ${pos}: sem template associado.`
                );
            }
        }
    }
    return { ok: errors.length === 0, errors };
}

export function estimateMessagesFromSelection(
    eligibleRecipients: number,
    picks: BulletinVersionPick[]
): number {
    const prepared = flattenBulletinSelections(picks);
    return expectedMessagesForCampaign({
        eligibleRecipients,
        cardCount: Math.max(1, prepared.meta.cardCount),
    });
}

/** Preview must never fall back to raw paste when bulletin parts exist. */
export function resolveCampaignPreviewText(opts: {
    contentKind: "message" | "bulletin";
    messageBody: string;
    parts: CampaignMessagePart[];
    partIndex: number;
}): { text: string; partLabel: string | null; partCount: number } {
    if (opts.contentKind === "bulletin") {
        if (opts.parts.length > 0) {
            const idx = Math.min(
                Math.max(0, opts.partIndex),
                opts.parts.length - 1
            );
            const part = opts.parts[idx];
            return {
                text: part.bodyText || "",
                partLabel:
                    part.label ||
                    `Mensagem ${idx + 1} de ${opts.parts.length}`,
                partCount: opts.parts.length,
            };
        }
        return {
            text: "",
            partLabel: "Nenhum conteúdo selecionado",
            partCount: 0,
        };
    }
    return {
        text: opts.messageBody,
        partLabel: null,
        partCount: 1,
    };
}
