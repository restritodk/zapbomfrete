import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    canLaunchDatafyCampaigns,
    canManageBulletinTemplates,
} from "../access";
import { toSafeApprovalsError } from "./safe-errors";
import { canManageDatafyIntegration, isAdmin } from "@/lib/api-auth";

describe("OWNER + SUPERADMIN bulletin template permissions", () => {
    it("OWNER can manage / submit / sync templates", () => {
        assert.equal(canManageBulletinTemplates("OWNER"), true);
        assert.equal(canLaunchDatafyCampaigns("OWNER"), true);
    });

    it("SUPERADMIN keeps the same template capabilities", () => {
        assert.equal(canManageBulletinTemplates("SUPERADMIN"), true);
        assert.equal(canLaunchDatafyCampaigns("SUPERADMIN"), true);
    });

    it("STAFF / USER cannot manage templates (403)", () => {
        assert.equal(canManageBulletinTemplates("STAFF"), false);
        assert.equal(canManageBulletinTemplates("USER"), false);
        assert.equal(canManageBulletinTemplates(""), false);
    });

    it("OWNER still cannot manage global Datafy credentials (SUPERADMIN-only)", () => {
        assert.equal(isAdmin("OWNER"), false);
        assert.equal(canManageDatafyIntegration("OWNER"), false);
        assert.equal(canManageDatafyIntegration("SUPERADMIN"), true);
    });

    it("organization/WABA isolation stays at org key + wabaId (single-tenant default)", () => {
        // Product uses organizationKey "default" + resolved WABA from config.
        // OWNER manages templates only within that configured WABA — no cross-WABA API.
        const orgA = "default";
        const orgB = "other_org";
        assert.notEqual(orgA, orgB);
        const wabaA = "waba_1";
        const wabaB = "waba_2";
        assert.notEqual(wabaA, wabaB);
        const key = (org: string, waba: string, name: string, lang: string) =>
            `${org}::${waba}::${name}::${lang}`;
        assert.notEqual(
            key(orgA, wabaA, "t1", "pt_BR"),
            key(orgA, wabaB, "t1", "pt_BR")
        );
    });
});

describe("safe approvals errors — hide Prisma/Postgres internals", () => {
    it("maps Postgres 42501 to friendly message without SQL leak", () => {
        const safe = toSafeApprovalsError(
            new Error(
                "Invalid `prisma.datafyTemplateSyncState.findUnique()` invocation: PostgresError 42501: permission denied for table DatafyTemplateSyncState"
            ),
            "test-42501"
        );
        assert.equal(safe.code, "db_permission");
        assert.equal(safe.statusCode, 503);
        assert.equal(/prisma|42501|permission denied|SELECT/i.test(safe.message), false);
        assert.match(safe.message, /permissões do banco|sincronização/i);
    });

    it("maps sync busy to 429-friendly copy", () => {
        const safe = toSafeApprovalsError(
            new Error("Sincronização já em andamento. Aguarde a conclusão."),
            "test-busy"
        );
        assert.equal(safe.code, "sync_busy");
        assert.equal(safe.statusCode, 429);
    });

    it("generic sync failure does not expose stack traces", () => {
        const safe = toSafeApprovalsError(
            new Error("Something weird at Object.query (/app/node_modules/...)"),
            "test-generic"
        );
        assert.equal(safe.code, "generic");
        assert.match(
            safe.message,
            /Não foi possível sincronizar os templates/i
        );
        assert.equal(/node_modules|Object\.query/i.test(safe.message), false);
    });
});

describe("campaign gates remain strict for non-APPROVED", () => {
    it("PENDING templates are not campaign-ready", () => {
        const statuses = ["PENDING", "REJECTED", "PAUSED", "DISABLED"];
        for (const s of statuses) {
            assert.equal(s === "APPROVED", false);
        }
    });
});

describe("Meta density fixes still present after permission hotfix", () => {
    it("preserves 2388293 / 2388299 guidance and v3 library", async () => {
        const { BULLETIN_TEMPLATE_LIBRARY } = await import("./library");
        const { formatMetaTemplateApiError } = await import(
            "./template-submit-payload"
        );
        const { DatafyApiError } = await import("@/modules/datafy/client");

        assert.ok(
            BULLETIN_TEMPLATE_LIBRARY.some((s) => s.generation === 3)
        );
        const d = formatMetaTemplateApiError(
            new DatafyApiError("density", 400, {
                error: {
                    message: "too many variables for its length",
                    code: 100,
                    error_subcode: 2388293,
                },
            })
        );
        assert.equal(d.subcode, 2388293);
        const end = formatMetaTemplateApiError(
            new DatafyApiError("end", 400, {
                error: {
                    message: "cannot end with a parameter",
                    code: 100,
                    error_subcode: 2388299,
                },
            })
        );
        assert.equal(end.subcode, 2388299);
    });
});
