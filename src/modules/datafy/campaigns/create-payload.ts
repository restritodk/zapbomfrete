/**
 * Shared create-campaign payload contract (frontend wizard ↔ POST /campaigns).
 */

import { z } from "zod";
import { CAMPAIGN_PURPOSES } from "./constants";
import { isOrphanVersionId } from "./bulletin/selection";
import type { CampaignMessagePart } from "./bulletin/types";
import { validateTemplateBodyParamCount } from "./template-params";

/** Modes persisted on DatafyCampaign.bulletinSendMode */
export const BULLETIN_SEND_MODES = [
    "complete_bulletin",
    "single_card",
    "selected_cards",
    "multi_bulletin",
    "individual_templates",
    "legacy_parts",
    "direct_freeform",
] as const;

export type BulletinSendModePersisted = (typeof BULLETIN_SEND_MODES)[number];

export const createCampaignBodySchema = z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(5000).nullable().optional(),
    purpose: z.enum(CAMPAIGN_PURPOSES).optional(),
    templateName: z.string().max(200).nullable().optional(),
    templateLanguage: z.string().max(20).nullable().optional(),
    templateCategory: z.string().max(40).nullable().optional(),
    templateComponents: z.unknown().optional(),
    templateApprovalStatus: z.string().max(40).nullable().optional(),
    contentSource: z.string().max(40).optional(),
    contentKind: z.enum(["message", "bulletin"]).optional(),
    messageBody: z.string().max(100_000).nullable().optional(),
    interactiveButtons: z
        .object({
            enabled: z.boolean(),
            purpose: z.string().optional(),
            placement: z
                .enum(["last_only", "per_template_approved"])
                .optional(),
            buttons: z
                .array(
                    z.object({
                        id: z.string().max(256),
                        title: z.string().max(20),
                    })
                )
                .max(3)
                .optional(),
        })
        .nullable()
        .optional(),
    messageParts: z.unknown().optional(),
    bulletinMeta: z.unknown().optional(),
    bulletinVersionId: z.string().max(64).nullable().optional(),
    bulletinSendMode: z.enum(BULLETIN_SEND_MODES).nullable().optional(),
    bulletinCardPosition: z.number().int().min(1).nullable().optional(),
    headerImageUrl: z.string().max(2000).nullable().optional(),
    headerImageHandle: z.string().max(2000).nullable().optional(),
    variableMapping: z.unknown().optional(),
    segmentFilter: z
        .object({
            selectAllEligible: z.boolean().optional(),
            source: z.enum(["import", "crm", "groups"]).optional(),
            phones: z.array(z.string()).max(20000).optional(),
            contactIds: z.array(z.string()).optional(),
            tagIds: z.array(z.string()).optional(),
            category: z.string().nullable().optional(),
            city: z.string().nullable().optional(),
            state: z.string().nullable().optional(),
            company: z.string().nullable().optional(),
            origin: z.string().nullable().optional(),
            search: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
    timezone: z.string().max(80).optional(),
    scheduledAt: z.string().nullable().optional(),
    delayMs: z.number().int().min(3_000).max(60_000).optional(),
    batchSize: z.number().int().optional(),
    dryRun: z.boolean().optional(),
    requireConsent: z.boolean().optional(),
});

export type CreateCampaignBody = z.infer<typeof createCampaignBodySchema>;

export function formatCreateCampaignZodError(error: z.ZodError): string {
    const issues = error.issues.slice(0, 4);
    if (!issues.length) return "Payload inválido";
    return issues
        .map((i) => {
            const path = i.path.length ? i.path.join(".") : "payload";
            return `${path}: ${i.message}`;
        })
        .join(" · ");
}

/** Never persist synthetic orphan:* ids on the FK column. */
export function persistableBulletinVersionId(
    versionId: string | null | undefined
): string | null {
    if (!versionId) return null;
    if (isOrphanVersionId(versionId)) return null;
    if (versionId.startsWith("orphan-")) return null;
    return versionId.slice(0, 64);
}

export function mapSelectionSendMode(
    mode: string | null | undefined
): BulletinSendModePersisted | null {
    if (!mode) return null;
    if ((BULLETIN_SEND_MODES as readonly string[]).includes(mode)) {
        return mode as BulletinSendModePersisted;
    }
    if (mode === "split_templates") return "selected_cards";
    if (mode === "complete_single") return "direct_freeform";
    return "legacy_parts";
}

