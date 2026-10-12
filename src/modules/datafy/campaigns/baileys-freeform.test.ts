import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    phoneDigitsFromJid,
    phonesReferToSameLine,
} from "./baileys-freeform";

describe("Baileys session match for the Datafy number", () => {
    it("reads the phone from a multi-device JID", () => {
        assert.equal(
            phoneDigitsFromJid("556699563997:14@s.whatsapp.net"),
            "556699563997"
        );
    });

    it("treats the 9th digit as the same Brazilian line", () => {
        assert.equal(
            phonesReferToSameLine("+55 66 9956-3997", "556699563997"),
            true
        );
        assert.equal(
            phonesReferToSameLine("5566999563997", "556699563997"),
            true
        );
        assert.equal(
            phonesReferToSameLine("556699563997", "5584998080781"),
            false
        );
    });
});
