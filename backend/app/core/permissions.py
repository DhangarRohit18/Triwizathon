"""
STOCKPILOT AI: CENTRALIZED ROLE-BASED ACCESS CONTROL (RBAC) & PERMISSION ENGINE
Defines explicit feature-level permissions, role defaults, and location-scoping rules.
"""

from typing import List, Set, Dict, Optional, Any
from fastapi import HTTPException, status

# =====================================================================
# 1. EXPLICIT FEATURE PERMISSIONS
# =====================================================================
PERM_ORGANIZATIONS_MANAGE = "organizations.manage"
PERM_USERS_MANAGE = "users.manage"
PERM_ROLES_ASSIGN = "roles.assign"
PERM_PRODUCTS_MANAGE = "products.manage"
PERM_WAREHOUSES_MANAGE = "warehouses.manage"
PERM_INVENTORY_VIEW = "inventory.view"
PERM_INVENTORY_RECEIVE = "inventory.receive"
PERM_INVENTORY_DISPATCH = "inventory.dispatch"
PERM_INVENTORY_ADJUST = "inventory.adjust"
PERM_BATCHES_MANAGE = "batches.manage"
PERM_FORECASTS_VIEW = "forecasts.view"
PERM_OPTIMIZATION_RUN = "optimization.run"
PERM_OPTIMIZATION_REVIEW = "optimization.review"
PERM_OPTIMIZATION_APPROVE = "optimization.approve"
PERM_TRANSFERS_VIEW = "transfers.view"
PERM_TRANSFERS_CREATE = "transfers.create"
PERM_TRANSFERS_DISPATCH = "transfers.dispatch"
PERM_TRANSFERS_RECEIVE = "transfers.receive"
PERM_IOT_DEVICES_MANAGE = "iot.devices.manage"
PERM_IOT_READINGS_VIEW = "iot.readings.view"
PERM_ALERTS_MANAGE = "alerts.manage"
PERM_REPORTS_VIEW = "reports.view"
PERM_AUDIT_VIEW = "audit.view"
PERM_INTEGRATIONS_MANAGE = "integrations.manage"
PERM_PLATFORM_HEALTH_VIEW = "platform.health.view"
PERM_SCANS_EXECUTE = "scans.execute"
PERM_DELIVERY_CONFIRM = "delivery.confirm"
PERM_TASKS_ASSIGN = "tasks.assign"
PERM_TASKS_VIEW = "tasks.view"
PERM_TASKS_EXECUTE = "tasks.execute"
PERM_DAMAGE_REPORT = "damage.report"
PERM_CROSS_ORG_AUDIT_ACCESS = "cross_org.audit_access"

# Normalized Role Names
ROLE_SUPER_ADMIN = "super_admin"
ROLE_ORG_ADMIN = "org_admin"
ROLE_SUPPLY_CHAIN_MANAGER = "supply_chain_manager"
ROLE_WAREHOUSE_MANAGER = "warehouse_manager"
ROLE_OPERATOR = "operator"
ROLE_WAREHOUSE_OPERATOR = "warehouse_operator"
ROLE_DISTRIBUTOR = "distributor"
ROLE_DISTRIBUTOR_FIELD_OPERATOR = "distributor_field_operator"

