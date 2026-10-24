from fastapi import APIRouter, Depends, HTTPException, Query
from app.models.domain import ProductForecastResult
from app.api.deps import get_current_user
from app.services.forecast_service import DemandForecastingService

router = APIRouter(prefix="/forecast", tags=["Demand Forecasting Engine"])

@router.get("/product/{product_id}", response_model=ProductForecastResult)
def get_product_forecast(
    product_id: str,
    horizon_days: int = Query(14, ge=7, le=30),
    current_user: dict = Depends(get_current_user)
):
    org_id = current_user["org_id"]
    res = DemandForecastingService.generate_product_forecast(
        product_id=product_id,
        org_id=org_id,
        horizon_days=horizon_days
    )
    return res
