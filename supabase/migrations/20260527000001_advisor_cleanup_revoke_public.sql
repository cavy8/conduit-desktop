-- =============================================================================
-- ADVISOR CLEANUP — corrective REVOKE migration
--
-- Sibling migration to 20260527000000_advisor_cleanup.sql. The previous
-- migration's `REVOKE EXECUTE ON FUNCTION ... FROM anon, authenticated;`
-- statements were no-ops because anon/authenticated never had explicit grants —
-- they inherited EXECUTE from `PUBLIC` (visible in pg_proc.proacl as `=X/postgres`).
-- The advisor warning persisted as a result.
--
-- This migration revokes from PUBLIC (the actual grant), and re-grants EXECUTE
-- to `authenticated` for the two app-callable RPCs that the desktop client uses.
-- `service_role` always retains EXECUTE via its explicit pre-existing grant.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. REVOKE EXECUTE FROM PUBLIC for all 14 SECURITY DEFINER functions
-- -----------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.handle_new_user()                          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_is_team_member()                      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_feedback_email()                    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_old_audit_logs()                     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.shares_team_as_admin(uuid, uuid)           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_team_admin(uuid, uuid)                  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_team_member(uuid, uuid)                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_team_vault_admin(uuid, uuid)            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_team_vault_member(uuid, uuid)           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.team_vault_has_members(uuid)               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_can_access_folder(uuid, uuid, uuid)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_team_members_with_email(uuid)          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_vault_entry_versioned(
  p_id uuid, p_vault_id uuid, p_name text, p_entry_type text, p_folder_id uuid,
  p_sort_order integer, p_host text, p_port integer, p_username text, p_domain text,
  p_icon text, p_color text, p_notes text, p_password_encrypted text,
  p_private_key_encrypted text, p_config_encrypted text, p_tags_encrypted text,
  p_is_favorite boolean, p_expected_version integer, p_updated_by uuid,
  p_credential_type text, p_totp_secret_encrypted text, p_parent_entry_id uuid
)                                                                            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_token_usage(uuid, integer, integer) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 2. GRANT EXECUTE TO authenticated for the two app-callable RPCs
--    Desktop client invokes these via supabase.rpc() with an authenticated
--    JWT (see electron/services/vault/team-sync.ts:364,
--    electron/services/team/team-service.ts, etc.).
-- -----------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.get_team_members_with_email(uuid)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_vault_entry_versioned(
  p_id uuid, p_vault_id uuid, p_name text, p_entry_type text, p_folder_id uuid,
  p_sort_order integer, p_host text, p_port integer, p_username text, p_domain text,
  p_icon text, p_color text, p_notes text, p_password_encrypted text,
  p_private_key_encrypted text, p_config_encrypted text, p_tags_encrypted text,
  p_is_favorite boolean, p_expected_version integer, p_updated_by uuid,
  p_credential_type text, p_totp_secret_encrypted text, p_parent_entry_id uuid
)                                                                            TO authenticated;
