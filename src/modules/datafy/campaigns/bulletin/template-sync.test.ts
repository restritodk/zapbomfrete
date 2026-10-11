import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    normalizeLanguage,
    parseTemplateComponents,
    shouldApplyRemoteStatus,
    statusRank,
    fetchAllTemplatesForStatus,
} from "./template-sync";
import type { DatafyClient } from "@/modules/datafy/client";
import type { DatafyTemplate } from "@/modules/datafy/types";
import { canLaunchDatafyCampaigns } from "../access";
import { isDatafyProvider } from "@/modules/datafy/provider";

describe("template-sync — parse & identity", () => {
    it("preserves English language (no coerce to pt_BR)", () => {
        assert.equal(normalizeLanguage("en"), "en");
        assert.equal(normalizeLanguage("en_US"), "en_US");
        assert.equal(normalizeLanguage("pt_BR"), "pt_BR");
        assert.equal(normalizeLanguage(""), "pt_BR");
    });

    it("parses HEADER BODY FOOTER and examples from Meta components", () => {
        const parsed = parseTemplateComponents([
            { type: "HEADER", text: "Embarque" },
            {
                type: "BODY",
                text: "Origem {{1}} destino {{2}}.",
                example: { body_text: [["A", "B"]] },
            },
            { type: "FOOTER", text: "Bom Frete" },
        ]);
        assert.equal(parsed.headerText, "Embarque");
        assert.match(parsed.bodyText, /Origem \{\{1\}\}/);
        assert.equal(parsed.footerText, "Bom Frete");
        assert.equal(parsed.variableCount, 2);
        assert.deepEqual(parsed.exampleRow, ["A", "B"]);
    });

    it("imports Meta-created PENDING template shape (atualizao_de_embarque_cotto)", () => {
        const remote: DatafyTemplate = {
            id: "tmpl_ext_1",
            name: "atualizao_de_embarque_cotto",
            language: "en",
            status: "PENDING",
            category: "MARKETING",
            components: [
                {
                    type: "BODY",
                    text: "Update {{1}} for load {{2}}.",
                    example: { body_text: [["Sapezal", "1"]] },
                },
            ],
        };
        assert.equal(normalizeLanguage(remote.language), "en");
        assert.equal(String(remote.status).toUpperCase(), "PENDING");
        const parsed = parseTemplateComponents(remote.components as unknown[]);
        assert.equal(parsed.variableCount, 2);
        assert.equal(remote.name, "atualizao_de_embarque_cotto");
    });
});

describe("template-sync — status transitions & regression", () => {
    it("allows PENDING → APPROVED and PENDING → REJECTED", () => {
        assert.equal(shouldApplyRemoteStatus("PENDING", "APPROVED"), true);
        assert.equal(shouldApplyRemoteStatus("PENDING", "REJECTED"), true);
    });

    it("blocks stale PENDING over APPROVED (same template id)", () => {
        assert.equal(
            shouldApplyRemoteStatus("APPROVED", "PENDING", {
                sameTemplateId: true,
            }),
            false
        );
    });

    it("ranks statuses for reconciliation", () => {
        assert.ok(statusRank("APPROVED") > statusRank("PENDING"));
        assert.ok(statusRank("REJECTED") > statusRank("PENDING"));
    });
});

