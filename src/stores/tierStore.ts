import { create } from 'zustand';
import { useEntryStore } from './entryStore';

interface TierStoreState {
  accessibleEntryIds: Set<string>;
  lockedEntryIds: Set<string>;
  maxConnections: number; // -1 = unlimited

  // Feature flags
  cliAgentsEnabled: boolean;
  mcpEnabled: boolean;
  mcpDailyQuota: number; // -1 = unlimited
  cloudSyncEnabled: boolean;
  sharedVaults: boolean;

  // Trial state
  isTrialing: boolean;
  trialDaysRemaining: number;
  trialEligible: boolean;
  trialUrgency: 'none' | 'subtle' | 'moderate' | 'urgent';

  // Actions
  recompute: () => void;
  isEntryLocked: (id: string) => boolean;
  canCreateEntry: () => boolean;
}

let subscriptionsInitialized = false;

export const useTierStore = create<TierStoreState>((set, get) => ({
  accessibleEntryIds: new Set<string>(),
  lockedEntryIds: new Set<string>(),
  maxConnections: -1,

  cliAgentsEnabled: true, // free tier runs Claude Code / Codex under the user's own subscription
  mcpEnabled: true, // free tier has MCP with daily quota
  mcpDailyQuota: -1,
  cloudSyncEnabled: true,
  sharedVaults: true,

  isTrialing: false,
  trialDaysRemaining: -1,
  trialEligible: false,
  trialUrgency: 'none' as const,

  recompute: () => {
    const { entries } = useEntryStore.getState();
    set({
      accessibleEntryIds: new Set(entries.map((entry) => entry.id)),
      lockedEntryIds: new Set<string>(),
      maxConnections: -1,
      cliAgentsEnabled: true,
      mcpEnabled: true,
      mcpDailyQuota: -1,
      cloudSyncEnabled: true,
      sharedVaults: true,
      isTrialing: false,
      trialDaysRemaining: -1,
      trialEligible: false,
      trialUrgency: 'none',
    });
  },

  isEntryLocked: (id: string) => {
    return get().lockedEntryIds.has(id);
  },

  canCreateEntry: () => {
    const { maxConnections } = get();
    if (maxConnections === -1) return true;

    const { entries } = useEntryStore.getState();
    const connectionCount = entries.filter((e) => e.entry_type !== 'credential' && e.entry_type !== 'document').length;
    return connectionCount < maxConnections;
  },
}));

/**
 * Initialize subscriptions to authStore and entryStore for auto-recompute.
 * Called from App.tsx after all stores are created to ensure modules are fully loaded.
 * ES module live bindings handle the circular import (tierStore ↔ entryStore) —
 * the stores are only accessed at runtime via getState(), not at import time.
 */
export function initTierSubscriptions(): void {
  if (subscriptionsInitialized) return;
  subscriptionsInitialized = true;

  useEntryStore.subscribe((state, prevState) => {
    if (state.entries !== prevState.entries) {
      useTierStore.getState().recompute();
    }
  });

  // Run initial computation
  useTierStore.getState().recompute();
}
