-- Additive migration: Meta Approvals Center + bidirectional Datafy sync
-- Safe to re-run. Preserves existing DatafyManagedTemplate rows.

-- New columns on DatafyManagedTemplate
ALTER TABLE "DatafyManagedTemplate" ADD COLUMN IF NOT EXISTS "wabaId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "DatafyManagedTemplate" ADD COLUMN IF NOT EXISTS "componentsJson" JSONB;
ALTER TABLE "DatafyManagedTemplate" ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "DatafyManagedTemplate" ADD COLUMN IF NOT EXISTS "inLibrary" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DatafyManagedTemplate" ADD COLUMN IF NOT EXISTS "lastSyncedAt" TIMESTAMP(3);
ALTER TABLE "DatafyManagedTemplate" ADD COLUMN IF NOT EXISTS "lastNotifiedStatus" TEXT;
ALTER TABLE "DatafyManagedTemplate" ADD COLUMN IF NOT EXISTS "syncError" TEXT;

-- Mark existing builtins/customs as library-ready; origin local when previously submitted
UPDATE "DatafyManagedTemplate"
SET "inLibrary" = true
WHERE "inLibrary" = false
  AND ("kind" = 'builtin' OR "kind" = 'custom');

UPDATE "DatafyManagedTemplate"
SET "origin" = 'local'
WHERE "origin" = 'unknown'
  AND "lastSubmittedAt" IS NOT NULL;

-- Replace unique (org, technicalName) → (org, wabaId, technicalName, language)
DROP INDEX IF EXISTS "DatafyManagedTemplate_organizationKey_technicalName_key";

CREATE UNIQUE INDEX IF NOT EXISTS "DatafyManagedTemplate_organizationKey_wabaId_technicalName_language_key"
    ON "DatafyManagedTemplate"("organizationKey", "wabaId", "technicalName", "language");

CREATE INDEX IF NOT EXISTS "DatafyManagedTemplate_organizationKey_wabaId_remoteStatus_idx"
    ON "DatafyManagedTemplate"("organizationKey", "wabaId", "remoteStatus");

CREATE INDEX IF NOT EXISTS "DatafyManagedTemplate_remoteTemplateId_idx"
    ON "DatafyManagedTemplate"("remoteTemplateId");

-- Sync state table
CREATE TABLE IF NOT EXISTS "DatafyTemplateSyncState" (
    "id" TEXT NOT NULL,
    "organizationKey" TEXT NOT NULL DEFAULT 'default',
    "wabaId" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "lockOwner" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "lastSyncStats" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DatafyTemplateSyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DatafyTemplateSyncState_organizationKey_wabaId_key"
    ON "DatafyTemplateSyncState"("organizationKey", "wabaId");

CREATE INDEX IF NOT EXISTS "DatafyTemplateSyncState_lastSyncAt_idx"
    ON "DatafyTemplateSyncState"("lastSyncAt");
