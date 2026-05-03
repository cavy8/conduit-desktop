/**
 * One-shot migration for stale Conduit MCP entries in the user's Claude Code
 * config (`~/.claude.json`).
 *
 * Background: prior to the open-source pivot, the desktop app and its MCP
 * lived at `~/Github/conduit/`. Users who registered the MCP via
 * `claude mcp add conduit -- node "/Users/.../conduit/mcp/dist/index.js"`
 * still have that stale path in `~/.claude.json`. The stale binary connects
 * to the new IPC socket but emits legacy `GetQuotaMirror`/`SetQuotaMirror`
 * requests the new IPC server doesn't recognise, spamming the dev console
 * and bypassing the new desktop-side daily-quota counter.
 *
 * This module rewrites such entries to the current build's MCP path on app
 * startup. Idempotent — safe to run every launch. Only touches entries that
 * are *clearly* the predecessor binary (entry name `conduit` AND args path
 * matches `/conduit/mcp/dist/index.js` or any other non-current Conduit MCP
 * dist). Leaves user-authored entries alone.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getSocketPath } from '../ipc-server/server.js';
import { getEnvConfig } from './env-config.js';

interface StdioMcpServer {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface ClaudeConfig {
  mcpServers?: Record<string, StdioMcpServer>;
  projects?: Record<string, { mcpServers?: Record<string, StdioMcpServer> }>;
  [key: string]: unknown;
}

const CONDUIT_PATH_PATTERN = /[/\\](conduit(?:-desktop)?)[/\\]mcp[/\\]dist[/\\]index\.(?:js|cjs|mjs)$/i;

function getClaudeConfigPath(): string {
  return path.join(os.homedir(), '.claude.json');
}

function isStaleConduitEntry(entry: StdioMcpServer | undefined, currentMcpPath: string): boolean {
  if (!entry || entry.command !== 'node') return false;
  const argsPath = entry.args?.[0];
  if (!argsPath || typeof argsPath !== 'string') return false;
  if (!CONDUIT_PATH_PATTERN.test(argsPath)) return false;
  // Already points at the current build → leave it.
  return path.normalize(argsPath) !== path.normalize(currentMcpPath);
}

function buildCanonicalEntry(currentMcpPath: string): StdioMcpServer {
  return {
    type: 'stdio',
    command: 'node',
    args: [currentMcpPath],
    env: {
      CONDUIT_SOCKET_PATH: getSocketPath(),
      CONDUIT_ENV: getEnvConfig().environment,
    },
  };
}

/**
 * Migrate any stale Conduit MCP entries in `~/.claude.json` to the current
 * build's path. Returns the number of entries rewritten (0 if nothing to do
 * or the file doesn't exist). Errors are logged and swallowed — the app
 * must keep starting even if Claude Code config is unreadable.
 */
export function migrateStaleConduitMcpEntries(currentMcpPath: string): number {
  const configPath = getClaudeConfigPath();
  if (!fs.existsSync(configPath)) return 0;

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (err) {
    console.warn('[mcp-migration] Could not read ~/.claude.json:', err);
    return 0;
  }

  let config: ClaudeConfig;
  try {
    config = JSON.parse(raw) as ClaudeConfig;
  } catch (err) {
    console.warn('[mcp-migration] ~/.claude.json is not valid JSON, skipping:', err);
    return 0;
  }

  let migrated = 0;
  const canonical = buildCanonicalEntry(currentMcpPath);

  // User-scope entry
  if (config.mcpServers && isStaleConduitEntry(config.mcpServers.conduit, currentMcpPath)) {
    config.mcpServers.conduit = canonical;
    migrated += 1;
  }

  // Project-scope entries
  if (config.projects && typeof config.projects === 'object') {
    for (const project of Object.values(config.projects)) {
      if (project?.mcpServers && isStaleConduitEntry(project.mcpServers.conduit, currentMcpPath)) {
        project.mcpServers.conduit = canonical;
        migrated += 1;
      }
    }
  }

  if (migrated === 0) return 0;

  // Backup once per migration so the original is recoverable if anything
  // looks wrong. Timestamped to avoid clobbering prior backups.
  try {
    const backupPath = `${configPath}.conduit-backup-${Date.now()}`;
    fs.writeFileSync(backupPath, raw, 'utf-8');
  } catch (err) {
    console.warn('[mcp-migration] Failed to write backup, aborting migration:', err);
    return 0;
  }

  // Atomic write — same pattern the MCP uses for mcp-quota.json.
  const tmpPath = `${configPath}.conduit-migration.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
    fs.renameSync(tmpPath, configPath);
    console.log(`[mcp-migration] Rewrote ${migrated} stale Conduit MCP entr${migrated === 1 ? 'y' : 'ies'} → ${currentMcpPath}`);
  } catch (err) {
    console.warn('[mcp-migration] Failed to persist migrated config:', err);
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    return 0;
  }

  return migrated;
}
