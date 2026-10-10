-- DatafyManagedTemplate — local bulletin template manager
-- Additive only. Does not touch Meta/Datafy remote templates.

CREATE TABLE IF NOT EXISTS "DatafyManagedTemplate" (
    "id" TEXT NOT NULL,
    "organizationKey" TEXT NOT NULL DEFAULT 'default',
    "kind" TEXT NOT NULL,
    "builtinId" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "technicalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'MARKETING',
    "language" TEXT NOT NULL DEFAULT 'pt_BR',
    "headerText" TEXT,
    "bodyText" TEXT NOT NULL,
    "footerText" TEXT,
    "fieldMappings" JSONB NOT NULL,
    "exampleRow" JSONB NOT NULL,
    "loadsPerMessage" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "remoteStatus" TEXT,
    "remoteTemplateId" TEXT,
    "remoteRejectedReason" TEXT,
    "lastSubmittedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DatafyManagedTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DatafyManagedTemplate_organizationKey_technicalName_key"
    ON "DatafyManagedTemplate"("organizationKey", "technicalName");
CREATE INDEX IF NOT EXISTS "DatafyManagedTemplate_organizationKey_kind_hidden_idx"
    ON "DatafyManagedTemplate"("organizationKey", "kind", "hidden");
CREATE INDEX IF NOT EXISTS "DatafyManagedTemplate_organizationKey_builtinId_idx"
    ON "DatafyManagedTemplate"("organizationKey", "builtinId");
CREATE INDEX IF NOT EXISTS "DatafyManagedTemplate_deletedAt_idx"
    ON "DatafyManagedTemplate"("deletedAt");

DO $$ BEGIN
    ALTER TABLE "DatafyManagedTemplate"
        ADD CONSTRAINT "DatafyManagedTemplate_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
