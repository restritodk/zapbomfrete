-- ZapBomFrete / Datafy Phase 9 — Consentimentos WhatsApp (PostgreSQL)
-- Additive only. Preserves existing CrmContact rows.
-- Do NOT run migrate reset or drop tables.

ALTER TABLE "CrmContact"
  ADD COLUMN IF NOT EXISTS "consentPurpose" TEXT NOT NULL DEFAULT 'marketing_offers';
ALTER TABLE "CrmContact"
  ADD COLUMN IF NOT EXISTS "consentWabaId" TEXT;
ALTER TABLE "CrmContact"
  ADD COLUMN IF NOT EXISTS "consentEvidence" TEXT;
ALTER TABLE "CrmContact"
  ADD COLUMN IF NOT EXISTS "lastConsentDecisionId" TEXT;

CREATE INDEX IF NOT EXISTS "CrmContact_consentPurpose_idx"
  ON "CrmContact"("consentPurpose");

ALTER TABLE "DatafyManagedTemplate"
  ADD COLUMN IF NOT EXISTS "buttonsJson" JSONB;

CREATE TABLE IF NOT EXISTS "CrmConsentDecision" (
  "id" TEXT NOT NULL,
  "organizationKey" TEXT NOT NULL DEFAULT 'default',
  "wabaId" TEXT NOT NULL DEFAULT '',
  "crmContactId" TEXT,
  "waId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL DEFAULT 'marketing_offers',
  "decision" TEXT NOT NULL,
  "resultingStatus" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "evidenceText" TEXT,
  "evidencePayload" JSONB,
  "buttonId" TEXT,
  "buttonTitle" TEXT,
  "relatedMessageId" TEXT,
  "templateName" TEXT,
  "requestVersion" TEXT,
  "datafyEventId" TEXT,
  "decidedAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorUserId" TEXT,
  "idempotencyKey" TEXT,
  "appliedToContact" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmConsentDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CrmConsentDecision_idempotencyKey_key"
  ON "CrmConsentDecision"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "CrmConsentDecision_organizationKey_waId_decidedAt_idx"
  ON "CrmConsentDecision"("organizationKey", "waId", "decidedAt");
CREATE INDEX IF NOT EXISTS "CrmConsentDecision_crmContactId_decidedAt_idx"
  ON "CrmConsentDecision"("crmContactId", "decidedAt");
CREATE INDEX IF NOT EXISTS "CrmConsentDecision_organizationKey_decision_idx"
  ON "CrmConsentDecision"("organizationKey", "decision");
CREATE INDEX IF NOT EXISTS "CrmConsentDecision_organizationKey_purpose_decidedAt_idx"
  ON "CrmConsentDecision"("organizationKey", "purpose", "decidedAt");
CREATE INDEX IF NOT EXISTS "CrmConsentDecision_relatedMessageId_idx"
  ON "CrmConsentDecision"("relatedMessageId");

DO $$ BEGIN
  ALTER TABLE "CrmConsentDecision"
    ADD CONSTRAINT "CrmConsentDecision_crmContactId_fkey"
    FOREIGN KEY ("crmContactId") REFERENCES "CrmContact"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CrmConsentDecision"
    ADD CONSTRAINT "CrmConsentDecision_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
