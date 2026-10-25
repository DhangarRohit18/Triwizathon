"""
=============================================================================
StockPilot AI - Warehouse Tasks REST API
=============================================================================
Provides real warehouse operational tasks (inbound receiving, pick & dispatch,
FEFO cycle counting, quarantine damage checks) scoped by warehouse and organization.
"""

from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.core.database import db
from app.api.deps import get_current_user
from app.core.permissions import validate_warehouse_access, get_authorized_warehouses
from app.services.audit_service import AuditService

router = APIRouter(prefix="/tasks", tags=["Warehouse Floor Tasks"])


class TaskCompleteRequest(BaseModel):
    notes: Optional[str] = None
    scanned_units: Optional[int] = None
    condition: Optional[str] = "intact"


# Default seed tasks if database collection is empty
DEFAULT_WAREHOUSE_TASKS = [
    {
        "id": "TASK-REC-01",
        "title": "Inbound Receipt: 500 vials PneuVax mRNA-1273",
        "description": "Verify cold-chain tamper seals and temperature loggers for Batch #B9921",
        "type": "receiving",
        "status": "PENDING",
        "priority": "HIGH",
        "product_sku": "PRD-VAX-01",
        "warehouse_id": "wh_chicago_01",
        "target_location": "Zone A - Cold Room Bay 03",
        "required_quantity": 500,
        "org_id": "org_triwiz_01",
        "created_at": "2026-10-24T08:00:00Z"
    },
    {
        "id": "TASK-DISP-02",
        "title": "Dispatch Pick: Express Delivery Batch #B121",
        "description": "Pick 150 units High-Protein Biscuits for fast dark-store transfer",
        "type": "dispatch",
        "status": "PENDING",
        "priority": "HIGH",
        "product_sku": "PRD-BISCUIT-B121",
        "warehouse_id": "wh_chicago_01",
        "target_location": "Dock 2 - Outbound Staging",
        "required_quantity": 150,
        "org_id": "org_triwiz_01",
        "created_at": "2026-10-24T09:30:00Z"
    },
    {
        "id": "TASK-COUNT-03",
        "title": "FEFO Cycle Count: Insulin Glargine Rack B",
        "description": "Physical variance audit for near-expiry Lot #B4412",
        "type": "cycle_count",
        "status": "PENDING",
        "priority": "MEDIUM",
        "product_sku": "PRD-INS-02",
        "warehouse_id": "wh_chicago_01",
        "target_location": "Zone B - Shelf 12",
        "required_quantity": 200,
        "org_id": "org_triwiz_01",
        "created_at": "2026-10-24T10:15:00Z"
    },
    {
        "id": "TASK-DMG-04",
        "title": "Inspect Damaged Packaging: Adrenaline Ampoules",
        "description": "Report seal breach and record discrepancy for Batch #B9931",
        "type": "damage",
        "status": "IN_PROGRESS",
        "priority": "URGENT",
        "product_sku": "PRD-ADR-03",
        "warehouse_id": "wh_chicago_01",
        "target_location": "Quarantine Bay Q-01",
        "required_quantity": 50,
        "org_id": "org_triwiz_01",
        "created_at": "2026-10-24T11:00:00Z"
    }
]


def _ensure_tasks_seeded(org_id: str):
    existing = db.query("warehouse_tasks", org_id=org_id)
    if not existing:
        for t in DEFAULT_WAREHOUSE_TASKS:
            doc = {**t, "org_id": org_id}
            db.set_document("warehouse_tasks", t["id"], doc)


@router.get("", summary="List warehouse operational tasks")
def list_tasks(
    warehouse_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: dict = Depends(get_current_user)
) -> List[Dict[str, Any]]:
    org_id = current_user["org_id"]
    _ensure_tasks_seeded(org_id)

    target_wh = warehouse_id or current_user.get("warehouse_id")
    if target_wh:
        validate_warehouse_access(current_user, target_wh)

    filters: Dict[str, Any] = {}
    if status_filter:
        filters["status"] = status_filter.upper()
    if target_wh:
        filters["warehouse_id"] = target_wh

    tasks = db.query("warehouse_tasks", filters=filters, org_id=org_id)

    # User authorized warehouse scoping
    allowed_whs = get_authorized_warehouses(current_user)
    if allowed_whs is not None:
        tasks = [t for t in tasks if t.get("warehouse_id") in allowed_whs]

    return tasks


@router.post("/{task_id}/complete", summary="Mark task completed with audit confirmation")
def complete_task(
    task_id: str,
    req: TaskCompleteRequest,
    current_user: dict = Depends(get_current_user)
) -> Dict[str, Any]:
    org_id = current_user["org_id"]
    task = db.get_document("warehouse_tasks", task_id)
    if not task or task.get("org_id") != org_id:
        raise HTTPException(status_code=404, detail="Warehouse task not found.")

    validate_warehouse_access(current_user, task.get("warehouse_id"))

    now_iso = datetime.now(timezone.utc).isoformat()
    updates = {
        "status": "COMPLETED",
        "completed_by_id": current_user["id"],
        "completed_by_name": current_user.get("full_name", "Operator"),
        "completed_at": now_iso,
        "completion_notes": req.notes,
        "scanned_units": req.scanned_units,
        "condition": req.condition
    }
    db.set_document("warehouse_tasks", task_id, updates)

    AuditService.log_event(
        org_id=org_id,
        actor_id=current_user["id"],
        actor_name=current_user.get("full_name", "Operator"),
        actor_role=current_user.get("role", "operator"),
        action="WAREHOUSE_TASK_COMPLETED",
        target_entity="warehouse_task",
        entity_id=task_id,
        details={
            "task_title": task.get("title"),
            "task_type": task.get("type"),
            "warehouse_id": task.get("warehouse_id"),
            "notes": req.notes
        }
    )

    return {
        "success": True,
        "task_id": task_id,
        "status": "COMPLETED",
        "message": f"Task '{task.get('title')}' successfully confirmed."
    }
