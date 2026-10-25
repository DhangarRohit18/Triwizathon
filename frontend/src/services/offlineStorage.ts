/**
 * StockPilot AI — RuralReach Offline Storage Engine
 * Persistent local storage utilizing IndexedDB with seamless localStorage fallback
 * for zero-connectivity rural hubs, health posts, and distribution nodes.
 */

export interface CachedProduct {
  id: string;
  sku: string;
  name: string;
  barcode: string;
  category: string;
  unit: string;
  handling: string;
  min_safety_stock: number;
  reorder_point: number;
  unit_cost: number;
}

export interface CachedInventoryItem {
  id: string;
  product_id: string;
  warehouse_id: string;
  available_quantity: number;
  reserved_quantity: number;
  damaged_quantity: number;
  safety_stock: number;
  reorder_point: number;
}

export interface CachedBatch {
  id: string;
  product_id: string;
  batch_number: string;
  expiry_date: string;
  quantity: number;
  reserved_quantity: number;
  damaged_quantity: number;
  storage_bin: string;
}

export interface CachedRecommendation {
  plan_id?: string;
  generated_at?: string;
  warehouse_id?: string;
  allocations: Array<{
    product_id: string;
    product_name?: string;
    recommended_quantity: number;
    destination_id: string;
    destination_name?: string;
    priority: string;
    rationale?: string;
  }>;
  disclaimer: string;
  is_cached: boolean;
}

export interface QueuedTransaction {
  transaction_id: string;
  action: 'RECEIVE' | 'DISPATCH' | 'DAMAGE_REPORT' | 'CYCLE_COUNT' | 'DELIVERY_CONFIRM';
  payload: Record<string, any>;
  timestamp: string;
  client_notes?: string;
  device_id: string;
  status: 'PENDING' | 'SYNCING' | 'COMMITTED' | 'NEEDS_REVIEW' | 'REJECTED';
  conflict_reason?: string;
}

export interface SyncMetadata {
  last_snapshot_at?: string;
  last_sync_at?: string;
  checksum?: string;
  warehouse_id?: string;
  warehouse_name?: string;
  device_id: string;
  pending_count: number;
}

const DB_NAME = 'StockPilotRuralReachDB';
const DB_VERSION = 1;

class OfflineStorageEngine {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;
  private isIndexedDBAvailable: boolean = typeof window !== 'undefined' && 'indexedDB' in window;
  private deviceId: string;

  constructor() {
    this.deviceId = this.getOrCreateDeviceId();
    if (this.isIndexedDBAvailable) {
      this.initPromise = this.initDB();
    }
  }

  private getOrCreateDeviceId(): string {
    if (typeof window === 'undefined') return 'node-runtime';
    let id = localStorage.getItem('ruralreach_device_id');
    if (!id) {
      id = `rural-dev-${Math.random().toString(36).substring(2, 10)}-${Date.now().toString(36)}`;
      localStorage.setItem('ruralreach_device_id', id);
    }
    return id;
  }

  public getDeviceId(): string {
    return this.deviceId;
  }

