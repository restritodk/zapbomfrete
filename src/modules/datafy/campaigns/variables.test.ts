import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    buildTemplateComponents,
    prepareTemplateBodyFromCopy,
    renderCampaignFreeform,
    renderCampaignPreview,
    resolveRecipientDisplayName,
} from "./variables";

const EMOJIS = ["👋", "✅", "🚚", "📦", "⭐", "🔥", "💪", "📍", "⏰", "🎉"];

describe("campaign variables — recipient vs sender", () => {
    it("resolves Paulo / Bom Frete Transportes / Rondonópolis / MT with emojis", () => {
        const raw = `Olá, {{fullName}}! 👋

Aqui é da {{company}}. 🚚

Estamos enviando oportunidades de frete de {{city}} - {{state}}. 📦

Se precisar, estamos à disposição! ✅`;

        const out = renderCampaignFreeform(raw, {
            recipient: { fullName: "Paulo", waId: "5566999999999" },
            sender: {
                company: "Bom Frete Transportes",
                city: "Rondonópolis",
                state: "MT",
            },
        });

        assert.equal(
            out,
            `Olá, Paulo! 👋

Aqui é da Bom Frete Transportes. 🚚

Estamos enviando oportunidades de frete de Rondonópolis - MT. 📦

Se precisar, estamos à disposição! ✅`
        );
        for (const e of ["👋", "🚚", "📦", "✅"]) {
            assert.ok(out.includes(e), `emoji ${e} preserved`);
        }
    });

    it("fullName uses WhatsApp profile name when CRM name missing", () => {
        assert.equal(
            resolveRecipientDisplayName({
                fullName: null,
                waProfileName: "Paulo",
            }),
            "Paulo"
        );
        assert.equal(
            resolveRecipientDisplayName({
                fullName: "",
                waProfileName: "Usuário desconhecido",
            }),
            ""
        );
    });

    it("does not use recipient city/company for sender tokens", () => {
        const out = renderCampaignFreeform(
            "{{fullName}} · {{company}} · {{city}} · {{state}}",
            {
                recipient: {
                    fullName: "Paulo",
                    company: "Empresa do Cliente",
                    city: "São Paulo",
                    state: "SP",
                },
                sender: {
                    company: "Bom Frete Transportes",
                    city: "Rondonópolis",
                    state: "MT",
                },
            }
        );
        assert.equal(out, "Paulo · Bom Frete Transportes · Rondonópolis · MT");
        assert.ok(!out.includes("São Paulo"));
        assert.ok(!out.includes("Empresa do Cliente"));
    });

    it("missing values become empty without throwing", () => {
        const out = renderCampaignFreeform(
            "Olá {{fullName}} da {{company}} em {{city}}-{{state}}",
            { recipient: {}, sender: {} }
        );
        assert.equal(out, "Olá  da  em -");
    });

    it("preserves all editor emojis with variables", () => {
        const raw = EMOJIS.map((e, i) => `${e} {{fullName}}`).join(" ");
        const out = renderCampaignFreeform(raw, {
            recipient: { fullName: "Paulo" },
            sender: {},
        });
        for (const e of EMOJIS) {
            assert.ok(out.includes(e));
        }
        assert.equal((out.match(/Paulo/g) || []).length, EMOJIS.length);
    });

    it("preview helper matches sample data", () => {
        const text = renderCampaignPreview(
            "Olá, {{fullName}}! Aqui é da {{company}}. {{city}}-{{state}} 📍",
            {
                sender: {
                    company: "Bom Frete Transportes",
                    city: "Rondonópolis",
                    state: "MT",
                },
            }
        );
        assert.equal(
            text,
            "Olá, Paulo! Aqui é da Bom Frete Transportes. Rondonópolis-MT 📍"
        );
    });

    it("template components use sender company not recipient company", () => {
        const comps = buildTemplateComponents(
            { body: ["fullName", "company", "city", "state"] },
            {
                recipient: {
                    fullName: "Paulo",
                    company: "Cliente SA",
                    city: "Cuiabá",
                    state: "MT",
                },
                sender: {
                    company: "Bom Frete Transportes",
                    city: "Rondonópolis",
                    state: "MT",
                },
            }
        ) as Array<{ parameters: Array<{ text: string }> }>;
        assert.deepEqual(
            comps[0].parameters.map((p) => p.text),
            ["Paulo", "Bom Frete Transportes", "Rondonópolis", "MT"]
        );
    });

    it("prepareTemplateBodyFromCopy keeps emoji examples order", () => {
        const prepared = prepareTemplateBodyFromCopy(
            "Olá {{fullName}} da {{company}} 🚚"
        );
        assert.ok(prepared.bodyText.includes("{{1}}"));
        assert.ok(prepared.bodyText.includes("{{2}}"));
        assert.ok(prepared.bodyText.includes("🚚"));
        assert.deepEqual(prepared.bodyTokens, ["fullName", "company"]);
    });
});
