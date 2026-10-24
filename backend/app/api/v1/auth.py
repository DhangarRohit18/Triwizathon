from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from app.core.config import settings
from app.core.database import db
from app.core.security import verify_password, get_password_hash, create_access_token, ROLE_SUPER_ADMIN, ROLE_ORG_ADMIN, ROLE_OPERATOR
from app.models.domain import UserLogin, Token, UserResponse, UserInvite, RoleEnum
from app.api.deps import get_current_user, require_roles
from app.services.audit_service import AuditService

router = APIRouter(prefix="/auth", tags=["Authentication & Roles"])

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

    token = create_access_token(
        subject=user["id"],
        extra_claims={
            "role": user["role"],
            "org_id": user["org_id"],
            "email": user["email"]
        }
    )

    now_iso = datetime.now(timezone.utc).isoformat()
    user_res = UserResponse(
        id=user["id"],
        email=user["email"],
        full_name=user["full_name"],
        role=user["role"],
        org_id=user["org_id"],
        warehouse_id=user.get("warehouse_id"),
        phone_number=user.get("phone_number"),
        is_active=user.get("is_active", True),
        created_at=user.get("created_at", now_iso),
        updated_at=user.get("updated_at", now_iso)
    )

    return Token(access_token=token, token_type="bearer", user=user_res)

@router.get("/me", response_model=UserResponse)
def get_me(current_user: dict = Depends(get_current_user)):
    now_iso = datetime.now(timezone.utc).isoformat()
    return UserResponse(
        id=current_user["id"],
        email=current_user["email"],
        full_name=current_user["full_name"],
        role=current_user["role"],
        org_id=current_user["org_id"],
        warehouse_id=current_user.get("warehouse_id"),
        phone_number=current_user.get("phone_number"),
        is_active=current_user.get("is_active", True),
        created_at=current_user.get("created_at", now_iso),
        updated_at=current_user.get("updated_at", now_iso)
    )

@router.post("/invite", response_model=UserResponse)
def invite_user(
    req: UserInvite,
    current_user: dict = Depends(require_roles([ROLE_SUPER_ADMIN, ROLE_ORG_ADMIN]))
):
    """
    Organization Administrator creates or invites a user (e.g. operator, manager)
    and binds them to an organization and warehouse. Privileged roles strictly validated.
    """
    # Prevent assigning Super Admin unless current user is Super Admin
    if req.role == RoleEnum.SUPER_ADMIN and current_user.get("role") != ROLE_SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Only Super Admins can provision other Super Admins.")

    # Check if user already exists
    existing = db.query("users", filters={"email": req.email.strip().lower()})
    if existing:
        raise HTTPException(status_code=409, detail=f"User with email '{req.email}' already exists.")

    user_id = f"usr_{req.email.split('@')[0].replace('.', '_')}_{datetime.now().strftime('%M%S')}"
    now_iso = datetime.now(timezone.utc).isoformat()
    temp_pwd = req.temporary_password or "StockPilot2026!"

    new_user = {
        "id": user_id,
        "email": req.email.strip().lower(),
        "full_name": req.full_name,
        "role": req.role.value,
        "org_id": current_user["org_id"],
        "warehouse_id": req.warehouse_id,
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
        details={"invited_email": req.email, "role": req.role.value, "warehouse_id": req.warehouse_id}
    )

    return UserResponse(**new_user)

@router.get("/users", response_model=List[UserResponse])
def list_users(current_user: dict = Depends(get_current_user)):
    org_id = current_user["org_id"] if current_user.get("role") != ROLE_SUPER_ADMIN else None
    users = db.query("users", org_id=org_id)
    now_iso = datetime.now(timezone.utc).isoformat()
    return [
        UserResponse(
            id=u["id"],
            email=u["email"],
            full_name=u["full_name"],
            role=u["role"],
            org_id=u["org_id"],
            warehouse_id=u.get("warehouse_id"),
            phone_number=u.get("phone_number"),
            is_active=u.get("is_active", True),
            created_at=u.get("created_at", now_iso),
            updated_at=u.get("updated_at", now_iso)
        )
        for u in users
    ]

class RoleSwitchRequest(BaseModel):
    role: RoleEnum
    warehouse_id: Optional[str] = None

@router.post("/demo/switch-role", response_model=Token)
def demo_switch_role(req: RoleSwitchRequest):
    """
    Development & evaluation helper: quickly switches active role persona
    among the 6 enterprise roles to test all role dashboards.
    """
    matching_users = db.query("users", filters={"role": req.role.value})
    if not matching_users:
        raise HTTPException(status_code=404, detail=f"No seed persona found for role '{req.role.value}'")

    user = matching_users[0]
    token = create_access_token(
        subject=user["id"],
        extra_claims={
            "role": user["role"],
            "org_id": user["org_id"],
            "email": user["email"]
        }
    )
    now_iso = datetime.now(timezone.utc).isoformat()
    user_res = UserResponse(
        id=user["id"],
        email=user["email"],
        full_name=user["full_name"],
        role=user["role"],
        org_id=user["org_id"],
        warehouse_id=user.get("warehouse_id"),
        phone_number=user.get("phone_number"),
        is_active=user.get("is_active", True),
        created_at=user.get("created_at", now_iso),
        updated_at=user.get("updated_at", now_iso)
    )
    return Token(access_token=token, token_type="bearer", user=user_res)
