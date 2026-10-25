import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import db
from app.api.v1.router import api_router
from app.services.seed_data import init_seed_data

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize seed enterprise data if empty
    existing_users = db.query("users")
    if not existing_users:
        print("[INFO] No existing users detected in datastore. Initializing enterprise seed dataset...")
        init_seed_data()
    else:
        print(f"[INFO] STOCKPILOT AI initialized with {len(existing_users)} existing user records.")
    yield

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Triwizathon Problem Statement 2: Multi-Warehouse Distribution Intelligence & Inventory Optimization Engine with OR-Tools, IoT, and WhatsApp.",
    version=settings.VERSION,
    lifespan=lifespan,
    openapi_url="/api/v1/openapi.json",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS Middleware (Explicit Origins & Methods - No Wildcards with Credentials)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_origin_regex=r"^chrome-extension://[a-z]{32}$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-IoT-Key", "X-Device-ID", "X-Device-API-Key", "X-API-Key", "X-Bridge-Key", "X-Extension-Key"],
)

# Mount API Router
app.include_router(api_router, prefix=settings.API_V1_STR)

@app.get("/health", tags=["System Health"])
def health_check():
    wh_count = len(db.query("warehouses"))
    prd_count = len(db.query("products"))
    user_count = len(db.query("users"))
    dev_count = len(db.query("iot_devices"))
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "database": "TransactionalDataStore (Firestore Schema Mirror)",
        "warehouses_active": wh_count,
        "products_cataloged": prd_count,
        "users_registered": user_count,
        "iot_devices_online": dev_count
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
