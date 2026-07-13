/**
 * MCP Gatekeeper — owns the local IPC socket server lifecycle.
 *
 * Conduit is a fully local, unmetered client, so the MCP server is always
 * available while the desktop app is running.
 */

import { startIpcServer, stopIpcServer } from '../ipc-server/server.js';
import type { AuthState } from './auth/supabase.js';

export class McpGatekeeper {
  private ipcServerRunning = false;
  private mcpAllowed = true;

  /** Start the always-available local IPC server after AppState is constructed. */
  start(): void {
    this.startServer();
  }

  /**
   * Evaluate whether MCP access should be allowed based on the current auth state.
   * Starts or stops the IPC server accordingly.
   */
  evaluateAccess(authState: AuthState): void {
    void authState;
    // Kept as a no-op compatibility hook for AuthService state listeners.
  }

  /** Returns whether MCP is currently allowed. */
  isAllowed(): boolean {
    return this.mcpAllowed;
  }

  /** Clean shutdown for app quit. */
  shutdown(): void {
    if (this.ipcServerRunning) {
      stopIpcServer();
      this.ipcServerRunning = false;
    }
  }

  private startServer(): void {
    if (this.ipcServerRunning) return;

    startIpcServer()
      .then(() => {
        this.ipcServerRunning = true;
        console.log('[mcp-gatekeeper] IPC server started');
      })
      .catch((err) => {
        console.error('[mcp-gatekeeper] Failed to start IPC server:', err);
      });
  }

}
