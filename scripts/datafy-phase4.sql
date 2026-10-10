-- ZapBomFrete / Datafy Phase 4 — CRM (PostgreSQL)
-- Additive only. Apply manually on VPS after deploy review.
-- Do NOT run migrate reset or drop tables.

ALTER TABLE "DatafyConversation"
  ADD COLUMN IF NOT EXISTS "crmContactId" TEXT;

CREATE TABLE IF NOT EXISTS "CrmContact" (
  "id" TEXT NOT NULL,
  "organizationKey" TEXT NOT NULL DEFAULT 'default',
  "waId" TEXT NOT NULL,
  "fullName" TEXT,
  "company" TEXT,
  "city" TEXT,
  "state" TEXT,
  "category" TEXT,
  "origin" TEXT NOT NULL DEFAULT 'manual',
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "consentStatus" TEXT NOT NULL DEFAULT 'unknown',
  "consentSource" TEXT,
  "consentAt" TIMESTAMP(3),
  "optedOutAt" TIMESTAMP(3),
  "lastInteractionAt" TIMESTAMP(3),
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CrmContact_organizationKey_waId_key"
  ON "CrmContact"("organizationKey", "waId");
CREATE INDEX IF NOT EXISTS "CrmContact_fullName_idx" ON "CrmContact"("fullName");
CREATE INDEX IF NOT EXISTS "CrmContact_company_idx" ON "CrmContact"("company");
CREATE INDEX IF NOT EXISTS "CrmContact_city_idx" ON "CrmContact"("city");
CREATE INDEX IF NOT EXISTS "CrmContact_state_idx" ON "CrmContact"("state");
CREATE INDEX IF NOT EXISTS "CrmContact_category_idx" ON "CrmContact"("category");
CREATE INDEX IF NOT EXISTS "CrmContact_origin_idx" ON "CrmContact"("origin");
CREATE INDEX IF NOT EXISTS "CrmContact_active_idx" ON "CrmContact"("active");
CREATE INDEX IF NOT EXISTS "CrmContact_consentStatus_idx" ON "CrmContact"("consentStatus");
CREATE INDEX IF NOT EXISTS "CrmContact_lastInteractionAt_idx" ON "CrmContact"("lastInteractionAt");

DO $$ BEGIN
  ALTER TABLE "CrmContact"
    ADD CONSTRAINT "CrmContact_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CrmContact"
    ADD CONSTRAINT "CrmContact_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "CrmTag" (
  "id" TEXT NOT NULL,
  "organizationKey" TEXT NOT NULL DEFAULT 'default',
  "name" TEXT NOT NULL,
  "colorHex" TEXT NOT NULL DEFAULT '#64748b',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmTag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CrmTag_organizationKey_name_key"
  ON "CrmTag"("organizationKey", "name");
CREATE INDEX IF NOT EXISTS "CrmTag_organizationKey_idx" ON "CrmTag"("organizationKey");

CREATE TABLE IF NOT EXISTS "CrmContactTag" (
  "id" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmContactTag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CrmContactTag_contactId_tagId_key"
  ON "CrmContactTag"("contactId", "tagId");
CREATE INDEX IF NOT EXISTS "CrmContactTag_tagId_idx" ON "CrmContactTag"("tagId");
CREATE INDEX IF NOT EXISTS "CrmContactTag_contactId_idx" ON "CrmContactTag"("contactId");

DO $$ BEGIN
  ALTER TABLE "CrmContactTag"
    ADD CONSTRAINT "CrmContactTag_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CrmContactTag"
    ADD CONSTRAINT "CrmContactTag_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "CrmTag"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "DatafyConversation_crmContactId_idx"
  ON "DatafyConversation"("crmContactId");

DO $$ BEGIN
  ALTER TABLE "DatafyConversation"
    ADD CONSTRAINT "DatafyConversation_crmContactId_fkey"
    FOREIGN KEY ("crmContactId") REFERENCES "CrmContact"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
