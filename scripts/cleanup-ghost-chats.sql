-- Remove junk Chat rows with no real messages (empty TEXT stubs / orphans)
DELETE FROM "Chat" c
USING "Session" s
WHERE c."sessionId" = s.id
  AND s."sessionId" = 'sdsa'
  AND (
    c.jid = '0@s.whatsapp.net'
    OR c.jid LIKE '%@broadcast'
    OR NOT EXISTS (
      SELECT 1 FROM "Message" m
      WHERE m."sessionId" = c."sessionId"
        AND m."remoteJid" = c.jid
        AND (COALESCE(m.content, '') <> '' OR m.type::text <> 'TEXT')
    )
  );

-- Normalize legacy +prefixed message JIDs into canonical form when target chat exists
UPDATE "Message" m
SET "remoteJid" = regexp_replace(m."remoteJid", '^\+', '')
WHERE m."remoteJid" LIKE '+%@s.whatsapp.net';
