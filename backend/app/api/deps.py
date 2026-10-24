from typing import Generator, Optional, List
from fastapi import Depends, HTTPException, status, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings
from app.core.security import decode_access_token, ROLE_HIERARCHY, ROLE_SUPER_ADMIN
from app.core.database import db

security_bearer = HTTPBearer(auto_error=False)

def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_bearer),
    authorization: Optional[str] = Header(None)
) -> dict:
    token = None
    if credentials:
        token = credentials.credentials
    elif authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]

    if not token:
        # Fallback for dev convenience / unauthenticated initial requests
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = db.get_document("users", user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User account not found")

    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="User account has been deactivated")

    return user

def require_roles(allowed_roles: List[str]):
    def role_checker(user: dict = Depends(get_current_user)) -> dict:
        user_role = user.get("role")
        if user_role == ROLE_SUPER_ADMIN:
            return user  # Super Admin has global bypass
        if user_role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Role '{user_role}' lacks required permissions. Required: {allowed_roles}"
            )
        return user
    return role_checker

def verify_iot_api_key(x_api_key: Optional[str] = Header(None, alias="X-IoT-Key")) -> str:
    if not x_api_key or x_api_key != settings.IOT_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-IoT-Key header"
        )
    return x_api_key
