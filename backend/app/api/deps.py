from typing import Generator, Optional, List, Dict, Any
from fastapi import Depends, HTTPException, status, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings
from app.core.security import decode_access_token, ROLE_SUPER_ADMIN
from app.core.database import db
from app.core.permissions import (
    user_has_permission,
    validate_warehouse_access,
    get_authorized_warehouses,
    get_user_effective_permissions,
    normalize_role,
    PERM_CROSS_ORG_AUDIT_ACCESS,
)

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
    """Role-level access requirement (backwards compatibility)."""
    def role_checker(user: dict = Depends(get_current_user)) -> dict:
        try:
            user_role = normalize_role(user.get("role"))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. User has an invalid or unrecognized role: '{user.get('role')}'"
            )
        try:
            normalized_allowed = [normalize_role(r) for r in allowed_roles]
        except ValueError:
            normalized_allowed = allowed_roles
        if user_role == ROLE_SUPER_ADMIN:
            return user
        if user_role not in normalized_allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Role '{user_role}' lacks required permissions. Required: {allowed_roles}"
            )
        return user
    return role_checker

def require_permission(permission: str):
    """
    Centralized explicit permission requirement.
    Checks user's effective permissions (role defaults + custom granted permissions).
    """
    def permission_checker(user: dict = Depends(get_current_user)) -> dict:
        if not user_has_permission(user, permission):
            user_role = user.get("role", "unknown")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Missing required permission '{permission}'. Role: '{user_role}'"
            )
        return user
    return permission_checker

def get_scoped_warehouse_filter(current_user: dict, requested_warehouse_id: Optional[str]) -> Optional[str]:
    """
    Validates and resolves the warehouse filter according to location-scoping rules.
    - If user has restricted warehouse scope, validates that requested_warehouse_id is authorized,
      or automatically defaults to the user's primary assigned warehouse.
    - Raises 403 if user attempts to access an unauthorized location or has no assigned warehouse.
    """
    allowed = get_authorized_warehouses(current_user)
    
    if allowed is not None:
        # Restricted location user (Warehouse Manager, Operator, Distributor)
        if len(allowed) == 0:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account has no assigned warehouse facilities."
            )
        if requested_warehouse_id and requested_warehouse_id != "all":
            if requested_warehouse_id not in allowed:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Location access denied. You are only authorized for warehouse(s): {allowed}"
                )
            return requested_warehouse_id
        # When no specific warehouse requested, lock to their assigned warehouse
        return allowed[0]
    
    # Network-wide role (Super Admin, Org Admin, Supply Chain Manager)
    if requested_warehouse_id and requested_warehouse_id != "all":
        return requested_warehouse_id
    return None

def verify_iot_api_key(x_api_key: Optional[str] = Header(None, alias="X-IoT-Key")) -> str:
    if not x_api_key or x_api_key != settings.IOT_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-IoT-Key header"
        )
    return x_api_key
