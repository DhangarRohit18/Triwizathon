from fastapi import APIRouter, Depends, HTTPException, Query
from app.models.domain import ProductForecastResult
from app.api.deps import require_permission
from app.core.permissions import PERM_FORECASTS_VIEW
from app.services.forecast_service import DemandForecastingService

router = APIRouter(prefix="/forecast", tags=["Demand Forecasting Engine"])

@router.get("/product/{product_id}", response_model=ProductForecastResult)
def get_product_forecast(
    product_id: str,
    horizon_days: int = Query(14, ge=7, le=30),
    current_user: dict = Depends(require_permission(PERM_FORECASTS_VIEW))
):
    org_id = current_user["org_id"]
    res = DemandForecastingService.generate_product_forecast(
        product_id=product_id,
        org_id=org_id,
        horizon_days=horizon_days
    )
    return res

@router.get("/evaluation/{product_id}")
def get_forecast_evaluation(
    product_id: str,
    current_user: dict = Depends(require_permission(PERM_FORECASTS_VIEW))
):
    """
    Returns holdout sample chronological evaluation metrics for ML Ridge model vs 7-day Moving Average baseline.
    """
    org_id = current_user["org_id"]
    res = DemandForecastingService.generate_product_forecast(
        product_id=product_id,
        org_id=org_id,
        horizon_days=14
    )
    return res.evaluation
