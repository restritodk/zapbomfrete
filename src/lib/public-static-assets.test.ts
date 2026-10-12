import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    isPublicMediaAssetPath,
    isPublicStaticAssetPath,
    isRootStaticAssetPath,
} from "./public-static-assets";

describe("public-static-assets — login media must bypass auth", () => {
    it("allows /media login logos and background photo", () => {
        assert.equal(isPublicMediaAssetPath("/media/logo-white.png"), true);
        assert.equal(
            isPublicMediaAssetPath("/media/logo-transparent.png"),
            true
        );
        assert.equal(
            isPublicMediaAssetPath("/media/logo-principal.png"),
            true
        );
        assert.equal(isPublicMediaAssetPath("/media/imagem-login.jpg"), true);
        assert.equal(isPublicMediaAssetPath("/media/logo.png"), true);
    });

    it("rejects path traversal and non-static media paths", () => {
        assert.equal(isPublicMediaAssetPath("/media/../.env"), false);
        assert.equal(isPublicMediaAssetPath("/media/secret"), false);
        assert.equal(isPublicMediaAssetPath("/api/media/x.png"), false);
        assert.equal(isPublicMediaAssetPath("/dashboard"), false);
    });

    it("allows root static assets and branding", () => {
        assert.equal(isRootStaticAssetPath("/file.svg"), true);
        assert.equal(isRootStaticAssetPath("/media/logo.png"), false);
        assert.equal(isPublicStaticAssetPath("/branding/logo.png"), true);
        assert.equal(isPublicStaticAssetPath("/favicon.ico"), true);
        assert.equal(
            isPublicStaticAssetPath("/media/logo-transparent.png"),
            true
        );
    });

    it("case-insensitive extensions (Linux-safe basename still required)", () => {
        assert.equal(isPublicMediaAssetPath("/media/Logo-White.PNG"), true);
        assert.equal(isPublicMediaAssetPath("/media/imagem-login.JPG"), true);
    });
});
