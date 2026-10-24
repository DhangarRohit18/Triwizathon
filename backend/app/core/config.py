import os
from typing import List
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "STOCKPILOT AI"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Security & JWT
    SECRET_KEY: str = os.getenv("SECRET_KEY", "stockpilot-super-secret-production-key-triwizathon-2026")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    
    # CORS
    BACKEND_CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "chrome-extension://*",
        "*"
    ]
    
    # Firebase configuration
    FIREBASE_PROJECT_ID: str = os.getenv("FIREBASE_PROJECT_ID", "triwizathon")
    FIREBASE_CREDENTIALS_PATH: str = os.getenv("FIREBASE_CREDENTIALS_PATH", "")
    USE_FIREBASE_MOCK: bool = os.getenv("USE_FIREBASE_MOCK", "true").lower() in ("true", "1", "yes")
    
    # WhatsApp Cloud API configuration
    WHATSAPP_API_TOKEN: str = os.getenv("WHATSAPP_API_TOKEN", "mock_whatsapp_token_test_123")
    WHATSAPP_PHONE_NUMBER_ID: str = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "109876543210987")
    WHATSAPP_VERIFY_TOKEN: str = os.getenv("WHATSAPP_VERIFY_TOKEN", "stockpilot_triwiz_verify_2026")
    WHATSAPP_APP_SECRET: str = os.getenv("WHATSAPP_APP_SECRET", "mock_meta_app_secret_abc123")
    
    # IoT Telemetry API
    IOT_API_KEY: str = os.getenv("IOT_API_KEY", "stockpilot-iot-secure-esp32-auth-token")
    
    # Chrome Extension API
    EXTENSION_API_KEY: str = os.getenv("EXTENSION_API_KEY", "stockpilot-ext-v3-authorized-key")

    # WhatsApp Admin Bootstrap & Registration
    ADMIN_BOOTSTRAP_SECRET: str = os.getenv("ADMIN_BOOTSTRAP_SECRET", "stockpilot-admin-bootstrap-secret-2026")
    WHATSAPP_INVITATION_EXPIRE_HOURS: int = int(os.getenv("WHATSAPP_INVITATION_EXPIRE_HOURS", "24"))
    WHATSAPP_CHALLENGE_MAX_ATTEMPTS: int = int(os.getenv("WHATSAPP_CHALLENGE_MAX_ATTEMPTS", "5"))

    class Config:
        env_file = ".env"
        case_sensitive = True

settings = Settings()
