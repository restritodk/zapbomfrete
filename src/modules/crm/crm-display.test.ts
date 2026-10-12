import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    contactDisplayName,
    contactInitials,
    crmConsentLabel,
    crmConsentTone,
    percentOf,
} from "./crm-display";

describe("crmConsentLabel", () => {
    it("maps stored statuses to friendly PT labels", () => {
        assert.equal(crmConsentLabel("granted"), "Concedido");
        assert.equal(crmConsentLabel("unknown"), "Não informado");
        assert.equal(crmConsentLabel("denied"), "Recusado");
        assert.equal(crmConsentLabel("opted_out"), "Revogado");
        assert.equal(crmConsentLabel(null), "Não informado");
    });
});

describe("crmConsentTone", () => {
    it("classifies badge tone without changing stored values", () => {
        assert.equal(crmConsentTone("granted"), "granted");
        assert.equal(crmConsentTone("unknown"), "unknown");
        assert.equal(crmConsentTone("opted_out"), "revoked");
    });
});

describe("contactDisplayName / initials", () => {
    it("never invents a name", () => {
        assert.equal(contactDisplayName(null), "Contato sem nome");
        assert.equal(contactDisplayName("  "), "Contato sem nome");
        assert.equal(contactDisplayName("Maria Silva"), "Maria Silva");
        assert.equal(contactInitials(null), "");
        assert.equal(contactInitials("Maria Silva"), "MS");
        assert.equal(contactInitials("Ana"), "AN");
    });
});

describe("percentOf", () => {
    it("formats share of total", () => {
        assert.equal(percentOf(18, 142), "12.7%");
        assert.equal(percentOf(0, 0), "0%");
    });
});
