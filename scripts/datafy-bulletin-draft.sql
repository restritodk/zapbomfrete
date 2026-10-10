-- DatafyBulletinDraft — smart freight bulletin creator
-- Safe additive migration (no DROP). Run manually or via prisma db push.

CREATE TABLE IF NOT EXISTS "DatafyBulletinDraft" (
    "id" TEXT NOT NULL,
    "organizationKey" TEXT NOT NULL DEFAULT 'default',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL,
    "operationType" TEXT,
    "groupUrl" TEXT,
    "referenceDate" TEXT,
    "generalNotes" TEXT,
    "rawText" TEXT NOT NULL,
    "loads" JSONB NOT NULL,
    "warnings" JSONB,
    "loadCount" INTEGER NOT NULL DEFAULT 0,
    "campaignId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DatafyBulletinDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DatafyBulletinDraft_organizationKey_status_idx"
    ON "DatafyBulletinDraft"("organizationKey", "status");
CREATE INDEX IF NOT EXISTS "DatafyBulletinDraft_createdAt_idx"
    ON "DatafyBulletinDraft"("createdAt");
CREATE INDEX IF NOT EXISTS "DatafyBulletinDraft_campaignId_idx"
    ON "DatafyBulletinDraft"("campaignId");

DO $$ BEGIN
    ALTER TABLE "DatafyBulletinDraft"
        ADD CONSTRAINT "DatafyBulletinDraft_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "DatafyBulletinDraft"
        ADD CONSTRAINT "DatafyBulletinDraft_campaignId_fkey"
        FOREIGN KEY ("campaignId") REFERENCES "DatafyCampaign"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
