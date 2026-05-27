-- =============================================================================
-- ROLLBACK for 20260527000000_advisor_cleanup.sql + 20260527000001_advisor_cleanup_revoke_public.sql
--
-- Restores the exact policy bodies / grants captured from pg_policies and
-- pg_proc on 2026-05-27 before the migrations were applied. Pre-apply proacl
-- on each of the 14 SECURITY DEFINER functions was:
--   {=X/postgres,postgres=X/postgres,service_role=X/postgres}
-- i.e., EXECUTE granted to PUBLIC (which anon/authenticated inherit from) plus
-- explicit grants to postgres and service_role. To restore, GRANT TO PUBLIC and
-- REVOKE the explicit authenticated grants added by the corrective migration.
--
-- NOT a versioned migration; do NOT add to schema_migrations.
-- Run manually via the SQL Editor if a regression is discovered.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. RESTORE GRANTS on the 14 SECURITY DEFINER functions
-- -----------------------------------------------------------------------------

-- Restore the EXECUTE-to-PUBLIC grant that anon/authenticated inherit from
GRANT EXECUTE ON FUNCTION public.handle_new_user()                          TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_is_team_member()                      TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_feedback_email()                    TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_old_audit_logs()                     TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.shares_team_as_admin(uuid, uuid)           TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_team_admin(uuid, uuid)                  TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_team_member(uuid, uuid)                 TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_team_vault_admin(uuid, uuid)            TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_team_vault_member(uuid, uuid)           TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_vault_has_members(uuid)               TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_access_folder(uuid, uuid, uuid)   TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_team_members_with_email(uuid)          TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_vault_entry_versioned(
  p_id uuid, p_vault_id uuid, p_name text, p_entry_type text, p_folder_id uuid,
  p_sort_order integer, p_host text, p_port integer, p_username text, p_domain text,
  p_icon text, p_color text, p_notes text, p_password_encrypted text,
  p_private_key_encrypted text, p_config_encrypted text, p_tags_encrypted text,
  p_is_favorite boolean, p_expected_version integer, p_updated_by uuid,
  p_credential_type text, p_totp_secret_encrypted text, p_parent_entry_id uuid
)                                                                            TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_token_usage(uuid, integer, integer) TO PUBLIC;

-- Remove the explicit authenticated grants added by the corrective migration
REVOKE EXECUTE ON FUNCTION public.get_team_members_with_email(uuid)          FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.upsert_vault_entry_versioned(
  p_id uuid, p_vault_id uuid, p_name text, p_entry_type text, p_folder_id uuid,
  p_sort_order integer, p_host text, p_port integer, p_username text, p_domain text,
  p_icon text, p_color text, p_notes text, p_password_encrypted text,
  p_private_key_encrypted text, p_config_encrypted text, p_tags_encrypted text,
  p_is_favorite boolean, p_expected_version integer, p_updated_by uuid,
  p_credential_type text, p_totp_secret_encrypted text, p_parent_entry_id uuid
)                                                                            FROM authenticated;

-- -----------------------------------------------------------------------------
-- 2. RESTORE bare-auth.uid() RLS policies (verbatim from pre-apply snapshot)
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can read own profile" ON public.user_profiles;
CREATE POLICY "Users can read own profile" ON public.user_profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile display_name only" ON public.user_profiles;
CREATE POLICY "Users can update own profile display_name only" ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users read own budget" ON public.user_token_budgets;
CREATE POLICY "Users read own budget" ON public.user_token_budgets
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own logs" ON public.token_usage_log;
CREATE POLICY "Users read own logs" ON public.token_usage_log
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own count" ON public.user_entry_counts;
CREATE POLICY "Users read own count" ON public.user_entry_counts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_own_conversations ON public.user_chat_conversations;
CREATE POLICY user_own_conversations ON public.user_chat_conversations
  FOR ALL TO public
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_own_storage ON public.user_chat_storage;
CREATE POLICY user_own_storage ON public.user_chat_storage
  FOR ALL TO public
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS tm_select ON public.team_members;
CREATE POLICY tm_select ON public.team_members
  FOR SELECT TO public
  USING (is_team_member(team_id, auth.uid()));

DROP POLICY IF EXISTS tm_insert ON public.team_members;
CREATE POLICY tm_insert ON public.team_members
  FOR INSERT TO public
  WITH CHECK (
    is_team_admin(team_id, auth.uid())
    OR NOT EXISTS (
      SELECT 1 FROM team_members existing
       WHERE existing.team_id = team_members.team_id
    )
  );

DROP POLICY IF EXISTS tm_update ON public.team_members;
CREATE POLICY tm_update ON public.team_members
  FOR UPDATE TO public
  USING (is_team_admin(team_id, auth.uid()));

