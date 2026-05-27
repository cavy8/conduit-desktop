-- =============================================================================
-- ADVISOR CLEANUP — combined migration
--
-- Addresses 5 of 6 Supabase Advisor findings for project khuyzxadaszwxirwykms:
--   1. Add 17 indexes on flagged foreign-key columns (perf)
--   2. Drop redundant upk_select_own policy (multiple_permissive_policies)
--   3. Wrap auth.uid() in scalar subquery for 19 RLS policies (auth_rls_initplan)
--   4. Revoke EXECUTE on 14 SECURITY DEFINER functions from anon/authenticated
--      (anon_/authenticated_security_definer_function_executable)
-- The 6th finding (auth_leaked_password_protection) is a Dashboard toggle.
-- The 7th (unused indexes) is deferred — false positive on near-empty tables.
--
-- Policy bodies were captured verbatim from pg_policies on 2026-05-27 before
-- writing, then rewritten with auth.uid() → (select auth.uid()).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. FK INDEXES
--    All target tables are small (largest ~93 rows), so non-CONCURRENTLY
--    is safe and keeps this migration atomic.
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_user_id        ON public.feedback_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_team_invitations_invited_by         ON public.team_invitations(invited_by);
CREATE INDEX IF NOT EXISTS idx_team_vault_members_added_by         ON public.team_vault_members(added_by);
CREATE INDEX IF NOT EXISTS idx_team_vault_members_user_id          ON public.team_vault_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_vaults_created_by              ON public.team_vaults(created_by);
CREATE INDEX IF NOT EXISTS idx_user_profiles_primary_team_id       ON public.user_profiles(primary_team_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_tier_id               ON public.user_profiles(tier_id);
CREATE INDEX IF NOT EXISTS idx_vault_audit_log_actor_id            ON public.vault_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_vault_entries_folder_id             ON public.vault_entries(folder_id);
CREATE INDEX IF NOT EXISTS idx_vault_entries_updated_by            ON public.vault_entries(updated_by);
CREATE INDEX IF NOT EXISTS idx_vault_folder_permissions_granted_by ON public.vault_folder_permissions(granted_by);
CREATE INDEX IF NOT EXISTS idx_vault_folder_permissions_user_id    ON public.vault_folder_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_vault_folders_parent_id             ON public.vault_folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_vault_folders_updated_by            ON public.vault_folders(updated_by);
CREATE INDEX IF NOT EXISTS idx_vault_key_wraps_user_id             ON public.vault_key_wraps(user_id);
CREATE INDEX IF NOT EXISTS idx_vault_locks_locked_by               ON public.vault_locks(locked_by);
CREATE INDEX IF NOT EXISTS idx_vault_password_history_changed_by   ON public.vault_password_history(changed_by);


-- -----------------------------------------------------------------------------
-- 2. MERGE user_public_keys SELECT POLICIES
--    upk_select_team_members already covers the own-row case (its qual is
--    OR-ed with user_id = auth.uid()), so dropping upk_select_own removes
--    the multiple_permissive_policies warning. The remaining policy is
--    rewritten in section 3 below.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS upk_select_own ON public.user_public_keys;


-- -----------------------------------------------------------------------------
-- 3. RLS INITPLAN REWRITES
--    Each policy is DROP-then-CREATE with auth.uid() replaced by
--    (select auth.uid()). Semantics are identical (auth.uid() is JWT-derived
--    and constant within a statement), but the planner caches the result
--    once per query instead of re-evaluating per row.
-- -----------------------------------------------------------------------------

-- user_profiles
DROP POLICY IF EXISTS "Users can read own profile" ON public.user_profiles;
CREATE POLICY "Users can read own profile" ON public.user_profiles
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update own profile display_name only" ON public.user_profiles;
CREATE POLICY "Users can update own profile display_name only" ON public.user_profiles
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

-- user_token_budgets
DROP POLICY IF EXISTS "Users read own budget" ON public.user_token_budgets;
CREATE POLICY "Users read own budget" ON public.user_token_budgets
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

-- token_usage_log
DROP POLICY IF EXISTS "Users read own logs" ON public.token_usage_log;
CREATE POLICY "Users read own logs" ON public.token_usage_log
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

-- user_entry_counts
DROP POLICY IF EXISTS "Users read own count" ON public.user_entry_counts;
CREATE POLICY "Users read own count" ON public.user_entry_counts
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

-- user_chat_conversations
DROP POLICY IF EXISTS user_own_conversations ON public.user_chat_conversations;
CREATE POLICY user_own_conversations ON public.user_chat_conversations
  FOR ALL TO public
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- user_chat_storage
DROP POLICY IF EXISTS user_own_storage ON public.user_chat_storage;
CREATE POLICY user_own_storage ON public.user_chat_storage
  FOR ALL TO public
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- team_members
DROP POLICY IF EXISTS tm_select ON public.team_members;
CREATE POLICY tm_select ON public.team_members
  FOR SELECT TO public
  USING (is_team_member(team_id, (select auth.uid())));

DROP POLICY IF EXISTS tm_insert ON public.team_members;
CREATE POLICY tm_insert ON public.team_members
  FOR INSERT TO public
  WITH CHECK (
    is_team_admin(team_id, (select auth.uid()))
    OR NOT EXISTS (
      SELECT 1
        FROM team_members existing
       WHERE existing.team_id = team_members.team_id
    )
  );

DROP POLICY IF EXISTS tm_update ON public.team_members;
CREATE POLICY tm_update ON public.team_members
  FOR UPDATE TO public
  USING (is_team_admin(team_id, (select auth.uid())));

-- teams
DROP POLICY IF EXISTS teams_select ON public.teams;
CREATE POLICY teams_select ON public.teams
  FOR SELECT TO public
  USING (is_team_member(id, (select auth.uid())));

-- team_invitations
DROP POLICY IF EXISTS ti_insert ON public.team_invitations;
CREATE POLICY ti_insert ON public.team_invitations
  FOR INSERT TO public
  WITH CHECK (is_team_admin(team_id, (select auth.uid())));

-- user_public_keys (remaining policy after upk_select_own was dropped above)
DROP POLICY IF EXISTS upk_select_team_members ON public.user_public_keys;
CREATE POLICY upk_select_team_members ON public.user_public_keys
  FOR SELECT TO public
  USING (
    user_id = (select auth.uid())
    OR shares_team_as_admin((select auth.uid()), user_id)
  );

-- feedback_submissions
DROP POLICY IF EXISTS "Users can insert own feedback" ON public.feedback_submissions;
CREATE POLICY "Users can insert own feedback" ON public.feedback_submissions
  FOR INSERT TO public
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can read own feedback" ON public.feedback_submissions;
CREATE POLICY "Users can read own feedback" ON public.feedback_submissions
  FOR SELECT TO public
  USING ((select auth.uid()) = user_id);

-- vault_password_history (auth.uid() is inside EXISTS subqueries; wrap each occurrence)
DROP POLICY IF EXISTS vault_password_history_select ON public.vault_password_history;
CREATE POLICY vault_password_history_select ON public.vault_password_history
  FOR SELECT TO public
  USING (EXISTS (
    SELECT 1
      FROM team_vault_members
     WHERE team_vault_members.team_vault_id = vault_password_history.vault_id
       AND team_vault_members.user_id = (select auth.uid())
  ));

DROP POLICY IF EXISTS vault_password_history_insert ON public.vault_password_history;
CREATE POLICY vault_password_history_insert ON public.vault_password_history
  FOR INSERT TO public
  WITH CHECK (EXISTS (
    SELECT 1
      FROM team_vault_members
     WHERE team_vault_members.team_vault_id = vault_password_history.vault_id
       AND team_vault_members.user_id = (select auth.uid())
       AND team_vault_members.role = ANY (ARRAY['editor'::text, 'admin'::text])
  ));

DROP POLICY IF EXISTS vault_password_history_update ON public.vault_password_history;
CREATE POLICY vault_password_history_update ON public.vault_password_history
  FOR UPDATE TO public
  USING (EXISTS (
    SELECT 1
      FROM team_vault_members
     WHERE team_vault_members.team_vault_id = vault_password_history.vault_id
       AND team_vault_members.user_id = (select auth.uid())
       AND team_vault_members.role = ANY (ARRAY['editor'::text, 'admin'::text])
  ));

DROP POLICY IF EXISTS vault_password_history_delete ON public.vault_password_history;
CREATE POLICY vault_password_history_delete ON public.vault_password_history
  FOR DELETE TO public
  USING (EXISTS (
    SELECT 1
      FROM team_vault_members
     WHERE team_vault_members.team_vault_id = vault_password_history.vault_id
       AND team_vault_members.user_id = (select auth.uid())
       AND team_vault_members.role = 'admin'::text
  ));


-- -----------------------------------------------------------------------------
-- 4. SECURITY DEFINER EXECUTE REVOKES
--    SECURITY DEFINER functions run with their owner's privileges, bypassing
--    RLS. They should never have been exposed to /rest/v1/rpc for the anon
--    or authenticated roles when they're meant to be triggers, RLS helpers,
--    or scheduled jobs. Function ownership (postgres) is unchanged, so
--    triggers and RLS-internal calls keep working.
-- -----------------------------------------------------------------------------

-- Triggers / RLS helpers / cron — revoke from BOTH anon and authenticated:
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                          FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_is_team_member()                      FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_feedback_email()                    FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_old_audit_logs()                     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shares_team_as_admin(uuid, uuid)           FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_team_admin(uuid, uuid)                  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_team_member(uuid, uuid)                 FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_team_vault_admin(uuid, uuid)            FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_team_vault_member(uuid, uuid)           FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.team_vault_has_members(uuid)               FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.user_can_access_folder(uuid, uuid, uuid)   FROM anon, authenticated;

-- App-callable functions — revoke from anon only, keep authenticated:
REVOKE EXECUTE ON FUNCTION public.get_team_members_with_email(uuid)          FROM anon;
REVOKE EXECUTE ON FUNCTION public.upsert_vault_entry_versioned(
  p_id uuid, p_vault_id uuid, p_name text, p_entry_type text, p_folder_id uuid,
  p_sort_order integer, p_host text, p_port integer, p_username text, p_domain text,
  p_icon text, p_color text, p_notes text, p_password_encrypted text,
  p_private_key_encrypted text, p_config_encrypted text, p_tags_encrypted text,
  p_is_favorite boolean, p_expected_version integer, p_updated_by uuid,
  p_credential_type text, p_totp_secret_encrypted text, p_parent_entry_id uuid
)                                                                            FROM anon;

-- Dead function (zero code references after April 2026 open-core pivot
-- removed built-in AI / token tracking). Keep the function itself for the
-- next dead-schema audit; only revoke EXECUTE.
REVOKE EXECUTE ON FUNCTION public.increment_token_usage(uuid, integer, integer) FROM anon, authenticated;
