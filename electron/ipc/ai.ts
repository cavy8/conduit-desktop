/**
 * AI IPC handlers for the Electron main process.
 *
 * Registers handlers for tier capabilities and MCP binary path lookup.
 * Chat now flows through external CLI engines (Claude Code, Codex) via
 * electron/ipc/engine.ts; the CLIs manage their own session history.
 */

import { ipcMain, app } from 'electron';
import path from 'node:path';
import type { AppState } from '../services/state.js';
import { readSettings, writeSettings } from './settings.js';

export function registerAiHandlers(state: AppState): void {
  ipcMain.handle('ai_get_mcp_path', async () => {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'mcp', 'dist', 'index.js');
    }
    return path.resolve(app.getAppPath(), 'mcp', 'dist', 'index.js');
  });

  // ── Tier-aware handlers ──────────────────────────────────────────────────

  /** Returns the user's AI feature flags for frontend gating. */
  ipcMain.handle('ai_get_tier_capabilities', async () => {
    const authState = state.authService.getAuthState();
    let profile = authState.profile;

    // If authenticated but profile hasn't loaded yet (race condition on startup),
    // fetch it directly before computing capabilities.
    if (!profile && authState.user) {
      try {
        profile = await state.authService.getUserProfile();
      } catch { /* fall through to defaults */ }
    }

    if (!profile) {
      return {
        cli_agents_enabled: false,
        mcp_enabled: false,
        mcp_daily_quota: 50,
        cloud_sync_enabled: false,
        shared_vaults: false,
        tier_name: 'free',
        tier_display_name: 'Free',
        is_team_member: false,
      };
    }

    const features = profile.tier?.features as Record<string, unknown> ?? {};

    const capabilities = {
      cli_agents_enabled: !!features.cli_agents_enabled,
      mcp_enabled: !!features.mcp_enabled,
      mcp_daily_quota: typeof features.mcp_daily_quota === 'number' ? features.mcp_daily_quota : 50,
      cloud_sync_enabled: !!features.cloud_sync_enabled,
      shared_vaults: !!features.shared_vaults,
      tier_name: profile.tier?.name ?? 'free',
      tier_display_name: profile.tier?.display_name ?? 'Free',
      is_team_member: profile.is_team_member,
    };

    // Cache tier capabilities for offline/degraded mode
    try {
      const settings = readSettings();
      settings.cached_tier_capabilities = capabilities;
      settings.cached_tier_timestamp = new Date().toISOString();
      settings.cached_user_email = authState.user?.email;
      writeSettings(settings);
    } catch (err) {
      console.warn('[ai:ipc] Failed to cache tier capabilities:', err);
    }

    return capabilities;
  });

  /** Returns cached tier capabilities from settings (for offline mode). */
  ipcMain.handle('ai_get_cached_tier_capabilities', async () => {
    try {
      const settings = readSettings();
      if (!settings.cached_tier_capabilities || !settings.cached_tier_timestamp) return null;
      const age = Date.now() - new Date(settings.cached_tier_timestamp).getTime();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (age > sevenDays) return null;
      return settings.cached_tier_capabilities;
    } catch {
      return null;
    }
  });
}
