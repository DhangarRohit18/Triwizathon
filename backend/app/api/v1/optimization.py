from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from app.core.database import db
from app.models.domain import OptimizationRunRequest, OptimizationResult
from app.api.deps import get_current_user, require_permission
from app.core.permissions import PERM_OPTIMIZATION_RUN, PERM_OPTIMIZATION_REVIEW
from app.services.optimizer_engine import DistributionOptimizerEngine
from app.services.audit_service import AuditService

router = APIRouter(prefix="/optimization", tags=["Distribution Optimization Engine"])

@router.post("/run", response_model=OptimizationResult)
def run_optimization_engine(
    req: OptimizationRunRequest,
    current_user: dict = Depends(require_permission(PERM_OPTIMIZATION_RUN))
):
    """
    Executes Google OR-Tools constrained Mixed-Integer Linear Program (SCIP solver)
    to calculate optimal multi-warehouse allocations, comparing against baseline heuristic.
    Requires 'optimization.run' permission.
    """
    org_id = current_user["org_id"]
    res = DistributionOptimizerEngine.run_optimization(req, org_id=org_id)

    AuditService.log_event(
        org_id=org_id,
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        action="OPTIMIZATION_ENGINE_EXECUTED",
        target_entity="optimization_run",
        entity_id=res.run_id,
        details={
            "allocated_units": res.optimized.total_allocated_units,
            "modeled_cost": res.optimized.total_modeled_cost,
            "savings_percent": res.savings_percent,
            "disrupted_warehouses": req.scenario.disrupted_warehouse_ids if req.scenario else []
        }
    )

    return res

@router.get("/runs", response_model=List[OptimizationResult])
def list_optimization_runs(current_user: dict = Depends(require_permission(PERM_OPTIMIZATION_REVIEW))):
    org_id = current_user["org_id"]
    runs = db.query("optimization_runs", org_id=org_id, order_by="timestamp", descending=True, limit=20)
    return [OptimizationResult(**r) for r in runs]

@router.get("/run/{run_id}", response_model=OptimizationResult)
def get_optimization_run(run_id: str, current_user: dict = Depends(require_permission(PERM_OPTIMIZATION_REVIEW))):
    run = db.get_document("optimization_runs", run_id)
    if not run or run.get("org_id") != current_user["org_id"]:
        raise HTTPException(status_code=404, detail="Optimization run not found.")
    return OptimizationResult(**run)
