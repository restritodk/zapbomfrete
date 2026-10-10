-- ZapBomFrete / Datafy Phase 3 — additive schema (PostgreSQL)
-- Apply manually on VPS after deploy review. Non-destructive.
-- Do NOT run migrate reset or drop tables.

ALTER TABLE "DatafyIntegration"
  ADD COLUMN IF NOT EXISTS "operationalAccessMode" TEXT NOT NULL DEFAULT 'ROLE_OWNER';

CREATE TABLE IF NOT EXISTS "DatafyChannelAccess" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "grantedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DatafyChannelAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DatafyChannelAccess_userId_key"
  ON "DatafyChannelAccess"("userId");

CREATE INDEX IF NOT EXISTS "DatafyChannelAccess_createdAt_idx"
  ON "DatafyChannelAccess"("createdAt");

DO $$ BEGIN
  ALTER TABLE "DatafyChannelAccess"
    ADD CONSTRAINT "DatafyChannelAccess_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "DatafyConversation" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL DEFAULT 'datafy-official',
  "waId" TEXT NOT NULL,
  "contactName" TEXT,
  "contactUserId" TEXT,
  "phoneNumberId" TEXT,
  "lastMessagePreview" TEXT,
  "lastMessageAt" TIMESTAMP(3),
  "lastCustomerMessageAt" TIMESTAMP(3),
  "unreadCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'open',
  "assignedToId" TEXT,
  "assignedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DatafyConversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DatafyConversation_channelId_waId_key"
  ON "DatafyConversation"("channelId", "waId");
CREATE INDEX IF NOT EXISTS "DatafyConversation_lastMessageAt_idx"
  ON "DatafyConversation"("lastMessageAt");
CREATE INDEX IF NOT EXISTS "DatafyConversation_assignedToId_idx"
  ON "DatafyConversation"("assignedToId");
CREATE INDEX IF NOT EXISTS "DatafyConversation_unreadCount_idx"
  ON "DatafyConversation"("unreadCount");
CREATE INDEX IF NOT EXISTS "DatafyConversation_status_idx"
  ON "DatafyConversation"("status");

DO $$ BEGIN
  ALTER TABLE "DatafyConversation"
    ADD CONSTRAINT "DatafyConversation_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "DatafyMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "wamid" TEXT,
  "clientMessageId" TEXT,
  "direction" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "body" TEXT,
  "mediaId" TEXT,
  "mediaUrl" TEXT,
  "mediaMimeType" TEXT,
  "mediaFilename" TEXT,
  "mediaSize" INTEGER,
  "caption" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "errorCode" INTEGER,
  "errorMessage" TEXT,
  "sentByUserId" TEXT,
  "providerTimestamp" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DatafyMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DatafyMessage_wamid_key" ON "DatafyMessage"("wamid");
CREATE UNIQUE INDEX IF NOT EXISTS "DatafyMessage_clientMessageId_key" ON "DatafyMessage"("clientMessageId");
CREATE INDEX IF NOT EXISTS "DatafyMessage_conversationId_createdAt_idx"
  ON "DatafyMessage"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "DatafyMessage_status_idx" ON "DatafyMessage"("status");
CREATE INDEX IF NOT EXISTS "DatafyMessage_direction_idx" ON "DatafyMessage"("direction");

DO $$ BEGIN
  ALTER TABLE "DatafyMessage"
    ADD CONSTRAINT "DatafyMessage_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "DatafyConversation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DatafyMessage"
    ADD CONSTRAINT "DatafyMessage_sentByUserId_fkey"
    FOREIGN KEY ("sentByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "DatafyAssignmentHistory" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "fromUserId" TEXT,
  "toUserId" TEXT,
  "action" TEXT NOT NULL,
  "createdById" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DatafyAssignmentHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DatafyAssignmentHistory_conversationId_createdAt_idx"
  ON "DatafyAssignmentHistory"("conversationId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "DatafyAssignmentHistory"
    ADD CONSTRAINT "DatafyAssignmentHistory_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "DatafyConversation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