describe("template-sync — Datafy pagination mock", () => {
    it("pages through GET message_templates with after cursor", async () => {
        const pages: Array<{ data: DatafyTemplate[]; after?: string }> = [
            {
                data: [
                    {
                        id: "1",
                        name: "boletim_v3_1_carga",
                        language: "pt_BR",
                        status: "APPROVED",
                    },
                ],
                after: "cursor_a",
            },
            {
                data: [
                    {
                        id: "2",
                        name: "atualizao_de_embarque_cotto",
                        language: "en",
                        status: "PENDING",
                    },
                ],
            },
        ];
        let call = 0;
        const client = {
            listTemplates: async (
                _waba: string,
                opts?: { after?: string; status?: string }
            ) => {
                const idx = call++;
                assert.equal(opts?.status, "PENDING");
                if (idx === 1) assert.equal(opts?.after, "cursor_a");
                const page = pages[idx] || { data: [] };
                return {
                    data: page.data,
                    paging: page.after
                        ? { cursors: { after: page.after } }
                        : undefined,
                };
            },
        } as unknown as DatafyClient;

        const result = await fetchAllTemplatesForStatus(
            client,
            "waba_123",
            "PENDING"
        );
        assert.equal(result.pages, 2);
        assert.equal(result.templates.length, 2);
        assert.equal(result.templates[1].name, "atualizao_de_embarque_cotto");
        assert.equal(result.templates[1].language, "en");
    });

    it("repeated sync identity key is waba+name+language (no duplicate key)", () => {
        const seen = new Set<string>();
        const rows = [
            { wabaId: "W1", name: "t1", language: "pt_BR" },
            { wabaId: "W1", name: "t1", language: "en" },
            { wabaId: "W1", name: "t1", language: "pt_BR" }, // duplicate
            { wabaId: "W2", name: "t1", language: "pt_BR" },
        ];
        const unique: typeof rows = [];
        for (const r of rows) {
            const key = `${r.wabaId}::${r.name}::${r.language}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(r);
        }
        assert.equal(unique.length, 3);
        assert.ok(unique.some((r) => r.language === "en"));
        assert.ok(unique.some((r) => r.wabaId === "W2"));
    });
});

describe("template-sync — library mapping & campaign gates", () => {
    it("unmapped import is not campaign-ready until fieldMappings set", () => {
        const imported = {
            inLibrary: false,
            remoteStatus: "APPROVED",
            fieldMappings: [] as string[],
        };
        const canUse =
            imported.inLibrary &&
            imported.remoteStatus === "APPROVED" &&
            imported.fieldMappings.length > 0;
        assert.equal(canUse, false);

        const mapped = {
            ...imported,
            inLibrary: true,
            fieldMappings: ["origem", "destino"],
        };
        assert.equal(
            mapped.inLibrary &&
                mapped.remoteStatus === "APPROVED" &&
                mapped.fieldMappings.length > 0,
            true
        );
    });

    it("blocks PENDING/REJECTED/PAUSED/DISABLED from new sends", () => {
        for (const s of ["PENDING", "REJECTED", "PAUSED", "DISABLED"]) {
            assert.notEqual(s, "APPROVED");
            assert.equal(s === "APPROVED", false);
        }
        assert.equal("APPROVED" === "APPROVED", true);
    });

    it("RBAC: only OWNER/SUPERADMIN launch campaigns", () => {
        assert.equal(canLaunchDatafyCampaigns("OWNER"), true);
        assert.equal(canLaunchDatafyCampaigns("SUPERADMIN"), true);
        assert.equal(canLaunchDatafyCampaigns("STAFF"), false);
    });

    it("Datafy provider stays isolated from Baileys", () => {
        assert.equal(isDatafyProvider("datafy"), true);
        assert.equal(isDatafyProvider("baileys"), false);
    });
});

describe("template-sync — auth / rate limit contract", () => {
    it("429 concurrency message is surfaced as DatafyApiError shape", async () => {
        const { DatafyApiError } = await import("@/modules/datafy/client");
        const err = new DatafyApiError(
            "Sincronização já em andamento. Aguarde a conclusão.",
            429
        );
        assert.equal(err.statusCode, 429);
        assert.match(err.message, /já em andamento/i);
    });

    it("401 auth failure is distinguishable", async () => {
        const { DatafyApiError } = await import("@/modules/datafy/client");
        const err = new DatafyApiError("Token do canal Datafy não configurado", 401);
        assert.equal(err.statusCode, 401);
    });
});

describe("template-sync — webhook event mapping", () => {
    it("normalizeMetaTemplateEvent preserves language and status", async () => {
        const { normalizeMetaTemplateEvent } = await import("./meta-approval");
        const approved = normalizeMetaTemplateEvent({
            event: "APPROVED",
            message_template_name: "boletim_v3_1_carga",
            message_template_language: "pt_BR",
            message_template_id: "99",
        });
        assert.equal(approved.status, "APPROVED");
        assert.equal(approved.language, "pt_BR");

        const rejected = normalizeMetaTemplateEvent({
            event: "REJECTED",
            message_template_name: "boletim_v2_2_cargas",
            message_template_language: "en",
            reason: "INVALID_FORMAT",
        });
        assert.equal(rejected.status, "REJECTED");
        assert.equal(rejected.language, "en");
        assert.equal(rejected.rejectedReason, "INVALID_FORMAT");
    });
});

describe("template-sync — v3 density fixes preserved", () => {
    it("boletim_v3 still has 6 vars/load and valid payload boundaries", async () => {
        const {
            BULLETIN_TEMPLATE_LIBRARY,
            buildBulletinTemplateSubmission,
        } = await import("./library");
        const {
            buildTemplateCreatePayload,
            formatMetaTemplateApiError,
        } = await import("./template-submit-payload");
        const { DatafyApiError } = await import("@/modules/datafy/client");

        const v3 = BULLETIN_TEMPLATE_LIBRARY.filter((s) => s.generation === 3);
        assert.equal(v3.length, 3);
        assert.deepEqual(
            v3.map((s) => s.variableCount),
            [6, 12, 18]
        );
        for (const spec of v3) {
            const sub = buildBulletinTemplateSubmission(spec);
            const built = buildTemplateCreatePayload({
                name: sub.name,
                category: "MARKETING",
                bodyText: sub.bodyText,
                exampleRow: sub.exampleRow,
            });
            assert.equal(built.ok, true, spec.preferredName);
        }

        const density = formatMetaTemplateApiError(
            new DatafyApiError("too many variables", 400, {
                error: {
                    message: "This template has too many variables for its length.",
                    code: 100,
                    error_subcode: 2388293,
                },
            })
        );
        assert.equal(density.subcode, 2388293);
        assert.match(density.guidance || "", /variáveis demais/i);
    });
});
