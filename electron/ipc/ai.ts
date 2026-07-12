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

interface QuotaUsage {
  quota: number;
  count: number;
  remaining: number;
  resetAt: number | null;
}


export function registerAiHandlers(state: AppState): void {
  ipcMain.handle('ai_get_mcp_path', async () => {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'mcp', 'dist', 'index.js');
    }
    return path.resolve(app.getAppPath(), 'mcp', 'dist', 'index.js');
  });

  /** Returns the unmetered local feature set. */
  ipcMain.handle('ai_get_tier_capabilities', async () => {
    return {
      cli_agents_enabled: true,
      mcp_enabled: true,
      mcp_daily_quota: -1,
      cloud_sync_enabled: true,
      shared_vaults: true,
      tier_name: 'unlimited',
      tier_display_name: 'Unlimited',
      is_team_member: false,
    };
  });

  /** Returns the user's current MCP daily-quota usage (live count from disk). */
  ipcMain.handle('mcp_get_quota_usage', async (): Promise<QuotaUsage> => {
    return { quota: -1, count: 0, remaining: -1, resetAt: null };
  });

  /** Retained for renderer compatibility; all local capabilities are available. */
  ipcMain.handle('ai_get_cached_tier_capabilities', async () => {
    return null;
  });
}
