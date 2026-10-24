from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, Query
from app.core.database import db
from app.api.deps import get_current_user, require_permission
from app.core.permissions import PERM_AUDIT_VIEW

router = APIRouter(prefix="/audit", tags=["Audit Ledger"])

@router.get("", response_model=List[Dict[str, Any]])
def list_audit_logs(
    target_entity: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    current_user: dict = Depends(require_permission(PERM_AUDIT_VIEW))
):
    org_id = current_user["org_id"] if current_user.get("role") != "super_admin" else None
    filters = {}
    if target_entity:
        filters["target_entity"] = target_entity

    logs = db.query(
        "audit_logs",
        filters=filters,
        org_id=org_id,
        order_by="timestamp",
        descending=True,
        limit=limit
    )
    return logs
