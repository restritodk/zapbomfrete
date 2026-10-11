-- =============================================================================
-- ZapBomFrete — grants for Meta Approvals sync (fix Postgres 42501)
-- =============================================================================
-- Safe to re-run. No SUPERUSER / CREATEDB. Does not change passwords or .env.
--
-- CAUSE: DatafyTemplateSyncState was created by a DB admin; the app role lacks
-- SELECT/INSERT/UPDATE/DELETE → Prisma findUnique/upsert fails with 42501.
--
-- IDENTIFY THE APP ROLE (never print the password / full DATABASE_URL):
--
--   A) From the running app env (username only):
--        node -e "console.log(new URL(process.env.DATABASE_URL).username)"
--
--   B) From Postgres as admin:
--        SELECT tableowner FROM pg_tables WHERE tablename = 'DatafyManagedTemplate';
--        SELECT usename FROM pg_stat_activity WHERE datname = current_database();
--
-- APPLY as DB admin (replace APP_ROLE with the role from A/B):
--
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -c 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "DatafyTemplateSyncState" TO APP_ROLE;' \
--     -c 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "DatafyManagedTemplate" TO APP_ROLE;'
--
-- Or edit APP_ROLE below and run this file.
-- =============================================================================

-- >>> REPLACE THIS ROLE NAME <<<
DO $$
DECLARE
  app_role text := 'REPLACE_WITH_APP_ROLE'; -- e.g. zapbomfrete
BEGIN
  IF app_role = 'REPLACE_WITH_APP_ROLE' OR app_role IS NULL OR btrim(app_role) = '' THEN
    RAISE EXCEPTION 'Edit app_role in datafy-template-approvals-grants.sql before running';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE EXCEPTION 'Role % does not exist', app_role;
  END IF;

  IF to_regclass('public."DatafyTemplateSyncState"') IS NOT NULL THEN
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO %I',
      'DatafyTemplateSyncState',
      app_role
    );
  ELSE
    RAISE NOTICE 'Table DatafyTemplateSyncState not found — run datafy-template-approvals-sync.sql first';
  END IF;

  IF to_regclass('public."DatafyManagedTemplate"') IS NOT NULL THEN
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO %I',
      'DatafyManagedTemplate',
      app_role
    );
  END IF;

  RAISE NOTICE 'Grants applied to role %', app_role;
END $$;

-- Verification (run as admin; shows privileges for every non-system grantee)
SELECT
  grantee,
  table_name,
  string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('DatafyTemplateSyncState', 'DatafyManagedTemplate')
GROUP BY grantee, table_name
ORDER BY table_name, grantee;
