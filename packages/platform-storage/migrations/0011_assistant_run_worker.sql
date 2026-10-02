-- The interview assistant's run worker leases queued runs across members:
-- its own transactions set app.run_worker, and only those may read and
-- update the assistant's tables without a member scope.
DO $$
DECLARE table_name text;
BEGIN
  FOR table_name IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'assistant' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'assistant' AND tablename = table_name AND policyname = 'run_worker'
    ) THEN
      EXECUTE format(
        'CREATE POLICY run_worker ON assistant.%I USING (current_setting(''app.run_worker'', true) = ''on'') WITH CHECK (current_setting(''app.run_worker'', true) = ''on'')',
        table_name
      );
    END IF;
  END LOOP;
END $$;