DROP POLICY IF EXISTS teams_select ON public.teams;
CREATE POLICY teams_select ON public.teams
  FOR SELECT TO public
  USING (is_team_member(id, auth.uid()));

DROP POLICY IF EXISTS ti_insert ON public.team_invitations;
CREATE POLICY ti_insert ON public.team_invitations
  FOR INSERT TO public
  WITH CHECK (is_team_admin(team_id, auth.uid()));

DROP POLICY IF EXISTS upk_select_team_members ON public.user_public_keys;
CREATE POLICY upk_select_team_members ON public.user_public_keys
  FOR SELECT TO public
  USING (
    user_id = auth.uid()
    OR shares_team_as_admin(auth.uid(), user_id)
  );

DROP POLICY IF EXISTS "Users can insert own feedback" ON public.feedback_submissions;
CREATE POLICY "Users can insert own feedback" ON public.feedback_submissions
  FOR INSERT TO public
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own feedback" ON public.feedback_submissions;
CREATE POLICY "Users can read own feedback" ON public.feedback_submissions
  FOR SELECT TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS vault_password_history_select ON public.vault_password_history;
CREATE POLICY vault_password_history_select ON public.vault_password_history
  FOR SELECT TO public
  USING (EXISTS (
    SELECT 1 FROM team_vault_members
     WHERE team_vault_members.team_vault_id = vault_password_history.vault_id
       AND team_vault_members.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS vault_password_history_insert ON public.vault_password_history;
CREATE POLICY vault_password_history_insert ON public.vault_password_history
  FOR INSERT TO public
  WITH CHECK (EXISTS (
    SELECT 1 FROM team_vault_members
     WHERE team_vault_members.team_vault_id = vault_password_history.vault_id
       AND team_vault_members.user_id = auth.uid()
       AND team_vault_members.role = ANY (ARRAY['editor'::text, 'admin'::text])
  ));

DROP POLICY IF EXISTS vault_password_history_update ON public.vault_password_history;
CREATE POLICY vault_password_history_update ON public.vault_password_history
  FOR UPDATE TO public
  USING (EXISTS (
    SELECT 1 FROM team_vault_members
     WHERE team_vault_members.team_vault_id = vault_password_history.vault_id
       AND team_vault_members.user_id = auth.uid()
       AND team_vault_members.role = ANY (ARRAY['editor'::text, 'admin'::text])
  ));

DROP POLICY IF EXISTS vault_password_history_delete ON public.vault_password_history;
CREATE POLICY vault_password_history_delete ON public.vault_password_history
  FOR DELETE TO public
  USING (EXISTS (
    SELECT 1 FROM team_vault_members
     WHERE team_vault_members.team_vault_id = vault_password_history.vault_id
       AND team_vault_members.user_id = auth.uid()
       AND team_vault_members.role = 'admin'::text
  ));

-- -----------------------------------------------------------------------------
-- 3. RESTORE upk_select_own policy (was already using wrapped form pre-apply)
-- -----------------------------------------------------------------------------

CREATE POLICY upk_select_own ON public.user_public_keys
  FOR SELECT TO public
  USING ((SELECT auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- 4. DROP the new FK indexes
-- -----------------------------------------------------------------------------

DROP INDEX IF EXISTS public.idx_feedback_submissions_user_id;
DROP INDEX IF EXISTS public.idx_team_invitations_invited_by;
DROP INDEX IF EXISTS public.idx_team_vault_members_added_by;
DROP INDEX IF EXISTS public.idx_team_vault_members_user_id;
DROP INDEX IF EXISTS public.idx_team_vaults_created_by;
DROP INDEX IF EXISTS public.idx_user_profiles_primary_team_id;
DROP INDEX IF EXISTS public.idx_user_profiles_tier_id;
DROP INDEX IF EXISTS public.idx_vault_audit_log_actor_id;
DROP INDEX IF EXISTS public.idx_vault_entries_folder_id;
DROP INDEX IF EXISTS public.idx_vault_entries_updated_by;
DROP INDEX IF EXISTS public.idx_vault_folder_permissions_granted_by;
DROP INDEX IF EXISTS public.idx_vault_folder_permissions_user_id;
DROP INDEX IF EXISTS public.idx_vault_folders_parent_id;
DROP INDEX IF EXISTS public.idx_vault_folders_updated_by;
DROP INDEX IF EXISTS public.idx_vault_key_wraps_user_id;
DROP INDEX IF EXISTS public.idx_vault_locks_locked_by;
DROP INDEX IF EXISTS public.idx_vault_password_history_changed_by;

COMMIT;
