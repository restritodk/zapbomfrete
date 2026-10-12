-- ZapBomFrete — Bulletin grouping / versioning / cards
-- Apply manually in production (do NOT auto-run on VPS from this change).
-- Safe: additive only — does not drop or rename existing templates.

-- Campaign extensions
ALTER TABLE "DatafyCampaign"
  ADD COLUMN IF NOT EXISTS "bulletinVersionId" TEXT,
  ADD COLUMN IF NOT EXISTS "bulletinSendMode" TEXT,
  ADD COLUMN IF NOT EXISTS "bulletinCardPosition" INTEGER,
  ADD COLUMN IF NOT EXISTS "totalMessagesPlanned" INTEGER NOT NULL DEFAULT 0;

-- Draft link
ALTER TABLE "DatafyBulletinDraft"
  ADD COLUMN IF NOT EXISTS "bulletinVersionId" TEXT;

-- Managed template soft hint
ALTER TABLE "DatafyManagedTemplate"
  ADD COLUMN IF NOT EXISTS "suggestedBundleKey" TEXT;

CREATE TABLE IF NOT EXISTS "DatafyBulletinBundle" (
  "id" TEXT PRIMARY KEY,
  "organizationKey" TEXT NOT NULL DEFAULT 'default',
  "publicKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "latestVersion" INTEGER NOT NULL DEFAULT 1,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DatafyBulletinBundle_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "DatafyBulletinBundle_organizationKey_publicKey_key"
  ON "DatafyBulletinBundle"("organizationKey", "publicKey");
CREATE INDEX IF NOT EXISTS "DatafyBulletinBundle_organizationKey_updatedAt_idx"
  ON "DatafyBulletinBundle"("organizationKey", "updatedAt");
CREATE INDEX IF NOT EXISTS "DatafyBulletinBundle_slug_idx"
  ON "DatafyBulletinBundle"("slug");

CREATE TABLE IF NOT EXISTS "DatafyBulletinVersion" (
  "id" TEXT PRIMARY KEY,
  "organizationKey" TEXT NOT NULL DEFAULT 'default',
  "bundleId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "rawText" TEXT NOT NULL,
  "loads" JSONB,
  "loadCount" INTEGER NOT NULL DEFAULT 0,
  "cardCount" INTEGER NOT NULL DEFAULT 0,
  "language" TEXT NOT NULL DEFAULT 'pt_BR',
  "category" TEXT NOT NULL DEFAULT 'MARKETING',
  "approvalStatus" TEXT NOT NULL DEFAULT 'draft',
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DatafyBulletinVersion_bundleId_fkey"
    FOREIGN KEY ("bundleId") REFERENCES "DatafyBulletinBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DatafyBulletinVersion_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "DatafyBulletinVersion_bundleId_version_key"
  ON "DatafyBulletinVersion"("bundleId", "version");
CREATE INDEX IF NOT EXISTS "DatafyBulletinVersion_organizationKey_approvalStatus_idx"
  ON "DatafyBulletinVersion"("organizationKey", "approvalStatus");
CREATE INDEX IF NOT EXISTS "DatafyBulletinVersion_organizationKey_isCurrent_updatedAt_idx"
  ON "DatafyBulletinVersion"("organizationKey", "isCurrent", "updatedAt");
CREATE INDEX IF NOT EXISTS "DatafyBulletinVersion_createdAt_idx"
  ON "DatafyBulletinVersion"("createdAt");

CREATE TABLE IF NOT EXISTS "DatafyBulletinCard" (
  "id" TEXT PRIMARY KEY,
  "versionId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "loadIndexes" JSONB NOT NULL,
  "loadSummary" TEXT,
  "bodyPreview" TEXT,
  "libraryTemplateId" TEXT,
  "technicalName" TEXT,
  "displayName" TEXT,
  "language" TEXT NOT NULL DEFAULT 'pt_BR',
  "category" TEXT NOT NULL DEFAULT 'MARKETING',
  "approvalStatus" TEXT NOT NULL DEFAULT 'DRAFT',
  "managedTemplateId" TEXT,
  "remoteTemplateId" TEXT,
  "lastSubmittedAt" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3),
  "variableMapping" JSONB,
  "templateComponents" JSONB,
  "associationSource" TEXT NOT NULL DEFAULT 'compose',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DatafyBulletinCard_versionId_fkey"
    FOREIGN KEY ("versionId") REFERENCES "DatafyBulletinVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DatafyBulletinCard_managedTemplateId_fkey"
    FOREIGN KEY ("managedTemplateId") REFERENCES "DatafyManagedTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "DatafyBulletinCard_versionId_position_key"
  ON "DatafyBulletinCard"("versionId", "position");
CREATE INDEX IF NOT EXISTS "DatafyBulletinCard_managedTemplateId_idx"
  ON "DatafyBulletinCard"("managedTemplateId");
CREATE INDEX IF NOT EXISTS "DatafyBulletinCard_technicalName_language_idx"
  ON "DatafyBulletinCard"("technicalName", "language");
CREATE INDEX IF NOT EXISTS "DatafyBulletinCard_approvalStatus_idx"
  ON "DatafyBulletinCard"("approvalStatus");

-- FKs on existing tables (idempotent-ish: ignore errors if already present)
DO $$ BEGIN
  ALTER TABLE "DatafyCampaign"
    ADD CONSTRAINT "DatafyCampaign_bulletinVersionId_fkey"
    FOREIGN KEY ("bulletinVersionId") REFERENCES "DatafyBulletinVersion"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DatafyBulletinDraft"
    ADD CONSTRAINT "DatafyBulletinDraft_bulletinVersionId_fkey"
    FOREIGN KEY ("bulletinVersionId") REFERENCES "DatafyBulletinVersion"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "DatafyCampaign_bulletinVersionId_idx"
  ON "DatafyCampaign"("bulletinVersionId");
CREATE INDEX IF NOT EXISTS "DatafyBulletinDraft_bulletinVersionId_idx"
  ON "DatafyBulletinDraft"("bulletinVersionId");
CREATE INDEX IF NOT EXISTS "DatafyManagedTemplate_suggestedBundleKey_idx"
  ON "DatafyManagedTemplate"("suggestedBundleKey");

-- NOTE: Existing APPROVED templates (boletim_v3_*, atualizao_de_embarque_*)
-- are preserved untouched. Associate via admin UI or compose flow — never
-- auto-resubmit to Meta.