export type BulletinLaunchIssue = {
    level: "error" | "warning";
    code: string;
    message: string;
};

/** Count Meta-style numbered placeholders {{1}}..{{n}} in template BODY. */
export function countNumberedPlaceholders(body: string): number {
    const found = new Set<number>();
    const re = /\{\{(\d+)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
        found.add(Number(m[1]));
    }
    return found.size;
}

/**
 * Validate bulletin launch readiness (purpose vs category, languages, placeholders).
 * Does not invent variable values — flags missing mapping for real send.
 */
export function assessBulletinLaunchIssues(opts: {
    purpose: string;
    parts: CampaignMessagePart[];
    dryRun?: boolean;
    confirmMarketingWithUtilityPurpose?: boolean;
}): {
    ok: boolean;
    status: "ready" | "attention" | "blocked";
    issues: BulletinLaunchIssue[];
} {
    const issues: BulletinLaunchIssue[] = [];
    const parts = opts.parts || [];

    if (!parts.length) {
        issues.push({
            level: "error",
            code: "no_parts",
            message:
                "Nenhum template/card selecionado. Volte à Etapa 1 e escolha o conteúdo.",
        });
        return { ok: false, status: "blocked", issues };
    }

    for (const part of parts) {
        const name = part.templateName || `Parte ${part.index + 1}`;
        const status = String(part.templateApprovalStatus || "").toUpperCase();
        if (status !== "APPROVED") {
            issues.push({
                level: "error",
                code: "not_approved",
                message: `${name}: status ${status || "ausente"} — só templates APPROVED podem ser enviados.`,
            });
        }
        if (!part.templateName) {
            issues.push({
                level: "error",
                code: "missing_name",
                message: `Parte ${part.index + 1}: sem nome técnico de template.`,
            });
        }
        const lang = String(part.templateLanguage || "").trim();
        if (!lang) {
            issues.push({
                level: "error",
                code: "missing_language",
                message: `${name}: idioma aprovado ausente — a fila precisa do idioma exato da Meta.`,
            });
        }
        const paramCheck = validateTemplateBodyParamCount({
            templateName: part.templateName,
            language: part.templateLanguage,
            bodyText: part.bodyText,
            templateComponents: part.templateComponents,
            variableMapping: part.variableMapping || { body: [] },
        });
        if (!paramCheck.ok && !opts.dryRun) {
            issues.push({
                level: "error",
                code: "param_mismatch_132000",
                message:
                    paramCheck.message ||
                    `${name}: parâmetros do BODY incompatíveis (Meta #132000).`,
            });
        } else if (!paramCheck.ok && opts.dryRun) {
            issues.push({
                level: "warning",
                code: "param_mismatch_sim",
                message: `${name}: simulação aceita, mas o envio real falharia (#132000) — esperados ${paramCheck.expected}, mapeados ${paramCheck.provided}.`,
            });
        }
    }

    const cats = [
        ...new Set(
            parts.map((p) =>
                String(p.templateCategory || "MARKETING").toUpperCase()
            )
        ),
    ];
    const purpose = String(opts.purpose || "").toLowerCase();
    if (
        purpose === "utility" &&
        cats.some((c) => c === "MARKETING") &&
        !opts.confirmMarketingWithUtilityPurpose
    ) {
        issues.push({
            level: "warning",
            code: "purpose_category_mismatch",
            message:
                "Finalidade Utilidade com template(s) MARKETING: a Meta enviará na categoria MARKETING aprovada (não reclassificamos UTILITY). Confirme na Etapa 5 ou selecione templates UTILITY.",
        });
    }

    const langs = [
        ...new Set(
            parts.map((p) => String(p.templateLanguage || "").trim()).filter(Boolean)
        ),
    ];
    if (langs.length > 1) {
        issues.push({
            level: "warning",
            code: "mixed_languages",
            message: `Idiomas mistos na sequência (${langs.join(", ")}). Cada mensagem usará o idioma aprovado do respectivo template — sem conversão automática.`,
        });
    }

    const hasError = issues.some((i) => i.level === "error");
    const hasWarn = issues.some((i) => i.level === "warning");
    return {
        ok: !hasError,
        status: hasError ? "blocked" : hasWarn ? "attention" : "ready",
        issues,
    };
}