# =====================================================================
# 2. DEFAULT PERMISSIONS PER ROLE
# =====================================================================
ROLE_DEFAULT_PERMISSIONS: Dict[str, Set[str]] = {
    ROLE_SUPER_ADMIN: {
        PERM_ORGANIZATIONS_MANAGE,
        PERM_PLATFORM_HEALTH_VIEW,
        PERM_AUDIT_VIEW,
        PERM_INTEGRATIONS_MANAGE,
        PERM_USERS_MANAGE,
        PERM_REPORTS_VIEW,
        PERM_CROSS_ORG_AUDIT_ACCESS,
        PERM_IOT_READINGS_VIEW,
        PERM_INVENTORY_VIEW,
        PERM_TRANSFERS_VIEW,
    },
    ROLE_ORG_ADMIN: {
        PERM_USERS_MANAGE,
        PERM_ROLES_ASSIGN,
        PERM_PRODUCTS_MANAGE,
        PERM_WAREHOUSES_MANAGE,
        PERM_INVENTORY_VIEW,
        PERM_INVENTORY_RECEIVE,
        PERM_INVENTORY_DISPATCH,
        PERM_INVENTORY_ADJUST,
        PERM_BATCHES_MANAGE,
        PERM_TRANSFERS_VIEW,
        PERM_TRANSFERS_CREATE,
        PERM_IOT_DEVICES_MANAGE,
        PERM_IOT_READINGS_VIEW,
        PERM_ALERTS_MANAGE,
        PERM_REPORTS_VIEW,
        PERM_AUDIT_VIEW,
        PERM_INTEGRATIONS_MANAGE,
    },
    ROLE_SUPPLY_CHAIN_MANAGER: {
        PERM_INVENTORY_VIEW,
        PERM_FORECASTS_VIEW,
        PERM_OPTIMIZATION_RUN,
        PERM_OPTIMIZATION_REVIEW,
        PERM_OPTIMIZATION_APPROVE,
        PERM_TRANSFERS_VIEW,
        PERM_TRANSFERS_CREATE,
        PERM_REPORTS_VIEW,
        PERM_IOT_READINGS_VIEW,
        PERM_ALERTS_MANAGE,
    },
    ROLE_WAREHOUSE_MANAGER: {
        PERM_INVENTORY_VIEW,
        PERM_INVENTORY_RECEIVE,
        PERM_INVENTORY_DISPATCH,
        PERM_INVENTORY_ADJUST,
        PERM_BATCHES_MANAGE,
        PERM_TRANSFERS_VIEW,
        PERM_TRANSFERS_RECEIVE,
        PERM_TASKS_ASSIGN,
        PERM_IOT_READINGS_VIEW,
        PERM_ALERTS_MANAGE,
        PERM_REPORTS_VIEW,
        PERM_SCANS_EXECUTE,
    },
    ROLE_OPERATOR: {
        PERM_INVENTORY_VIEW,
        PERM_INVENTORY_RECEIVE,
        PERM_TRANSFERS_DISPATCH,
        PERM_TRANSFERS_RECEIVE,
        PERM_TASKS_VIEW,
        PERM_TASKS_EXECUTE,
        PERM_SCANS_EXECUTE,
        PERM_DAMAGE_REPORT,
    },
    ROLE_WAREHOUSE_OPERATOR: {
        PERM_INVENTORY_VIEW,
        PERM_INVENTORY_RECEIVE,
        PERM_TRANSFERS_DISPATCH,
        PERM_TRANSFERS_RECEIVE,
        PERM_TASKS_VIEW,
        PERM_TASKS_EXECUTE,
        PERM_SCANS_EXECUTE,
        PERM_DAMAGE_REPORT,
    },
    ROLE_DISTRIBUTOR: {
        PERM_TRANSFERS_VIEW,
        PERM_TRANSFERS_RECEIVE,
        PERM_TRANSFERS_DISPATCH,
        PERM_SCANS_EXECUTE,
        PERM_DELIVERY_CONFIRM,
        PERM_DAMAGE_REPORT,
        PERM_INVENTORY_VIEW,
    },
    ROLE_DISTRIBUTOR_FIELD_OPERATOR: {
        PERM_TRANSFERS_VIEW,
        PERM_TRANSFERS_RECEIVE,
        PERM_TRANSFERS_DISPATCH,
        PERM_SCANS_EXECUTE,
        PERM_DELIVERY_CONFIRM,
        PERM_DAMAGE_REPORT,
        PERM_INVENTORY_VIEW,
    },
}

# =====================================================================
# 3. HELPER FUNCTIONS
# =====================================================================

def normalize_role(role: Optional[str]) -> str:
    """Normalize role string handling variations."""
    if not role:
        return ROLE_OPERATOR
    r = role.lower().strip()
    if r in (ROLE_WAREHOUSE_OPERATOR, "operator"):
        return ROLE_OPERATOR
    if r in (ROLE_DISTRIBUTOR_FIELD_OPERATOR, "distributor"):
        return ROLE_DISTRIBUTOR
    return r

def get_user_effective_permissions(user: Dict[str, Any]) -> Set[str]:
    """Calculate the full effective permissions for a user record."""
    role = normalize_role(user.get("role"))
    defaults = ROLE_DEFAULT_PERMISSIONS.get(role, set())
    custom = set(user.get("permissions") or [])
    return defaults | custom

def user_has_permission(user: Dict[str, Any], permission: str) -> bool:
    """Check if the user has an explicit permission."""
    role = normalize_role(user.get("role"))
    # Super Admin has platform-level permissions, but operational mutations still check rules
    effective = get_user_effective_permissions(user)
    return permission in effective

def get_authorized_warehouses(user: Dict[str, Any]) -> Optional[List[str]]:
    """
    Returns list of authorized warehouse IDs for this user.
    Returns None if the user has network-wide access (Super Admin, Org Admin, Supply Chain Manager).
    """
    role = normalize_role(user.get("role"))
    if role in (ROLE_SUPER_ADMIN, ROLE_ORG_ADMIN, ROLE_SUPPLY_CHAIN_MANAGER):
        return None  # Unrestricted across org

    authorized = []
    if user.get("warehouse_id"):
        authorized.append(user["warehouse_id"])
    if user.get("warehouse_ids"):
        for wid in user["warehouse_ids"]:
            if wid not in authorized:
                authorized.append(wid)

    # Fallback to Chicago default warehouse if none specified for local worker
    if not authorized:
        authorized = ["wh_chicago_01"]

    return authorized

def validate_warehouse_access(user: Dict[str, Any], target_warehouse_id: Optional[str]) -> None:
    """
    Enforces location scoping: checks if the target warehouse is within the user's scope.
    Raises HTTP 403 if unauthorized.
    """
    if not target_warehouse_id or target_warehouse_id == "all":
        # Check if user is allowed network-wide view
        role = normalize_role(user.get("role"))
        if role in (ROLE_SUPER_ADMIN, ROLE_ORG_ADMIN, ROLE_SUPPLY_CHAIN_MANAGER):
            return
        authorized = get_authorized_warehouses(user)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Location access denied. Role '{role}' requires specific warehouse scope. Authorized: {authorized}"
        )

    allowed = get_authorized_warehouses(user)
    if allowed is not None and target_warehouse_id not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Location access denied. You are not authorized for warehouse '{target_warehouse_id}'. Authorized: {allowed}"
        )
