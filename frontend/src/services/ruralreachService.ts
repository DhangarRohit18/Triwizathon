/**
 * StockPilot AI — RuralReach Offline Synchronization Service
 * Handles snapshot synchronization, queued transaction commits,
 * and conflict isolation for remote low-bandwidth rural hubs.
 */

import { api } from './api';
import { offlineStorage, QueuedTransaction } from './offlineStorage';

export interface SyncOutcome {
  success: boolean;
  synced_count: number;
  conflict_count: number;
  total_processed: number;
  results: Array<{
    transaction_id: string;
    status: 'COMMITTED' | 'ALREADY_COMMITTED' | 'NEEDS_REVIEW' | 'REJECTED';
    action?: string;
    message?: string;
    conflict_id?: string;
    server_confirmed_at?: string;
  }>;
  synced_at: string;
}

export interface RuralReachConflict {
  id: string;
  transaction_id: string;
  device_id: string;
  warehouse_id: string;
  product_id?: string;
  action: string;
  reason: string;
  requested_quantity?: number;
  server_available_quantity?: number;
  status: 'NEEDS_REVIEW' | 'RESOLVED' | 'DISCARDED';
  created_at: string;
  payload: Record<string, any>;
}

class RuralReachService {
  private onlineStatusListeners: Array<(online: boolean) => void> = [];
  private isCurrentlyOnline: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleNetworkChange(true));
      window.addEventListener('offline', () => this.handleNetworkChange(false));
    }
  }

  private handleNetworkChange(online: boolean) {
    this.isCurrentlyOnline = online;
    this.onlineStatusListeners.forEach((listener) => {
      try {
        listener(online);
      } catch (e) {
        console.error('Error in online status listener:', e);
      }
    });

    if (online) {
      console.log('📶 RuralReach: Connection restored. Ready for background queue synchronization.');
    } else {
      console.log('📡 RuralReach: Offline mode engaged. All mutations logged to durable local queue.');
    }
  }

  public isOnline(): boolean {
    return this.isCurrentlyOnline;
  }

  public subscribeOnlineStatus(callback: (online: boolean) => void): () => void {
    this.onlineStatusListeners.push(callback);
    callback(this.isCurrentlyOnline);
    return () => {
      this.onlineStatusListeners = this.onlineStatusListeners.filter((l) => l !== callback);
    };
  }

  // ---------------------------------------------------------------------------
  // 1. Download Compressed Lightweight Snapshot
  // ---------------------------------------------------------------------------
  public async downloadSnapshot(warehouseId?: string): Promise<any> {
    const query = warehouseId ? `?warehouse_id=${encodeURIComponent(warehouseId)}` : '';
    const res = await fetch(`/api/v1/ruralreach/snapshot${query}`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('stockpilot_token') || ''}`,
      },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Failed to download RuralReach snapshot');
    }

    const data = await res.json();
    await offlineStorage.saveSnapshot(data);
    return data;
  }

  // ---------------------------------------------------------------------------
  // 2. Synchronize Pending Queue
  // ---------------------------------------------------------------------------
  public async syncPendingQueue(warehouseId: string): Promise<SyncOutcome> {
    const queue = await offlineStorage.getPendingQueue();
    const pendingItems = queue.filter((item) => item.status === 'PENDING');

    if (pendingItems.length === 0) {
      return {
        success: true,
        synced_count: 0,
        conflict_count: 0,
        total_processed: 0,
        results: [],
        synced_at: new Date().toISOString(),
      };
    }

    // Mark items as SYNCING in local storage
    for (const item of pendingItems) {
      await offlineStorage.updateQueueItemStatus(item.transaction_id, 'SYNCING');
    }

    try {
      const payload = {
        device_id: offlineStorage.getDeviceId(),
        warehouse_id: warehouseId,
        client_sync_time: new Date().toISOString(),
        transactions: pendingItems.map((item) => ({
          transaction_id: item.transaction_id,
          action: item.action,
          payload: item.payload,
          timestamp: item.timestamp,
          client_notes: item.client_notes,
          device_id: item.device_id,
        })),
      };

      const res = await fetch('/api/v1/ruralreach/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('stockpilot_token') || ''}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        // Reset items to PENDING on network error
        for (const item of pendingItems) {
          await offlineStorage.updateQueueItemStatus(item.transaction_id, 'PENDING');
        }
        throw new Error(err.detail || 'Failed to sync offline batch');
      }

      const outcome: SyncOutcome = await res.json();

      const committedIds: string[] = [];
      for (const r of outcome.results) {
        if (r.status === 'COMMITTED' || r.status === 'ALREADY_COMMITTED') {
          committedIds.push(r.transaction_id);
        } else if (r.status === 'NEEDS_REVIEW') {
          await offlineStorage.updateQueueItemStatus(r.transaction_id, 'NEEDS_REVIEW', r.message);
        } else if (r.status === 'REJECTED') {
          await offlineStorage.updateQueueItemStatus(r.transaction_id, 'REJECTED', r.message);
        }
      }

      // Purge committed items from the local outbox
      if (committedIds.length > 0) {
        await offlineStorage.removeQueueItems(committedIds);
      }

      return outcome;
    } catch (err) {
      // Revert in-flight status
      for (const item of pendingItems) {
        await offlineStorage.updateQueueItemStatus(item.transaction_id, 'PENDING');
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Conflict Retrieval & Resolution
  // ---------------------------------------------------------------------------
  public async getConflicts(warehouseId?: string): Promise<RuralReachConflict[]> {
    const query = warehouseId ? `?warehouse_id=${encodeURIComponent(warehouseId)}` : '';
    const res = await fetch(`/api/v1/ruralreach/conflicts${query}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('stockpilot_token') || ''}`,
      },
    });

    if (!res.ok) {
      throw new Error('Failed to retrieve RuralReach sync conflicts');
    }
    return res.json();
  }

  public async resolveConflict(
    conflictId: string,
    resolutionAction: 'APPROVE_OVERRIDE' | 'DISCARD_DRAFT' | 'ADJUST_DIFFERENCE',
    notes?: string,
    adjustedQuantity?: number
  ): Promise<any> {
    const res = await fetch(`/api/v1/ruralreach/conflicts/${conflictId}/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('stockpilot_token') || ''}`,
      },
      body: JSON.stringify({
        resolution_action: resolutionAction,
        notes,
        adjusted_quantity: adjustedQuantity,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Failed to resolve conflict');
    }
    return res.json();
  }
}

export const ruralreachService = new RuralReachService();
