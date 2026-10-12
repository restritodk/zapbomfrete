UPDATE "Contact"
SET lid = '95408957161671@lid'
WHERE jid = '554899735110@s.whatsapp.net';

UPDATE "Contact"
SET name = 'Nazário',
    notify = 'Nazário',
    "remoteJidAlt" = '554899735110@s.whatsapp.net'
WHERE jid = '95408957161671@lid';

UPDATE "Chat"
SET name = 'Nazário'
WHERE jid = '95408957161671@lid';

INSERT INTO "AuthState" (id, "sessionId", key, value)
SELECT md5(random()::text || clock_timestamp()::text), 'sdsa', 'lid-mapping-554899735110', to_jsonb('95408957161671'::text)
WHERE NOT EXISTS (
  SELECT 1 FROM "AuthState" WHERE "sessionId"='sdsa' AND key='lid-mapping-554899735110'
);

INSERT INTO "AuthState" (id, "sessionId", key, value)
SELECT md5(random()::text || clock_timestamp()::text), 'sdsa', 'lid-mapping-95408957161671_reverse', to_jsonb('554899735110'::text)
WHERE NOT EXISTS (
  SELECT 1 FROM "AuthState" WHERE "sessionId"='sdsa' AND key='lid-mapping-95408957161671_reverse'
);