  private async initDB(): Promise<void> {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (e: IDBVersionChangeEvent) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('catalogue')) {
            db.createObjectStore('catalogue', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('inventory')) {
            db.createObjectStore('inventory', { keyPath: 'product_id' });
          }
          if (!db.objectStoreNames.contains('batches')) {
            db.createObjectStore('batches', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('recommendations')) {
            db.createObjectStore('recommendations', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('pending_queue')) {
            db.createObjectStore('pending_queue', { keyPath: 'transaction_id' });
          }
          if (!db.objectStoreNames.contains('metadata')) {
            db.createObjectStore('metadata', { keyPath: 'key' });
          }
        };

        req.onsuccess = (e) => {
          this.db = (e.target as IDBOpenDBRequest).result;
          resolve();
        };

        req.onerror = (e) => {
          console.warn('RuralReach IndexedDB failed, falling back to localStorage:', e);
          this.isIndexedDBAvailable = false;
          resolve();
        };
      } catch (err) {
        console.warn('RuralReach IndexedDB initialization error:', err);
        this.isIndexedDBAvailable = false;
        resolve();
      }
    });
  }

  private async ready(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  // ---------------------------------------------------------------------------
  // Snapshot Ingestion & Caching
  // ---------------------------------------------------------------------------
  public async saveSnapshot(snapshot: {
    products: CachedProduct[];
    inventory: CachedInventoryItem[];
    batches: CachedBatch[];
    recommendations: any;
    checksum: string;
    warehouse: { id: string; name: string };
    server_time: string;
  }): Promise<void> {
    await this.ready();

    if (this.db && this.isIndexedDBAvailable) {
      try {
        const tx = this.db.transaction(
          ['catalogue', 'inventory', 'batches', 'recommendations', 'metadata'],
          'readwrite'
        );

        // 1. Products
        const catStore = tx.objectStore('catalogue');
        catStore.clear();
        for (const p of snapshot.products) {
          catStore.put(p);
        }

        // 2. Inventory
        const invStore = tx.objectStore('inventory');
        invStore.clear();
        for (const i of snapshot.inventory) {
          invStore.put(i);
        }

        // 3. Batches
        const batStore = tx.objectStore('batches');
        batStore.clear();
        for (const b of snapshot.batches) {
          batStore.put(b);
        }

        // 4. Recommendations
        const recStore = tx.objectStore('recommendations');
        recStore.put({
          key: 'latest',
          data: snapshot.recommendations,
          cached_at: new Date().toISOString()
        });

        // 5. Metadata
        const metaStore = tx.objectStore('metadata');
        metaStore.put({
          key: 'sync_info',
          last_snapshot_at: snapshot.server_time,
          checksum: snapshot.checksum,
          warehouse_id: snapshot.warehouse.id,
          warehouse_name: snapshot.warehouse.name,
          device_id: this.deviceId,
        });

        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        return;
      } catch (err) {
        console.warn('IndexedDB snapshot write failed, using localStorage fallback', err);
      }
    }

    // LocalStorage Fallback
    localStorage.setItem('rr_catalogue', JSON.stringify(snapshot.products));
    localStorage.setItem('rr_inventory', JSON.stringify(snapshot.inventory));
    localStorage.setItem('rr_batches', JSON.stringify(snapshot.batches));
    localStorage.setItem('rr_recommendations', JSON.stringify(snapshot.recommendations));
    localStorage.setItem('rr_metadata', JSON.stringify({
      last_snapshot_at: snapshot.server_time,
      checksum: snapshot.checksum,
      warehouse_id: snapshot.warehouse.id,
      warehouse_name: snapshot.warehouse.name,
      device_id: this.deviceId,
    }));
  }

  // ---------------------------------------------------------------------------
  // Data Retrieval
  // ---------------------------------------------------------------------------
  public async getCachedCatalogue(): Promise<CachedProduct[]> {
    await this.ready();
    if (this.db && this.isIndexedDBAvailable) {
      return new Promise((resolve) => {
        const tx = this.db!.transaction('catalogue', 'readonly');
        const req = tx.objectStore('catalogue').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    }
    const raw = localStorage.getItem('rr_catalogue');
    return raw ? JSON.parse(raw) : [];
  }

  public async getCachedInventory(): Promise<CachedInventoryItem[]> {
    await this.ready();
    if (this.db && this.isIndexedDBAvailable) {
      return new Promise((resolve) => {
        const tx = this.db!.transaction('inventory', 'readonly');
        const req = tx.objectStore('inventory').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    }
    const raw = localStorage.getItem('rr_inventory');
    return raw ? JSON.parse(raw) : [];
  }

  public async getCachedBatches(): Promise<CachedBatch[]> {
    await this.ready();
    if (this.db && this.isIndexedDBAvailable) {
      return new Promise((resolve) => {
        const tx = this.db!.transaction('batches', 'readonly');
        const req = tx.objectStore('batches').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    }
    const raw = localStorage.getItem('rr_batches');
    return raw ? JSON.parse(raw) : [];
  }

  public async getCachedRecommendations(): Promise<CachedRecommendation | null> {
    await this.ready();
    if (this.db && this.isIndexedDBAvailable) {
      return new Promise((resolve) => {
        const tx = this.db!.transaction('recommendations', 'readonly');
        const req = tx.objectStore('recommendations').get('latest');
        req.onsuccess = () => resolve(req.result?.data || null);
        req.onerror = () => resolve(null);
      });
    }
    const raw = localStorage.getItem('rr_recommendations');
    return raw ? JSON.parse(raw) : null;
  }

  public async getSyncMetadata(): Promise<SyncMetadata> {
    await this.ready();
    const pending = await this.getPendingQueue();
    let meta: any = {};
    if (this.db && this.isIndexedDBAvailable) {
      meta = await new Promise((resolve) => {
        const tx = this.db!.transaction('metadata', 'readonly');
        const req = tx.objectStore('metadata').get('sync_info');
        req.onsuccess = () => resolve(req.result || {});
        req.onerror = () => resolve({});
      });
    } else {
      const raw = localStorage.getItem('rr_metadata');
      meta = raw ? JSON.parse(raw) : {};
    }

    return {
      last_snapshot_at: meta.last_snapshot_at,
      last_sync_at: meta.last_sync_at,
      checksum: meta.checksum,
      warehouse_id: meta.warehouse_id,
      warehouse_name: meta.warehouse_name,
      device_id: this.deviceId,
      pending_count: pending.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Pending Synchronization Queue (Outbox)
  // ---------------------------------------------------------------------------
  public async getPendingQueue(): Promise<QueuedTransaction[]> {
    await this.ready();
    if (this.db && this.isIndexedDBAvailable) {
      return new Promise((resolve) => {
        const tx = this.db!.transaction('pending_queue', 'readonly');
        const req = tx.objectStore('pending_queue').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    }
    const raw = localStorage.getItem('rr_pending_queue');
    return raw ? JSON.parse(raw) : [];
  }

  public async enqueueTransaction(
    action: QueuedTransaction['action'],
    payload: Record<string, any>,
    clientNotes?: string
  ): Promise<QueuedTransaction> {
    await this.ready();
    const txn: QueuedTransaction = {
      transaction_id: `RURAL-TXN-${this.deviceId.slice(-6)}-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      action,
      payload,
      timestamp: new Date().toISOString(),
      client_notes: clientNotes,
      device_id: this.deviceId,
      status: 'PENDING',
    };

    // 1. Optimistic local ledger update so the operator immediately sees updated quantities
    await this.applyOptimisticUpdate(action, payload);

    // 2. Persist in queue
    if (this.db && this.isIndexedDBAvailable) {
      await new Promise<void>((resolve, reject) => {
        const tx = this.db!.transaction('pending_queue', 'readwrite');
        tx.objectStore('pending_queue').put(txn);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } else {
      const q = await this.getPendingQueue();
      q.push(txn);
      localStorage.setItem('rr_pending_queue', JSON.stringify(q));
    }

    return txn;
  }

  public async removeQueueItems(transactionIds: string[]): Promise<void> {
    await this.ready();
    if (this.db && this.isIndexedDBAvailable) {
      await new Promise<void>((resolve, reject) => {
        const tx = this.db!.transaction('pending_queue', 'readwrite');
        const store = tx.objectStore('pending_queue');
        for (const id of transactionIds) {
          store.delete(id);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } else {
      const q = await this.getPendingQueue();
      const filtered = q.filter((i) => !transactionIds.includes(i.transaction_id));
      localStorage.setItem('rr_pending_queue', JSON.stringify(filtered));
    }
  }

  public async updateQueueItemStatus(
    transactionId: string,
    status: QueuedTransaction['status'],
    reason?: string
  ): Promise<void> {
    await this.ready();
    if (this.db && this.isIndexedDBAvailable) {
      const tx = this.db!.transaction('pending_queue', 'readwrite');
      const store = tx.objectStore('pending_queue');
      const req = store.get(transactionId);
      req.onsuccess = () => {
        if (req.result) {
          const updated = { ...req.result, status, conflict_reason: reason };
          store.put(updated);
        }
      };
    } else {
      const q = await this.getPendingQueue();
      const item = q.find((i) => i.transaction_id === transactionId);
      if (item) {
        item.status = status;
        if (reason) item.conflict_reason = reason;
        localStorage.setItem('rr_pending_queue', JSON.stringify(q));
      }
    }
  }

  public async clearPendingQueue(): Promise<void> {
    await this.ready();
    if (this.db && this.isIndexedDBAvailable) {
      const tx = this.db!.transaction('pending_queue', 'readwrite');
      tx.objectStore('pending_queue').clear();
    } else {
      localStorage.removeItem('rr_pending_queue');
    }
  }

  // ---------------------------------------------------------------------------
  // Optimistic Offline Ledger Updates
  // ---------------------------------------------------------------------------
  private async applyOptimisticUpdate(
    action: QueuedTransaction['action'],
    payload: Record<string, any>
  ): Promise<void> {
    const invList = await this.getCachedInventory();
    const batchList = await this.getCachedBatches();
    const prodId = payload.product_id;

    if (action === 'RECEIVE') {
      const qty = Number(payload.quantity) || 0;
      let matched = invList.find((i) => i.product_id === prodId);
      if (matched) {
        matched.available_quantity += qty;
      } else {
        invList.push({
          id: `inv-opt-${prodId}`,
          product_id: prodId,
          warehouse_id: payload.warehouse_id || '',
          available_quantity: qty,
          reserved_quantity: 0,
          damaged_quantity: 0,
          safety_stock: 50,
          reorder_point: 100,
        });
      }

      // Add optimistic batch
      const newBatch: CachedBatch = {
        id: `bat-opt-${Date.now()}`,
        product_id: prodId,
        batch_number: payload.batch_number || `OFFLINE-${Date.now().toString().slice(-4)}`,
        expiry_date: payload.expiry_date || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
        quantity: qty,
        reserved_quantity: 0,
        damaged_quantity: 0,
        storage_bin: payload.storage_bin || 'LOCAL-STAGE',
      };
      batchList.push(newBatch);
    } else if (action === 'DISPATCH') {
      const qty = Number(payload.quantity) || 0;
      const matched = invList.find((i) => i.product_id === prodId);
      if (matched) {
        matched.available_quantity = Math.max(0, matched.available_quantity - qty);
      }
    } else if (action === 'DAMAGE_REPORT') {
      const dmgQty = Number(payload.damaged_quantity) || 0;
      const bId = payload.batch_id;
      const batch = batchList.find((b) => b.id === bId);
      if (batch) {
        batch.quantity = Math.max(0, batch.quantity - dmgQty);
        batch.damaged_quantity = (batch.damaged_quantity || 0) + dmgQty;
      }
      const matched = invList.find((i) => i.product_id === prodId || (batch && i.product_id === batch.product_id));
      if (matched) {
        matched.available_quantity = Math.max(0, matched.available_quantity - dmgQty);
        matched.damaged_quantity = (matched.damaged_quantity || 0) + dmgQty;
      }
    } else if (action === 'CYCLE_COUNT') {
      const counted = Number(payload.counted_quantity) || 0;
      const bId = payload.batch_id;
      const batch = batchList.find((b) => b.id === bId);
      if (batch) {
        const diff = counted - batch.quantity;
        batch.quantity = counted;
        const matched = invList.find((i) => i.product_id === batch.product_id);
        if (matched) {
          matched.available_quantity = Math.max(0, matched.available_quantity + diff);
        }
      }
    }

    // Save updated collections
    await this.writeInventoryAndBatches(invList, batchList);
  }

  public async writeInventoryAndBatches(
    inv: CachedInventoryItem[],
    batches: CachedBatch[]
  ): Promise<void> {
    await this.ready();
    if (this.db && this.isIndexedDBAvailable) {
      const tx = this.db!.transaction(['inventory', 'batches'], 'readwrite');
      const invStore = tx.objectStore('inventory');
      invStore.clear();
      for (const i of inv) invStore.put(i);

      const batStore = tx.objectStore('batches');
      batStore.clear();
      for (const b of batches) batStore.put(b);
    } else {
      localStorage.setItem('rr_inventory', JSON.stringify(inv));
      localStorage.setItem('rr_batches', JSON.stringify(batches));
    }
  }

  // ---------------------------------------------------------------------------
  // Fast Local Barcode & SKU Lookup
  // ---------------------------------------------------------------------------
  public async lookupBarcode(code: string): Promise<{
    product?: CachedProduct;
    inventory?: CachedInventoryItem;
    batches: CachedBatch[];
  }> {
    const clean = code.trim().toLowerCase();
    const catalogue = await this.getCachedCatalogue();
    const inventory = await this.getCachedInventory();
    const batches = await this.getCachedBatches();

    const product = catalogue.find(
      (p) =>
        p.id.toLowerCase() === clean ||
        p.sku.toLowerCase() === clean ||
        (p.barcode && p.barcode.toLowerCase() === clean)
    );

    if (!product) {
      // Check if code matches a batch number
      const batchMatch = batches.find((b) => b.batch_number.toLowerCase() === clean || b.id.toLowerCase() === clean);
      if (batchMatch) {
        const prod = catalogue.find((p) => p.id === batchMatch.product_id);
        const inv = inventory.find((i) => i.product_id === batchMatch.product_id);
        return {
          product: prod,
          inventory: inv,
          batches: [batchMatch],
        };
      }
      return { batches: [] };
    }

    const inv = inventory.find((i) => i.product_id === product.id);
    const relatedBatches = batches.filter((b) => b.product_id === product.id);

    return {
      product,
      inventory: inv,
      batches: relatedBatches,
    };
  }
}

export const offlineStorage = new OfflineStorageEngine();
