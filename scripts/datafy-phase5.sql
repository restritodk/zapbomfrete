-- ZapBomFrete / Datafy Phase 5 — Official campaigns (PostgreSQL)
-- Additive only. Apply AFTER Phase 4 (CRM) or use datafy-phase4-and-5.sql.
-- Do NOT run migrate reset or drop tables.

CREATE TABLE IF NOT EXISTS "DatafyCampaign" (
  "id" TEXT NOT NULL,
  "organizationKey" TEXT NOT NULL DEFAULT 'default',
  "channelId" TEXT NOT NULL DEFAULT 'datafy-official',
  "name" TEXT NOT NULL,
  "description" TEXT,
  "purpose" TEXT NOT NULL DEFAULT 'marketing',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "templateName" TEXT,
  "templateLanguage" TEXT,
  "templateCategory" TEXT,
  "templateComponents" JSONB,
  "variableMapping" JSONB,
  "segmentFilter" JSONB,
  "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  "scheduledAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "pausedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "delayMs" INTEGER NOT NULL DEFAULT 1200,
  "batchSize" INTEGER NOT NULL DEFAULT 10,
  "dryRun" BOOLEAN NOT NULL DEFAULT false,
  "requireConsent" BOOLEAN NOT NULL DEFAULT true,
  "totalSelected" INTEGER NOT NULL DEFAULT 0,
  "totalEligible" INTEGER NOT NULL DEFAULT 0,
  "totalExcluded" INTEGER NOT NULL DEFAULT 0,
  "totalQueued" INTEGER NOT NULL DEFAULT 0,
  "totalSent" INTEGER NOT NULL DEFAULT 0,
  "totalAccepted" INTEGER NOT NULL DEFAULT 0,
  "totalDelivered" INTEGER NOT NULL DEFAULT 0,
  "totalRead" INTEGER NOT NULL DEFAULT 0,
  "totalFailed" INTEGER NOT NULL DEFAULT 0,
  "totalSkipped" INTEGER NOT NULL DEFAULT 0,
  "totalCancelled" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DatafyCampaign_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DatafyCampaign_organizationKey_status_idx"
  ON "DatafyCampaign"("organizationKey", "status");
CREATE INDEX IF NOT EXISTS "DatafyCampaign_channelId_status_idx"
  ON "DatafyCampaign"("channelId", "status");
CREATE INDEX IF NOT EXISTS "DatafyCampaign_scheduledAt_idx"
  ON "DatafyCampaign"("scheduledAt");
CREATE INDEX IF NOT EXISTS "DatafyCampaign_createdAt_idx"
  ON "DatafyCampaign"("createdAt");
CREATE INDEX IF NOT EXISTS "DatafyCampaign_status_lockedAt_idx"
  ON "DatafyCampaign"("status", "lockedAt");

DO $$ BEGIN
  ALTER TABLE "DatafyCampaign"
    ADD CONSTRAINT "DatafyCampaign_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "DatafyCampaignRecipient" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "crmContactId" TEXT,
  "waId" TEXT NOT NULL,
  "fullName" TEXT,
  "company" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "skipReason" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "clientMessageId" TEXT,
  "wamid" TEXT,
  "datafyMessageId" TEXT,
  "conversationId" TEXT,
  "lastError" TEXT,
  "errorCode" INTEGER,
  "nextAttemptAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DatafyCampaignRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DatafyCampaignRecipient_campaignId_waId_key"
  ON "DatafyCampaignRecipient"("campaignId", "waId");
CREATE UNIQUE INDEX IF NOT EXISTS "DatafyCampaignRecipient_clientMessageId_key"
  ON "DatafyCampaignRecipient"("clientMessageId");
CREATE INDEX IF NOT EXISTS "DatafyCampaignRecipient_campaignId_status_idx"
  ON "DatafyCampaignRecipient"("campaignId", "status");
CREATE INDEX IF NOT EXISTS "DatafyCampaignRecipient_wamid_idx"
  ON "DatafyCampaignRecipient"("wamid");
CREATE INDEX IF NOT EXISTS "DatafyCampaignRecipient_crmContactId_idx"
  ON "DatafyCampaignRecipient"("crmContactId");
CREATE INDEX IF NOT EXISTS "DatafyCampaignRecipient_status_nextAttemptAt_idx"
  ON "DatafyCampaignRecipient"("status", "nextAttemptAt");

DO $$ BEGIN
  ALTER TABLE "DatafyCampaignRecipient"
    ADD CONSTRAINT "DatafyCampaignRecipient_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "DatafyCampaign"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "DatafyCampaignEvent" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT,
  "message" TEXT,
  "meta" JSONB,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DatafyCampaignEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DatafyCampaignEvent_campaignId_createdAt_idx"
  ON "DatafyCampaignEvent"("campaignId", "createdAt");
CREATE INDEX IF NOT EXISTS "DatafyCampaignEvent_type_idx"
  ON "DatafyCampaignEvent"("type");

DO $$ BEGIN
  ALTER TABLE "DatafyCampaignEvent"
    ADD CONSTRAINT "DatafyCampaignEvent_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "DatafyCampaign"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
