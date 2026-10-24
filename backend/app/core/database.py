import json
import os
import threading
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any, Callable

class TransactionalDataStore:
    """
    Concurrency-safe transactional storage engine mirroring Cloud Firestore collections.
    Supports atomic multi-document transactions, organization scoping, document indexing,
    and automatic state persistence.
    """
    _instance = None
    _lock = threading.RLock()

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            with cls._lock:
                if not cls._instance:
                    cls._instance = super(TransactionalDataStore, cls).__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self, persistence_file: Optional[str] = None):
        if self._initialized:
            return
        if not persistence_file or persistence_file == "backend/data/stockpilot_store.json":
            base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            c1 = os.path.join(base_dir, "data", "stockpilot_store.json")
            c2 = os.path.join(base_dir, "backend", "data", "stockpilot_store.json")
            if os.path.exists(c1):
                self.persistence_file = c1
            elif os.path.exists(c2):
                self.persistence_file = c2
            else:
                self.persistence_file = c1
        else:
            self.persistence_file = persistence_file
        self._collections: Dict[str, Dict[str, Dict[str, Any]]] = {
            "organizations": {},
            "users": {},
            "warehouses": {},
            "destinations": {},
            "products": {},
            "inventory": {},
            "inventory_batches": {},
            "inventory_movements": {},
            "orders": {},
            "transfers": {},
            "transfer_items": {},
            "demand_history": {},
            "forecasts": {},
            "optimization_runs": {},
            "allocation_recommendations": {},
            "iot_devices": {},
            "sensor_readings": {},
            "alerts": {},
            "notification_logs": {},
            "integration_settings": {},
            "audit_logs": {},
            "processed_idempotency_keys": {},
            "iot_aggregates": {},
        }
        self.lock = threading.RLock()
        self._load_from_disk()
        self._initialized = True

    def _load_from_disk(self):
        try:
            if os.path.exists(self.persistence_file):
                with open(self.persistence_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for col_name, col_data in data.items():
                        if col_name in self._collections:
                            self._collections[col_name] = col_data
        except Exception as e:
            print(f"[WARN] Failed to load data store from {self.persistence_file}: {e}")

    def save_to_disk(self):
        try:
            os.makedirs(os.path.dirname(self.persistence_file), exist_ok=True)
            with open(self.persistence_file, "w", encoding="utf-8") as f:
                json.dump(self._collections, f, indent=2, default=str)
        except Exception as e:
            print(f"[WARN] Failed to save data store to {self.persistence_file}: {e}")

    def get_document(self, collection: str, doc_id: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            col = self._collections.get(collection, {})
            doc = col.get(doc_id)
            return dict(doc) if doc else None

    def set_document(self, collection: str, doc_id: str, data: Dict[str, Any], merge: bool = True) -> Dict[str, Any]:
        with self.lock:
            if collection not in self._collections:
                self._collections[collection] = {}
            col = self._collections[collection]
            
            now_iso = datetime.now(timezone.utc).isoformat()
            if merge and doc_id in col:
                existing = col[doc_id]
                new_ver = existing.get("_version", 1) + 1
                updated = {**existing, **data, "_version": new_ver, "updated_at": now_iso}
                col[doc_id] = updated
            else:
                updated = {
                    "id": doc_id,
                    "_version": data.get("_version", 1),
                    "created_at": data.get("created_at", now_iso),
                    "updated_at": now_iso,
                    **data
                }
                col[doc_id] = updated
            
            self.save_to_disk()
            return dict(col[doc_id])

    def delete_document(self, collection: str, doc_id: str) -> bool:
        with self.lock:
            col = self._collections.get(collection, {})
            if doc_id in col:
                del col[doc_id]
                self.save_to_disk()
                return True
            return False

    def query(
        self,
        collection: str,
        filters: Optional[Dict[str, Any]] = None,
        org_id: Optional[str] = None,
        order_by: Optional[str] = None,
        descending: bool = False,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        with self.lock:
            col = self._collections.get(collection, {})
            results = []
            
            for doc in col.values():
                # Enforce tenant isolation if org_id is provided
                if org_id is not None and doc.get("org_id") != org_id and doc.get("organization_id") != org_id:
                    continue
                
                # Check custom filters
                match = True
                if filters:
                    for k, v in filters.items():
                        if doc.get(k) != v:
                            match = False
                            break
                if match:
                    results.append(dict(doc))
            
            # Ordering
            if order_by:
                results.sort(
                    key=lambda x: str(x.get(order_by, "")),
                    reverse=descending
                )
            
            if limit and limit > 0:
                results = results[:limit]
            
            return results

    def run_transaction(self, transaction_fn: Callable[['TransactionalDataStore'], Any]) -> Any:
        """
        Executes a callable inside an exclusive write lock to ensure atomic multi-doc operations.
        Prevents race conditions in inventory mutations and transfer approvals.
        Includes complete transactional rollback if an exception is raised during execution.
        """
        import copy
        with self.lock:
            # Create isolated deep snapshot of entire store for atomic rollback
            snapshot = {col: {k: copy.deepcopy(v) for k, v in docs.items()} for col, docs in self._collections.items()}
            try:
                res = transaction_fn(self)
                self.save_to_disk()
                return res
            except Exception as e:
                # Rollback to pre-transaction state
                self._collections = snapshot
                self.save_to_disk()
                raise e

db = TransactionalDataStore()
