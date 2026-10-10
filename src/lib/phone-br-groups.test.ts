import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    classifyGroupParticipants,
    extractPhonesFromParticipants,
} from "./phone-br";

describe("Group participant classification", () => {
    it("extracts phones and ignores LIDs", () => {
        const stats = classifyGroupParticipants([
            { id: "123456789012345@lid" },
            { id: "5511999887766@s.whatsapp.net" },
            {
                id: "999@lid",
                phoneNumber: "5511888777666@s.whatsapp.net",
            },
            { id: "5511999887766@s.whatsapp.net" },
        ]);
        assert.equal(stats.uniquePhoneCount, 2);
        assert.ok(stats.phones.includes("5511999887766"));
        assert.ok(stats.phones.includes("5511888777666"));
        assert.ok(stats.lidOnly >= 1);
        assert.ok(stats.duplicates >= 1);
        assert.deepEqual(
            extractPhonesFromParticipants([
                { id: "5511912345678@s.whatsapp.net" },
            ]),
            ["5511912345678"]
        );
    });

    it("does not treat bare LID digits as phones", () => {
        const stats = classifyGroupParticipants([
            "123456789012345@lid",
            "not-a-phone",
        ]);
        assert.equal(stats.uniquePhoneCount, 0);
        assert.ok(stats.lidOnly >= 1);
    });
});
