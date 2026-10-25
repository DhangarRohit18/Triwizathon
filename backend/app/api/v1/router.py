from fastapi import APIRouter
from app.api.v1.auth import router as auth_router
from app.api.v1.warehouses import router as warehouses_router
from app.api.v1.products import router as products_router
from app.api.v1.inventory import router as inventory_router
from app.api.v1.transfers import router as transfers_router
from app.api.v1.optimization import router as optimization_router
from app.api.v1.forecast import router as forecast_router
from app.api.v1.iot import router as iot_router
from app.api.v1.whatsapp import router as whatsapp_router
from app.api.v1.audit import router as audit_router
from app.api.v1.extension import router as extension_router
from app.api.v1.express import router as express_router
from app.api.v1.tasks import router as tasks_router
from app.api.v1.ruralreach import router as ruralreach_router

api_router = APIRouter()

api_router.include_router(auth_router)
api_router.include_router(warehouses_router)
api_router.include_router(products_router)
api_router.include_router(inventory_router)
api_router.include_router(transfers_router)
api_router.include_router(optimization_router)
api_router.include_router(forecast_router)
api_router.include_router(iot_router)
api_router.include_router(whatsapp_router)
api_router.include_router(audit_router)
api_router.include_router(extension_router)
api_router.include_router(express_router)
api_router.include_router(tasks_router)
api_router.include_router(ruralreach_router)
