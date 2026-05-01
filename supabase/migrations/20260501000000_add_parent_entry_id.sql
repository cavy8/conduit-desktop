-- Allow nesting any vault entry under another entry (in addition to under a folder).
-- An entry has either a folder_id (lives in a folder) OR a parent_entry_id (nested
-- under another entry) — the application layer enforces mutual exclusion. Both
-- nullable; both with ON DELETE SET NULL so deleting a parent reparents to root
-- (the desktop client further promotes children to the deleted entry's container
-- before issuing the delete, see vault.deleteEntry).

ALTER TABLE vault_entries
  ADD COLUMN IF NOT EXISTS parent_entry_id UUID
  REFERENCES vault_entries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vault_entries_parent_entry_id
  ON vault_entries(parent_entry_id);

-- ============================================================================
-- IMPORTANT: The upsert_vault_entry_versioned RPC must be updated to accept
-- p_parent_entry_id. The desktop client (electron/services/vault/team-sync.ts)
-- now passes this parameter on every team-vault upload — calls will fail
-- against the old RPC signature.
--
-- The full function body lives in the Supabase dashboard / earlier migrations
-- and is not reproduced here in full. Apply the changes below to the existing
-- function (visible via the dashboard SQL Editor → Database → Functions):
--
--   1. Add parameter:  p_parent_entry_id UUID DEFAULT NULL
--      Place it next to p_folder_id.
--
--   2. In the INSERT statement: add  parent_entry_id  to the column list and
--      p_parent_entry_id  to the VALUES list.
--
--   3. In the UPDATE statement: add  parent_entry_id = p_parent_entry_id  to
--      the SET list.
--
-- After updating, redeploy the function in the dashboard. Verify by uploading
-- a nested entry from the desktop client and checking that vault_entries.
-- parent_entry_id was populated.
-- ============================================================================
