from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from app.core.config import settings
from app.core.database import db
from app.core.security import (
    verify_password, 
    get_password_hash, 
    create_access_token, 
    ROLE_SUPER_ADMIN, 
    ROLE_ORG_ADMIN, 
    ROLE_OPERATOR
)
from app.core.permissions import (
    PERM_USERS_MANAGE,
    PERM_ROLES_ASSIGN,
    get_user_effective_permissions,
    normalize_role,
    user_has_permission
)
from app.models.domain import (
    UserLogin, 
    Token, 
    UserResponse, 
    UserInvite, 
    UserUpdateRequest,
    RoleEnum
)
from app.api.deps import get_current_user, require_permission
from app.services.audit_service import AuditService

router = APIRouter(prefix="/auth", tags=["Authentication & Roles"])

def _format_user_response(user: Dict[str, Any]) -> UserResponse:
    now_iso = datetime.now(timezone.utc).isoformat()
    effective_perms = list(get_user_effective_permissions(user))
    return UserResponse(
        id=user["id"],
        email=user["email"],
        full_name=user["full_name"],
        role=user["role"],
        org_id=user["org_id"],
        warehouse_id=user.get("warehouse_id"),
        warehouse_ids=user.get("warehouse_ids", [user["warehouse_id"]] if user.get("warehouse_id") else []),
        permissions=effective_perms,
        phone_number=user.get("phone_number"),
        is_active=user.get("is_active", True),
        created_at=user.get("created_at", now_iso),
        updated_at=user.get("updated_at", now_iso)
    )

@router.post("/login", response_model=Token)
def login(req: UserLogin):
    users = db.query("users", filters={"email": req.email.strip().lower()})
    if not users:
        # Check case-insensitive
        all_users = db.query("users")
        users = [u for u in all_users if u.get("email", "").lower() == req.email.strip().lower()]

    if not users:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password."
        )

    user = users[0]
    if not verify_password(req.password, user.get("hashed_password", "")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password."
        )

    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account has been deactivated.")

    effective_perms = list(get_user_effective_permissions(user))

    token = create_access_token(
        subject=user["id"],
        extra_claims={
            "role": user["role"],
            "org_id": user["org_id"],
            "email": user["email"],
            "warehouse_id": user.get("warehouse_id"),
            "permissions": effective_perms
        }
    )

    return Token(access_token=token, token_type="bearer", user=_format_user_response(user))

@router.get("/me", response_model=UserResponse)
def get_me(current_user: dict = Depends(get_current_user)):
    return _format_user_response(current_user)

@router.get("/users", response_model=List[UserResponse])
def list_users(current_user: dict = Depends(require_permission(PERM_USERS_MANAGE))):
    """
    List users filtered by organization scope. Super Admin can view all organizations.
    """
    org_id = current_user["org_id"] if current_user.get("role") != ROLE_SUPER_ADMIN else None
    users = db.query("users", org_id=org_id)
    return [_format_user_response(u) for u in users]

@router.post("/invite", response_model=UserResponse)
def invite_user(
    req: UserInvite,
    current_user: dict = Depends(require_permission(PERM_USERS_MANAGE))
):
    """
    Organization Administrator creates or invites a user (e.g. operator, manager)
    and binds them to an organization, role, and location scopes.
    """
    role_val = req.role.value
    # Prevent assigning Super Admin unless current user is Super Admin
    if role_val == ROLE_SUPER_ADMIN and current_user.get("role") != ROLE_SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Only Super Admins can provision other Super Admins.")

    # Prevent granting permissions beyond caller's own permissions
    if req.permissions and current_user.get("role") != ROLE_SUPER_ADMIN:
        caller_perms = get_user_effective_permissions(current_user)
        for p in req.permissions:
            if p not in caller_perms:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Cannot grant permission '{p}' exceeding your administrative privilege scope."
                )

    # Check if user already exists
    existing = db.query("users", filters={"email": req.email.strip().lower()})
    if existing:
        raise HTTPException(status_code=409, detail=f"User with email '{req.email}' already exists.")

    user_id = f"usr_{req.email.split('@')[0].replace('.', '_')}_{datetime.now().strftime('%M%S')}"
    now_iso = datetime.now(timezone.utc).isoformat()
    temp_pwd = req.temporary_password or "StockPilot2026!"

    warehouse_scope = req.warehouse_id
    warehouse_scopes = req.warehouse_ids or ([req.warehouse_id] if req.warehouse_id else [])

    new_user = {
        "id": user_id,
        "email": req.email.strip().lower(),
        "full_name": req.full_name,
        "role": role_val,
        "org_id": current_user["org_id"],
        "warehouse_id": warehouse_scope,
        "warehouse_ids": warehouse_scopes,
        "permissions": req.permissions or [],
        "phone_number": None,
        "hashed_password": get_password_hash(temp_pwd),
        "is_active": True,
        "created_at": now_iso,
        "updated_at": now_iso,
        "invited_by": current_user["id"]
    }

    db.set_document("users", user_id, new_user)

    AuditService.log_event(
        org_id=current_user["org_id"],
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        action="USER_INVITED",
        target_entity="user",
        entity_id=user_id,
        details={
            "invited_email": req.email, 
            "role": role_val, 
            "warehouse_id": warehouse_scope,
            "warehouse_ids": warehouse_scopes
        }
    )

    return _format_user_response(new_user)

