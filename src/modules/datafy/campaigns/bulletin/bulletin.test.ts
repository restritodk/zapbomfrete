import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeBulletin, estimateMessageTotal } from "./analyze";
import {
    composeReusableBulletinParts,
    allPartsReadyForRealSend,
    libraryApprovalChecklist,
} from "./templates";
import { BULLETIN_TEMPLATE_LIBRARY, sanitizeTemplateParam } from "./library";
import { META_TEMPLATE_BODY_MAX } from "./types";

const SAMPLE_SEP = "────────────────────";

function makeLoad(n: number, extra = ""): string {
    return [
        `🚛 Carga ${n}`,
        `Origem: Cidade A${n}`,
        `Destino: Cidade B${n}`,
        `Terminal: Porto ${n}`,
        `Lote: L${n}00`,
        `Localização: https://maps.app.goo.gl/abc${n}`,
        `Grupo: https://chat.whatsapp.com/Invite${n}`,
        `Pedágio: Tag OK`,
        extra,
    ].join("\n");
}

function approvedLibTemplates() {
    return BULLETIN_TEMPLATE_LIBRARY.map((s) => ({
        name: s.preferredName,
        language: "pt_BR",
        status: "APPROVED",
        category: "MARKETING",
        components: [{ type: "BODY", text: s.bodyTextForApproval }],
    }));
}

describe("Bulletin analyzer — single & multi load", () => {
    it("parses one load with links and emojis", () => {
        const raw = [
            "ATUALIZAÇÃO DE EMBARQUE COTTON ✅",
            SAMPLE_SEP,
            makeLoad(1),
        ].join("\n");
        const a = analyzeBulletin(raw);
        assert.equal(a.loadCount, 1);
        assert.match(a.loads[0].fields.origem || "", /Cidade A1/);
        assert.ok(a.loads[0].fields.localizacaoUrl);
        assert.ok(a.loads[0].fields.grupoUrl || a.loads[0].fields.detalhes);
    });

    it("splits six loads preserving order", () => {
        const chunks = ["ATUALIZAÇÃO DE EMBARQUE COTTON"];
        for (let i = 1; i <= 6; i++) {
            chunks.push(SAMPLE_SEP, makeLoad(i));
        }
        const a = analyzeBulletin(chunks.join("\n"));
        assert.equal(a.loadCount, 6);
        assert.ok(a.loads[0].index < a.loads[5].index);
    });

    it("flags individual load over Meta body limit without truncating source", () => {
        const huge = "X".repeat(META_TEMPLATE_BODY_MAX + 50);
        const raw = ["TITULO", SAMPLE_SEP, `🚛 Over\n${huge}`].join("\n");
        const a = analyzeBulletin(raw);
        assert.equal(a.loads[0].exceedsLimit, true);
        assert.ok(a.loads[0].text.includes(huge.slice(0, 20)));
    });

    it("estimates total messages", () => {
        assert.equal(estimateMessageTotal(100, 3), 300);
    });
});

describe("Reusable bulletin templates (6G)", () => {
    it("packs 6 loads into 2 parts of 3 with boletim_3_cargas", () => {
        const chunks = ["BOLETIM COTTON"];
        for (let i = 1; i <= 6; i++) {
            chunks.push(SAMPLE_SEP, makeLoad(i));
        }
        const a = analyzeBulletin(chunks.join("\n"));
        const parts = composeReusableBulletinParts(a, approvedLibTemplates(), {
            purpose: "marketing",
        });
        assert.equal(parts.length, 2);
        assert.equal(parts[0].loadIndexes.length, 3);
        assert.equal(parts[1].loadIndexes.length, 3);
        assert.ok(
            parts[0].templateName === "boletim_v3_3_cargas" ||
                parts[0].templateName === "boletim_v2_3_cargas" ||
                parts[0].templateName === "boletim_3_cargas"
        );
        assert.equal(parts[0].readyForRealSend, true);
        assert.ok(
            (parts[0].variableMapping?.body?.length || 0) >= 18
        );
        assert.match(parts[0].bodyText, /Cidade A1/);
        assert.match(parts[1].bodyText, /Cidade A4/);
        assert.equal(allPartsReadyForRealSend(parts), true);
    });

    it("uses boletim_1_carga when only 1-load template is approved", () => {
        const a = analyzeBulletin(
            ["T", SAMPLE_SEP, makeLoad(1), SAMPLE_SEP, makeLoad(2)].join("\n")
        );
        const onlyOne = approvedLibTemplates().filter(
            (t) => t.name === "boletim_1_carga"
        );
        const parts = composeReusableBulletinParts(a, onlyOne);
        assert.equal(parts.length, 2);
        assert.ok(parts.every((p) => p.templateName === "boletim_1_carga"));
        assert.ok(parts.every((p) => p.variableMapping?.body?.length === 7));
    });

    it("blocks when no library template is approved", () => {
        const a = analyzeBulletin(["T", SAMPLE_SEP, makeLoad(1)].join("\n"));
        const parts = composeReusableBulletinParts(a, []);
        assert.equal(parts[0].readyForRealSend, false);
        assert.equal(parts[0].compatibility, "missing_template");
        assert.match(
            parts[0].blockReason || "",
            /biblioteca gerenciada|boletim_/i
        );
    });

    it("does not require re-approval when only variable values change", () => {
        const day1 = analyzeBulletin(
            ["T", SAMPLE_SEP, makeLoad(1, "dia 1")].join("\n")
        );
        const day2 = analyzeBulletin(
            ["T", SAMPLE_SEP, makeLoad(1, "dia 2")].join("\n")
        );
        const t = approvedLibTemplates();
        const p1 = composeReusableBulletinParts(day1, t)[0];
        const p2 = composeReusableBulletinParts(day2, t)[0];
        assert.equal(p1.templateName, p2.templateName);
        assert.equal(p1.libraryTemplateId, p2.libraryTemplateId);
        assert.notEqual(
            p1.variableMapping?.body?.join("|"),
            p2.variableMapping?.body?.join("|")
        );
    });

    it("sanitizes params and checklist lists v1+v2+v3 reusable models", () => {
        assert.equal(sanitizeTemplateParam(""), "N/D");
        assert.equal(sanitizeTemplateParam("a\nb"), "a · b");
        const list = libraryApprovalChecklist();
        assert.equal(list.length, 9);
        assert.ok(list.every((x) => x.recommendedCategory === "MARKETING"));
        assert.ok(list.some((x) => x.generation === 2));
        assert.ok(list.some((x) => x.generation === 3));
    });

    it("warns when only UTILITY templates exist for marketing purpose", () => {
        const a = analyzeBulletin(["T", SAMPLE_SEP, makeLoad(1)].join("\n"));
        const util = approvedLibTemplates().map((t) => ({
            ...t,
            category: "UTILITY",
        }));
        const parts = composeReusableBulletinParts(a, util, {
            purpose: "marketing",
        });
        assert.ok(parts[0].policyWarning);
    });
});