@router.put("/users/{user_id}", response_model=UserResponse)
def update_user_profile(
    user_id: str,
    req: UserUpdateRequest,
    current_user: dict = Depends(require_permission(PERM_USERS_MANAGE))
):
    """
    Admin updates user role, warehouse scopes, permissions, or activation state.
    Guards against unauthorized self-promotion, privilege escalation, and deactivating the final org_admin.
    """
    target_user = db.get_document("users", user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User account not found.")

    # Cross-org protection
    if current_user.get("role") != ROLE_SUPER_ADMIN and target_user.get("org_id") != current_user["org_id"]:
        raise HTTPException(status_code=403, detail="Cross-organization user modification denied.")

    # Self-promotion / self-role change prevention
    if user_id == current_user["id"] and req.role is not None and req.role.value != current_user.get("role"):
        if current_user.get("role") != ROLE_SUPER_ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Self-promotion / self-role change forbidden. Roles can only be reassigned by another administrator."
            )

    # Super Admin assignment check
    if req.role and req.role.value == ROLE_SUPER_ADMIN and current_user.get("role") != ROLE_SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Only Super Admins can promote to Super Admin.")

    # Privilege escalation prevention via custom permissions
    if req.permissions is not None and current_user.get("role") != ROLE_SUPER_ADMIN:
        caller_perms = get_user_effective_permissions(current_user)
        for p in req.permissions:
            if p not in caller_perms:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Cannot grant permission '{p}' exceeding your administrative privilege scope."
                )
        if user_id == current_user["id"]:
            existing_perms = set(target_user.get("permissions") or [])
            if any(p not in existing_perms for p in req.permissions):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Self-elevation of permissions forbidden."
                )

    # Prevent self-deactivation
    if user_id == current_user["id"] and req.is_active is False:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate your own active session."
        )

    # Prevent deactivating or demoting the last active Org Admin
    if target_user.get("role") == ROLE_ORG_ADMIN:
        will_deactivate = req.is_active is False
        will_demote = req.role and req.role.value != ROLE_ORG_ADMIN
        if will_deactivate or will_demote:
            active_admins = [
                u for u in db.query("users", org_id=target_user["org_id"])
                if u.get("role") == ROLE_ORG_ADMIN and u.get("is_active", True) and u["id"] != user_id
            ]
            if not active_admins:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot deactivate or demote the final required organization administrator without a safe replacement."
                )

    now_iso = datetime.now(timezone.utc).isoformat()
    changes: Dict[str, Any] = {"updated_at": now_iso}

    if req.full_name is not None:
        changes["full_name"] = req.full_name
    if req.role is not None:
        changes["role"] = req.role.value
    if req.warehouse_id is not None:
        changes["warehouse_id"] = req.warehouse_id
    if req.warehouse_ids is not None:
        changes["warehouse_ids"] = req.warehouse_ids
    if req.permissions is not None:
        changes["permissions"] = req.permissions
    if req.is_active is not None:
        changes["is_active"] = req.is_active

    db.set_document("users", user_id, changes)
    updated_user = db.get_document("users", user_id)

    AuditService.log_event(
        org_id=current_user["org_id"],
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        action="USER_PROFILE_UPDATED",
        target_entity="user",
        entity_id=user_id,
        details={k: v for k, v in changes.items() if k != "updated_at"}
    )

    return _format_user_response(updated_user)

@router.post("/users/{user_id}/toggle-active", response_model=UserResponse)
def toggle_user_active(
    user_id: str,
    current_user: dict = Depends(require_permission(PERM_USERS_MANAGE))
):
    target_user = db.get_document("users", user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found.")

    new_active = not target_user.get("is_active", True)
    req = UserUpdateRequest(is_active=new_active)
    return update_user_profile(user_id=user_id, req=req, current_user=current_user)

class RoleSwitchRequest(BaseModel):
    role: RoleEnum
    warehouse_id: Optional[str] = None

@router.post("/demo/switch-role", response_model=Token)
def demo_switch_role(req: RoleSwitchRequest):
    """
    Development & evaluation helper: quickly switches active role persona
    among the 6 enterprise roles to test all role dashboards.
    Disabled in production mode.
    """
    if not settings.ALLOW_DEMO_MODE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Role simulation is disabled in production environments."
        )

    matching_users = db.query("users", filters={"role": req.role.value})
    if not matching_users:
        raise HTTPException(status_code=404, detail=f"No seed persona found for role '{req.role.value}'")

    user = matching_users[0]
    effective_perms = list(get_user_effective_permissions(user))
    token = create_access_token(
        subject=user["id"],
        extra_claims={
            "role": user["role"],
            "org_id": user["org_id"],
            "email": user["email"],
            "warehouse_id": user.get("warehouse_id"),
            "permissions": effective_perms
        }
    )
    return Token(access_token=token, token_type="bearer", user=_format_user_response(user))
