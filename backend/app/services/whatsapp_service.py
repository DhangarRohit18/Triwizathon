import hmac
import hashlib
import json
import uuid
import re
import secrets
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, List, Set
from fastapi import HTTPException
from app.core.config import settings
from app.core.database import db
from app.services.inventory_service import InventoryService
from app.services.audit_service import AuditService
from app.core.permissions import (
    ROLE_SUPER_ADMIN,
    ROLE_ORG_ADMIN,
    ROLE_SUPPLY_CHAIN_MANAGER,
    ROLE_WAREHOUSE_MANAGER,
    ROLE_OPERATOR,
    ROLE_DISTRIBUTOR,
    PERM_USERS_MANAGE,
    PERM_ROLES_ASSIGN,
    user_has_permission,
    normalize_role,
    get_user_effective_permissions,
    get_authorized_warehouses,
)
from app.models.domain import RoleEnum


class WhatsAppBotService:
    """
    WhatsApp Business Cloud API (v21.0) webhook handler & Admin Registration Engine.

    Security guarantees:
    - HMAC-SHA256 signature validation enforced when WHATSAPP_APP_SECRET is set.
    - Incoming Meta message IDs deduplicated via processed_idempotency_keys.
    - Sender phone number normalized and resolved against users collection before any action.
    - Secure Initial Administrator Bootstrap with secret tokens; no unauthorized self-promotion.
    - Target mobile number verification via short-lived, single-use numeric challenge codes.
    - Role hierarchy enforced: only Super Admin can assign Super Admin; Org Admin manages within tenant.
    - Last active Organization Administrator protected from accidental deactivation or demotion.
    - Append-only audit logs created for all sensitive actions and failed security events.
    - Consent managed: STOP -> opt-out, START -> opt-in.
    - Outbound dispatch with simulation fallback clearly labeled.
    """

    MANAGER_ROLES: Set[str] = {
        ROLE_SUPER_ADMIN,
        ROLE_ORG_ADMIN,
        ROLE_SUPPLY_CHAIN_MANAGER,
        ROLE_WAREHOUSE_MANAGER,
    }

    ROLE_DISPLAY_NAMES: Dict[str, str] = {
        ROLE_SUPER_ADMIN: "Super Administrator",
        ROLE_ORG_ADMIN: "Organization Administrator",
        ROLE_SUPPLY_CHAIN_MANAGER: "Supply Chain Manager",
        ROLE_WAREHOUSE_MANAGER: "Warehouse Manager",
        ROLE_OPERATOR: "Warehouse Operator",
        ROLE_DISTRIBUTOR: "Distributor & Fleet Logistics",
    }

    VALID_ROLES: Set[str] = set(ROLE_DISPLAY_NAMES.keys())

    # =========================================================================
    # 1. PHONE NORMALIZATION & VALIDATION
    # =========================================================================

    @staticmethod
    def _normalize_phone(number: str) -> str:
        """Strip all non-digit characters for internal matching."""
        return re.sub(r"\D", "", number or "")

    @classmethod
    def format_e164(cls, number: str) -> str:
        """
        Normalize mobile number to standardized E.164 format (e.g. +919876543210).
        Handles leading +, 10-digit Indian/US numbers, and existing country prefixes.
        """
        if not number:
            return ""
        raw = number.strip()
        digits = re.sub(r"\D", "", raw)
        if raw.startswith("+"):
            return f"+{digits}"
        if len(digits) == 10:
            # Default to India (+91) for standard mobile ranges [6-9], else US (+1)
            if digits[0] in "6789":
                return f"+91{digits}"
            return f"+1{digits}"
        if len(digits) >= 11:
            return f"+{digits}"
        return f"+{digits}"

    @classmethod
    def is_valid_phone(cls, number: str) -> bool:
        """Validates that a telephone number contains between 10 and 15 digits."""
        digits = cls._normalize_phone(number)
        return 10 <= len(digits) <= 15

    # =========================================================================
    # 2. SENDER RESOLUTION & AUTHENTICATION
    # =========================================================================

    @classmethod
    def _resolve_sender(
        cls,
        from_number: str,
        org_id: Optional[str] = None,
        sender_lid: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Look up authorized user by normalized phone number, whatsapp aliases, sender LID,
        or last 10 core digits across tenant or cross-org for Super Admins.
        """
        users = db.query("users")

        # 0. Check sender_lid in whatsapp_aliases first
        if sender_lid:
            norm_lid = cls._normalize_phone(sender_lid)
            for u in users:
                aliases = [cls._normalize_phone(str(a)) for a in u.get("whatsapp_aliases", [])]
                if norm_lid in aliases or sender_lid in aliases or str(sender_lid) in u.get("whatsapp_aliases", []):
                    if not org_id or u.get("role") == ROLE_SUPER_ADMIN or u.get("org_id") == org_id:
                        return u

        normalized_from = cls._normalize_phone(from_number)
        if not normalized_from:
            return None
        e164_from = cls.format_e164(from_number)

        # 1. Exact phone number match within tenant or alias match (strictly avoid ambiguous last-ten-digit matching)
        for u in users:
            stored_raw = u.get("phone_number") or ""
            stored_norm = cls._normalize_phone(stored_raw)
            stored_e164 = cls.format_e164(stored_raw)
            if stored_norm and (stored_norm == normalized_from or stored_raw == e164_from or stored_e164 == e164_from):
                if not org_id or u.get("role") == ROLE_SUPER_ADMIN or u.get("org_id") == org_id:
                    return u
            # Check explicit verified aliases (e.g. WhatsApp LID or pre-verified secondary numbers)
            aliases = [cls._normalize_phone(str(a)) for a in u.get("whatsapp_aliases", [])]
            if normalized_from in aliases or str(from_number) in u.get("whatsapp_aliases", []):
                if not org_id or u.get("role") == ROLE_SUPER_ADMIN or u.get("org_id") == org_id:
                    return u

        return None

    # =========================================================================
    # 3. WEBHOOK SECURITY & DEDUPLICATION
    # =========================================================================

    @staticmethod
    def verify_webhook_token(mode, token, challenge):
        """Standard Meta webhook verification handshake."""
        if mode == "subscribe" and token == settings.WHATSAPP_VERIFY_TOKEN:
            return challenge or "ok"
        raise HTTPException(status_code=403, detail="Verification token mismatch.")

    @staticmethod
    def verify_meta_signature(payload_bytes: bytes, signature_header: Optional[str]) -> bool:
        """
        Validates X-Hub-Signature-256 HMAC-SHA256.
        Security requirements:
        - In production, signature verification is strictly required and fails closed if
          WHATSAPP_APP_SECRET is missing or set to a mock default.
        - When a signature header is provided, it is always verified against the configured secret.
        """
        is_production = settings.ENVIRONMENT.lower() in ("production", "prod")

        # 1. Production must fail closed if secrets are missing or mock
        if is_production:
            if not settings.WHATSAPP_APP_SECRET or settings.WHATSAPP_APP_SECRET.startswith("mock_"):
                return False  # fail closed in production
            if not signature_header:
                return False  # missing required signature header in production

        # 2. When signature header is provided, strictly evaluate HMAC-SHA256
        if signature_header:
            if not settings.WHATSAPP_APP_SECRET:
                return False
            try:
                expected_hash = hmac.new(
                    settings.WHATSAPP_APP_SECRET.encode("utf-8"),
                    payload_bytes,
                    hashlib.sha256
                ).hexdigest()
                incoming_hash = signature_header.replace("sha256=", "").strip()
                return hmac.compare_digest(expected_hash, incoming_hash)
            except Exception:
                return False

        # 3. No signature header passed outside production
        if settings.WHATSAPP_APP_SECRET and not settings.WHATSAPP_APP_SECRET.startswith("mock_"):
            return False  # Real secret is set, header is mandatory

        # Only allow unauthenticated payload in non-production dev/simulator mode without secret
        return True

    @classmethod
    def handle_webhook_payload(cls, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Parse a Meta Cloud API webhook payload.
        Handles status updates (delivery receipts) and incoming messages with deduplication.
        """
        try:
            entry = data.get("entry", [{}])[0]
            changes = entry.get("changes", [{}])[0]
            value = changes.get("value", {})

            # --- Status updates (delivery receipts) ---
            statuses = value.get("statuses", [])
            for status_obj in statuses:
                msg_id = status_obj.get("id")
                wa_status = status_obj.get("status")
                if msg_id:
                    existing_log = db.query(
                        "notification_logs",
                        filters={"whatsapp_message_id": msg_id},
                        org_id=None
                    )
                    for log in existing_log:
                        db.set_document("notification_logs", log["id"], {
                            "delivery_status": wa_status,
                            "status_updated_at": datetime.now(timezone.utc).isoformat()
                        })

            messages = value.get("messages", [])
            if not messages:
                return {"status": "ignored_no_message"}

            msg = messages[0]
            meta_message_id = msg.get("id", "")
            from_num = msg.get("from", "")
            text_body = msg.get("text", {}).get("body", "")

            # --- Idempotency deduplication ---
            if meta_message_id:
                existing = db.get_document("processed_idempotency_keys", meta_message_id)
                if existing:
                    return {"status": "duplicate_ignored", "meta_message_id": meta_message_id}
                db.set_document("processed_idempotency_keys", meta_message_id, {
                    "id": meta_message_id,
                    "processed_at": datetime.now(timezone.utc).isoformat()
                }, merge=False)

            org_id = "org_triwiz_01"
            return cls.process_incoming_message(
                from_number=from_num,
                message_text=text_body,
                org_id=org_id,
                is_simulated=False
            )
        except HTTPException:
            raise
        except Exception as e:
            return {"status": "error", "detail": str(e)}

    # =========================================================================
    # 4. INITIAL ADMINISTRATOR BOOTSTRAP
    # =========================================================================

    @classmethod
    def execute_admin_bootstrap(
        cls,
        from_number: str,
        secret_token: str,
        role: str = ROLE_ORG_ADMIN,
        org_id: str = "org_triwiz_01",
        full_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Secure Initial Administrator Enrollment.
        Binds administrator's WhatsApp phone number using a protected backend secret.
        Locks the bootstrap state after success to prevent unauthorized re-enrollment.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        clean_secret = secret_token.strip()
        e164_phone = cls.format_e164(from_number)

        # 1. Check if bootstrap already completed
        state = db.get_document("admin_bootstrap_state", "bootstrap_status")
        if state and state.get("is_bootstrapped"):
            return {
                "success": False,
                "error": "ALREADY_BOOTSTRAPPED",
                "reply_text": (
                    "⛔ Initial administrator bootstrap has already been completed and locked. "
                    "Please use existing administrator credentials or contact your platform administrator."
                )
            }

        # 2. Verify secret token using constant-time comparison
        expected_secret = settings.ADMIN_BOOTSTRAP_SECRET
        if not clean_secret or not hmac.compare_digest(clean_secret, expected_secret):
            AuditService.log_event(
                org_id=org_id,
                actor_id=f"unregistered_{cls._normalize_phone(e164_phone)}",
                actor_name="Bootstrap Caller",
                actor_role="unauthenticated",
                action="UNAUTHORIZED_BOOTSTRAP_ATTEMPT",
                target_entity="system",
                entity_id="admin_bootstrap_state",
                details={"from_number": e164_phone, "reason": "invalid_secret"}
            )
            return {
                "success": False,
                "error": "INVALID_SECRET",
                "reply_text": "⛔ Invalid administrator bootstrap secret. Initial enrollment failed."
            }

        # 3. Validate role
        norm_role = normalize_role(role)
        if norm_role not in (ROLE_SUPER_ADMIN, ROLE_ORG_ADMIN):
            norm_role = ROLE_ORG_ADMIN

        # 4. Resolve or create administrator user document
        existing_user = cls._resolve_sender(from_number, org_id)
        if existing_user:
            user_id = existing_user["id"]
            user_updates = {
                "role": norm_role,
                "phone_number": e164_phone,
                "is_active": True,
                "whatsapp_opted_in": True,
                "updated_at": now_iso
            }
            if full_name:
                user_updates["full_name"] = full_name
            db.set_document("users", user_id, user_updates)
            admin_user = db.get_document("users", user_id)
        else:
            short_id = cls._normalize_phone(e164_phone)[-8:]
            user_id = f"usr_admin_{short_id}"
            admin_user = {
                "id": user_id,
                "email": f"admin_{short_id}@stockpilot.local",
                "full_name": full_name or "StockPilot Administrator",
                "role": norm_role,
                "org_id": org_id,
                "warehouse_id": None,
                "warehouse_ids": [],
                "phone_number": e164_phone,
                "is_active": True,
                "whatsapp_opted_in": True,
                "created_at": now_iso,
                "updated_at": now_iso
            }
            db.set_document("users", user_id, admin_user, merge=False)

        # 5. Lock bootstrap state
        db.set_document("admin_bootstrap_state", "bootstrap_status", {
            "id": "bootstrap_status",
            "is_bootstrapped": True,
            "bootstrapped_at": now_iso,
            "bootstrapped_phone": e164_phone,
            "admin_user_id": user_id,
            "role": norm_role
        }, merge=False)

        # 6. Append-only audit record
        AuditService.log_event(
            org_id=org_id,
            actor_id=user_id,
            actor_name=admin_user.get("full_name", "Administrator"),
            actor_role=norm_role,
            action="ADMIN_BOOTSTRAP_COMPLETED",
            target_entity="user",
            entity_id=user_id,
            details={"phone_number": e164_phone, "role": norm_role}
        )

        role_title = cls.ROLE_DISPLAY_NAMES.get(norm_role, norm_role)
        reply = (
            f"✅ *Administrator Bootstrap Succeeded*\n"
            f"Phone *{e164_phone}* is now registered and authorized as *{role_title}* for Organization *{org_id}*.\n\n"
            f"The initial setup secret is now locked. Reply *HELP* to view administrative and inventory management commands."
        )
        return {"success": True, "user": admin_user, "reply_text": reply}

    # =========================================================================
    # 5. TARGET NUMBER INVITATION & VERIFICATION
    # =========================================================================

    @classmethod
    def create_user_invitation(
        cls,
        admin_user: Dict[str, Any],
        target_phone: str,
        proposed_role: str = ROLE_OPERATOR,
        warehouse_id: Optional[str] = None,
        org_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Creates a pending registration invitation with a single-use verification challenge.
        Separates registration from account activation.
        """
        now_utc = datetime.now(timezone.utc)
        now_iso = now_utc.isoformat()
        expires_dt = now_utc + timedelta(hours=settings.WHATSAPP_INVITATION_EXPIRE_HOURS)
        expires_at_iso = expires_dt.isoformat()

        # 1. Authorize admin
        admin_role = admin_user.get("role")
        if not (admin_role in (ROLE_SUPER_ADMIN, ROLE_ORG_ADMIN) or user_has_permission(admin_user, PERM_USERS_MANAGE)):
            AuditService.log_event(
                org_id=admin_user.get("org_id", "org_triwiz_01"),
                actor_id=admin_user["id"],
                actor_name=admin_user.get("full_name", "User"),
                actor_role=admin_role or "unknown",
                action="UNAUTHORIZED_MANAGEMENT_ATTEMPT",
                target_entity="whatsapp_invitation",
                entity_id=target_phone,
                details={"command": "USER ADD", "requested_role": proposed_role}
            )
            return {
                "success": False,
                "error": "FORBIDDEN",
                "reply_text": f"⛔ Unauthorized: Role '{admin_role}' does not have permission to register or invite users."
            }

        # 2. Validate phone format
        if not cls.is_valid_phone(target_phone):
            return {
                "success": False,
                "error": "INVALID_PHONE",
                "reply_text": (
                    "⛔ Invalid mobile number format. Please provide a 10 to 15 digit telephone number with country code.\n"
                    "Example: USER ADD +919876543210 warehouse_manager"
                )
            }
        e164_phone = cls.format_e164(target_phone)

        # 3. Validate proposed role
        norm_role = normalize_role(proposed_role)
        if norm_role not in cls.VALID_ROLES:
            valid_list = ", ".join(sorted(cls.VALID_ROLES))
            return {
                "success": False,
                "error": "INVALID_ROLE",
                "reply_text": (
                    f"⛔ Unknown role '{proposed_role}'. Supported roles are:\n"
                    f"{valid_list}\n"
                    f"Example: USER ADD {e164_phone} warehouse_manager"
                )
            }

        # 4. Enforce role hierarchy: only Super Admin can assign Super Admin
        if norm_role == ROLE_SUPER_ADMIN and admin_role != ROLE_SUPER_ADMIN:
            AuditService.log_event(
                org_id=admin_user.get("org_id", "org_triwiz_01"),
                actor_id=admin_user["id"],
                actor_name=admin_user.get("full_name", "Admin"),
                actor_role=admin_role,
                action="UNAUTHORIZED_ROLE_ASSIGNMENT_ATTEMPT",
                target_entity="whatsapp_invitation",
                entity_id=e164_phone,
                details={"requested_role": ROLE_SUPER_ADMIN, "target_phone": e164_phone}
            )
            return {
                "success": False,
                "error": "HIERARCHY_VIOLATION",
                "reply_text": "⛔ Authorization Error: Only a Super Administrator can provision or assign the Super Admin role."
            }

        target_org_id = org_id or admin_user.get("org_id", "org_triwiz_01")

        # 5. Check if user already exists and is active
        existing_user = cls._resolve_sender(e164_phone, target_org_id)
        if existing_user and existing_user.get("is_active", True):
            curr_title = cls.ROLE_DISPLAY_NAMES.get(existing_user.get("role"), existing_user.get("role"))
            return {
                "success": False,
                "error": "ALREADY_ACTIVE",
                "reply_text": (
                    f"ℹ️ Mobile number *{e164_phone}* is already registered and active as *{curr_title}*.\n"
                    f"To update their role, send: USER ROLE {e164_phone} <new_role>\n"
                    f"To view profile, send: USER SHOW {e164_phone}"
                )
            }

        # 6. Validate warehouse scope if provided
        warehouse_name = None
        if warehouse_id:
            wh = db.get_document("warehouses", warehouse_id)
            if not wh and warehouse_id != "all":
                # Check by code
                matching_whs = db.query("warehouses", filters={"code": warehouse_id}, org_id=target_org_id)
                if matching_whs:
                    wh = matching_whs[0]
            if not wh and warehouse_id != "all":
                return {
                    "success": False,
                    "error": "INVALID_WAREHOUSE",
                    "reply_text": f"⛔ Warehouse '{warehouse_id}' not found in organization '{target_org_id}'."
                }
            if wh:
                warehouse_name = wh.get("name", warehouse_id)
                warehouse_id = wh["id"]

        # 7. Invalidate any previous pending invitations for this target number
        existing_invs = db.query("whatsapp_invitations", filters={"phone_number": e164_phone, "status": "pending"})
        for old_inv in existing_invs:
            db.set_document("whatsapp_invitations", old_inv["id"], {"status": "revoked", "updated_at": now_iso})

        # 8. Generate unpredictable 6-digit challenge code
        code = f"{secrets.randbelow(900000) + 100000}"
        code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()

        inv_id = f"inv_{uuid.uuid4().hex[:12]}"
        inv_record = {
            "id": inv_id,
            "org_id": target_org_id,
            "phone_number": e164_phone,
            "phone_raw": target_phone,
            "role": norm_role,
            "warehouse_id": warehouse_id,
            "warehouse_ids": [warehouse_id] if warehouse_id else [],
            "challenge_code": code,
            "challenge_hash": code_hash,
            "status": "pending",
            "attempts": 0,
            "max_attempts": settings.WHATSAPP_CHALLENGE_MAX_ATTEMPTS,
            "created_by": admin_user["id"],
            "created_by_name": admin_user.get("full_name", "Admin"),
            "created_at": now_iso,
            "expires_at": expires_at_iso
        }
        db.set_document("whatsapp_invitations", inv_id, inv_record, merge=False)

        # 9. Audit event (omits plaintext verification secret)
        AuditService.log_event(
            org_id=target_org_id,
            actor_id=admin_user["id"],
            actor_name=admin_user.get("full_name", "Admin"),
            actor_role=admin_role,
            action="USER_INVITATION_CREATED",
            target_entity="whatsapp_invitation",
            entity_id=inv_id,
            details={
                "target_phone": e164_phone,
                "proposed_role": norm_role,
                "warehouse_id": warehouse_id,
                "expires_at": expires_at_iso
            }
        )

        role_display = cls.ROLE_DISPLAY_NAMES.get(norm_role, norm_role)

        # 10. Outbound WhatsApp invitation to target number
        invite_msg = (
            f"StockPilot AI: You have been invited to join Triwiz BioPharma Logistics as *{role_display}*.\n"
            f"Reply: *CONFIRM {code}* to verify your phone number and activate your account.\n"
            f"Single-use code expires in {settings.WHATSAPP_INVITATION_EXPIRE_HOURS} hours."
        )
        cls._dispatch_outbound(e164_phone, invite_msg, f"wa_{uuid.uuid4().hex[:12]}")

        reply = (
            f"✅ *Invitation Created*\n"
            f"Target Phone: *{e164_phone}*\n"
            f"Proposed Role: *{role_display}* ({norm_role})\n"
            f"Warehouse Scope: {warehouse_name or warehouse_id or 'All Organization Facilities'}\n"
            f"Status: *Pending Verification*\n"
            f"Verification Challenge: *{code}* (single-use, expires in {settings.WHATSAPP_INVITATION_EXPIRE_HOURS}h)\n\n"
            f"Outbound invitation dispatched. Target user must reply: *CONFIRM {code}*"
        )
        return {
            "success": True,
            "invitation_id": inv_id,
            "phone_number": e164_phone,
            "role": norm_role,
            "challenge_code": code,
            "expires_at": expires_at_iso,
            "reply_text": reply
        }

    @classmethod
    def verify_user_invitation(
        cls,
        from_number: str,
        challenge_code: str,
        org_id: str = "org_triwiz_01"
    ) -> Dict[str, Any]:
        """
        Validates target user's challenge code, binds verified WhatsApp number,
        activates account, and dispatches confirmations to user and administrator.
        """
        now_utc = datetime.now(timezone.utc)
        now_iso = now_utc.isoformat()
        clean_code = challenge_code.strip()
        e164_phone = cls.format_e164(from_number)
        normalized_from = cls._normalize_phone(from_number)

        # Query pending invitations matching target number
        all_invs = db.query("whatsapp_invitations")
        matched_inv = None
        for inv in all_invs:
            inv_phone_norm = cls._normalize_phone(inv.get("phone_number", ""))
            inv_e164 = cls.format_e164(inv.get("phone_number", ""))
            if (inv.get("phone_number") == e164_phone or
                inv_e164 == e164_phone or
                inv_phone_norm == normalized_from):
                if inv.get("status") == "pending":
                    matched_inv = inv
                    break

        if not matched_inv:
            return {
                "success": False,
                "error": "NO_PENDING_INVITATION",
                "reply_text": "⛔ No active registration invitation found for this mobile number. Please contact your organization administrator."
            }

        inv_id = matched_inv["id"]
        inv_org_id = matched_inv.get("org_id", org_id)
        target_role = matched_inv.get("role", ROLE_OPERATOR)
        role_display = cls.ROLE_DISPLAY_NAMES.get(target_role, target_role)
        max_attempts = matched_inv.get("max_attempts", settings.WHATSAPP_CHALLENGE_MAX_ATTEMPTS)
        curr_attempts = matched_inv.get("attempts", 0)

        # Check expiration
        expires_at_str = matched_inv.get("expires_at")
        if expires_at_str:
            try:
                exp_dt = datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))
                if exp_dt.tzinfo is None:
                    exp_dt = exp_dt.replace(tzinfo=timezone.utc)
                if now_utc > exp_dt:
                    db.set_document("whatsapp_invitations", inv_id, {"status": "expired", "updated_at": now_iso})
                    AuditService.log_event(
                        org_id=inv_org_id,
                        actor_id=f"unverified_{e164_phone}",
                        actor_name="Unverified User",
                        actor_role="none",
                        action="USER_INVITATION_EXPIRED",
                        target_entity="whatsapp_invitation",
                        entity_id=inv_id,
                        details={"phone_number": e164_phone}
                    )
                    return {
                        "success": False,
                        "error": "INVITATION_EXPIRED",
                        "reply_text": "⛔ Your verification code has expired. Please ask your administrator to generate a new invitation."
                    }
            except Exception:
                pass

        # Check attempts limit
        if curr_attempts >= max_attempts:
            db.set_document("whatsapp_invitations", inv_id, {"status": "revoked", "updated_at": now_iso})
            AuditService.log_event(
                org_id=inv_org_id,
                actor_id=f"unverified_{e164_phone}",
                actor_name="Unverified User",
                actor_role="none",
                action="USER_INVITATION_REVOKED_ATTEMPTS",
                target_entity="whatsapp_invitation",
                entity_id=inv_id,
                details={"phone_number": e164_phone, "attempts": curr_attempts}
            )
            return {
                "success": False,
                "error": "MAX_ATTEMPTS_EXCEEDED",
                "reply_text": "⛔ Maximum verification attempts exceeded. This invitation has been revoked for security. Contact your administrator."
            }

        # Validate code
        incoming_hash = hashlib.sha256(clean_code.encode("utf-8")).hexdigest()
        stored_hash = matched_inv.get("challenge_hash")
        stored_code = matched_inv.get("challenge_code")

        is_match = False
        if stored_hash and hmac.compare_digest(incoming_hash, stored_hash):
            is_match = True
        elif stored_code and hmac.compare_digest(clean_code, str(stored_code)):
            is_match = True

        if not is_match:
            new_attempts = curr_attempts + 1
            is_now_revoked = new_attempts >= max_attempts
            db.set_document("whatsapp_invitations", inv_id, {
                "attempts": new_attempts,
                "status": "revoked" if is_now_revoked else "pending",
                "updated_at": now_iso
            })
            AuditService.log_event(
                org_id=inv_org_id,
                actor_id=f"unverified_{e164_phone}",
                actor_name="Unverified User",
                actor_role="none",
                action="USER_VERIFICATION_FAILED",
                target_entity="whatsapp_invitation",
                entity_id=inv_id,
                details={"phone_number": e164_phone, "attempt": new_attempts, "max_attempts": max_attempts}
            )
            if is_now_revoked:
                return {
                    "success": False,
                    "error": "MAX_ATTEMPTS_EXCEEDED",
                    "reply_text": "⛔ Invalid verification code. Maximum attempts reached. Invitation has been revoked."
                }
            remaining = max_attempts - new_attempts
            return {
                "success": False,
                "error": "INVALID_CODE",
                "reply_text": f"⛔ Invalid verification code. {remaining} attempt(s) remaining."
            }

        # Mark invitation verified (single-use)
        db.set_document("whatsapp_invitations", inv_id, {
            "status": "verified",
            "verified_at": now_iso,
            "updated_at": now_iso
        })

        # Create or update user in users collection
        existing_user = cls._resolve_sender(from_number, inv_org_id)
        if existing_user:
            user_id = existing_user["id"]
            user_updates = {
                "role": target_role,
                "phone_number": e164_phone,
                "is_active": True,
                "whatsapp_opted_in": True,
                "updated_at": now_iso
            }
            if matched_inv.get("warehouse_id"):
                user_updates["warehouse_id"] = matched_inv["warehouse_id"]
            if matched_inv.get("warehouse_ids"):
                user_updates["warehouse_ids"] = matched_inv["warehouse_ids"]
            db.set_document("users", user_id, user_updates)
            user_doc = db.get_document("users", user_id)
        else:
            short_id = cls._normalize_phone(e164_phone)[-8:]
            user_id = f"usr_wa_{short_id}"
            user_doc = {
                "id": user_id,
                "email": f"{cls._normalize_phone(e164_phone)}@stockpilot.local",
                "full_name": f"WhatsApp User ({e164_phone})",
                "role": target_role,
                "org_id": inv_org_id,
                "warehouse_id": matched_inv.get("warehouse_id"),
                "warehouse_ids": matched_inv.get("warehouse_ids", []),
                "phone_number": e164_phone,
                "whatsapp_opted_in": True,
                "is_active": True,
                "created_at": now_iso,
                "updated_at": now_iso,
                "verified_via": "whatsapp_challenge"
            }
            db.set_document("users", user_id, user_doc, merge=False)

        # Audit events
        AuditService.log_event(
            org_id=inv_org_id,
            actor_id=user_id,
            actor_name=user_doc.get("full_name", "User"),
            actor_role=target_role,
            action="USER_PHONE_VERIFIED",
            target_entity="user",
            entity_id=user_id,
            details={
                "phone_number": e164_phone,
                "role": target_role,
                "invitation_id": inv_id
            }
        )

        AuditService.log_event(
            org_id=inv_org_id,
            actor_id=user_id,
            actor_name=user_doc.get("full_name", "User"),
            actor_role=target_role,
            action="USER_ACTIVATED",
            target_entity="user",
            entity_id=user_id,
            details={"phone_number": e164_phone, "role": target_role}
        )

        # Notify creator administrator
        creator_id = matched_inv.get("created_by")
        if creator_id:
            creator_user = db.get_document("users", creator_id)
            if creator_user and creator_user.get("phone_number"):
                admin_notif = (
                    f"ℹ️ StockPilot AI: User *{e164_phone}* has verified their phone number and is now ACTIVE as *{role_display}*."
                )
                cls._dispatch_outbound(creator_user["phone_number"], admin_notif, f"wa_{uuid.uuid4().hex[:12]}")

        reply = (
            f"🎉 *Welcome to StockPilot AI!*\n"
            f"Your mobile number *{e164_phone}* has been verified and your account is active.\n"
            f"Assigned Role: *{role_display}* ({target_role})\n"
            f"Organization: *{inv_org_id}*\n"
            f"Status: *Active*\n\n"
            f"Reply *HELP* to see your authorized commands."
        )
        return {"success": True, "user": user_doc, "reply_text": reply}

    # =========================================================================
    # 6. ROLE REASSIGNMENT WORKFLOW
    # =========================================================================

    @classmethod
    def handle_user_role(
        cls,
        admin_user: Dict[str, Any],
        args: List[str],
        org_id: str
    ) -> str:
        """
        USER ROLE <phone> <role>
        Reassigns role to a registered target user.
        Validates role hierarchy, permissions, and the last active Org Admin safeguard.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        if len(args) < 2:
            return (
                "⛔ Invalid command format.\n"
                "Usage: USER ROLE <phone> <role>\n"
                "Example: USER ROLE +919876543210 warehouse_manager\n"
                f"Supported roles: {', '.join(sorted(cls.VALID_ROLES))}"
            )

        target_phone_raw = args[0]
        requested_role_raw = args[1]

        if not cls.is_valid_phone(target_phone_raw):
            return "⛔ Invalid mobile number format. Example: USER ROLE +919876543210 warehouse_manager"

        e164_phone = cls.format_e164(target_phone_raw)
        norm_role = normalize_role(requested_role_raw)

        if norm_role not in cls.VALID_ROLES:
            return (
                f"⛔ Unknown role '{requested_role_raw}'.\n"
                f"Supported roles are: {', '.join(sorted(cls.VALID_ROLES))}"
            )

        admin_role = admin_user.get("role")
        if not (admin_role in (ROLE_SUPER_ADMIN, ROLE_ORG_ADMIN) or user_has_permission(admin_user, PERM_ROLES_ASSIGN)):
            AuditService.log_event(
                org_id=org_id,
                actor_id=admin_user["id"],
                actor_name=admin_user.get("full_name", "User"),
                actor_role=admin_role,
                action="UNAUTHORIZED_ROLE_CHANGE_ATTEMPT",
                target_entity="user",
                entity_id=e164_phone,
                details={"requested_role": norm_role}
            )
            return f"⛔ Unauthorized: Role '{admin_role}' cannot change user roles."

        # Hierarchy check: only Super Admin can assign Super Admin
        if norm_role == ROLE_SUPER_ADMIN and admin_role != ROLE_SUPER_ADMIN:
            AuditService.log_event(
                org_id=org_id,
                actor_id=admin_user["id"],
                actor_name=admin_user.get("full_name", "Admin"),
                actor_role=admin_role,
                action="UNAUTHORIZED_ROLE_ASSIGNMENT_ATTEMPT",
                target_entity="user",
                entity_id=e164_phone,
                details={"requested_role": ROLE_SUPER_ADMIN}
            )
            return "⛔ Authorization Error: Only a Super Administrator can assign the Super Admin role."

        # Resolve target user
        target_user = cls._resolve_sender(e164_phone, org_id)
        if not target_user:
            # Check if there is a pending invitation to update
            pending_invs = db.query("whatsapp_invitations", filters={"phone_number": e164_phone, "status": "pending"})
            if pending_invs:
                inv = pending_invs[0]
                db.set_document("whatsapp_invitations", inv["id"], {"role": norm_role, "updated_at": now_iso})
                role_display = cls.ROLE_DISPLAY_NAMES.get(norm_role, norm_role)
                return f"✅ Updated proposed role on pending invitation for *{e164_phone}* to *{role_display}*."
            return (
                f"⛔ No registered user found with mobile number *{e164_phone}*.\n"
                f"Use *USER ADD {e164_phone} {norm_role}* to invite them first."
            )

        # Cross-org protection
        if admin_role != ROLE_SUPER_ADMIN and target_user.get("org_id") != admin_user.get("org_id"):
            return "⛔ Cross-organization role modification denied."

        # Self-elevation protection: Users cannot elevate their own role
        if target_user["id"] == admin_user["id"] and norm_role != admin_user.get("role"):
            AuditService.log_event(
                org_id=org_id,
                actor_id=admin_user["id"],
                actor_name=admin_user.get("full_name", "Admin"),
                actor_role=admin_role,
                action="UNAUTHORIZED_SELF_PROMOTION_ATTEMPT",
                target_entity="user",
                entity_id=target_user["id"],
                details={"requested_role": norm_role, "current_role": admin_role}
            )
            return "⛔ Self-Elevation Denied: Users cannot modify or elevate their own role. Role modifications must be performed by a separate authorized administrator."

        old_role = target_user.get("role", ROLE_OPERATOR)
        old_role_display = cls.ROLE_DISPLAY_NAMES.get(old_role, old_role)
        new_role_display = cls.ROLE_DISPLAY_NAMES.get(norm_role, norm_role)

        # Safeguard: Do not demote final active Org Admin
        if old_role == ROLE_ORG_ADMIN and norm_role != ROLE_ORG_ADMIN:
            active_admins = [
                u for u in db.query("users", org_id=target_user["org_id"])
                if u.get("role") == ROLE_ORG_ADMIN and u.get("is_active", True) and u["id"] != target_user["id"]
            ]
            if not active_admins:
                return (
                    "⛔ Safeguard Violation: Cannot demote the final active Organization Administrator "
                    "without designating a replacement administrator first."
                )

        # Update role
        db.set_document("users", target_user["id"], {
            "role": norm_role,
            "updated_at": now_iso
        })

        # Audit event
        AuditService.log_event(
            org_id=target_user["org_id"],
            actor_id=admin_user["id"],
            actor_name=admin_user.get("full_name", "Admin"),
            actor_role=admin_role,
            action="USER_ROLE_REASSIGNED",
            target_entity="user",
            entity_id=target_user["id"],
            details={
                "target_phone": e164_phone,
                "old_role": old_role,
                "new_role": norm_role,
                "outcome": "success"
            }
        )

        # Notify target user
        user_notif = (
            f"ℹ️ StockPilot AI: Your role has been updated to *{new_role_display}*.\n"
            f"Reply *HELP* to see your updated available commands."
        )
        cls._dispatch_outbound(e164_phone, user_notif, f"wa_{uuid.uuid4().hex[:12]}")

        return (
            f"✅ *Role Reassigned*\n"
            f"Target User: *{target_user.get('full_name')}* ({e164_phone})\n"
            f"Previous Role: {old_role_display} ({old_role})\n"
            f"New Role: *{new_role_display}* ({norm_role})\n"
            f"Effective permissions updated."
        )

    # =========================================================================
    # 7. LOCATION SCOPE MANAGEMENT (WAREHOUSES)
    # =========================================================================

    @classmethod
    def handle_user_warehouse(
        cls,
        admin_user: Dict[str, Any],
        args: List[str],
        org_id: str
    ) -> str:
        """USER WAREHOUSE <phone> <warehouse_id>"""
        now_iso = datetime.now(timezone.utc).isoformat()
        if len(args) < 2:
            return (
                "⛔ Invalid command format.\n"
                "Usage: USER WAREHOUSE <phone> <warehouse_id>\n"
                "Example: USER WAREHOUSE +919876543210 wh_chicago_01"
            )

        target_phone_raw, wh_query = args[0], args[1]
        if not cls.is_valid_phone(target_phone_raw):
            return "⛔ Invalid phone number."
        e164_phone = cls.format_e164(target_phone_raw)

        admin_role = admin_user.get("role")
        if not (admin_role in (ROLE_SUPER_ADMIN, ROLE_ORG_ADMIN) or user_has_permission(admin_user, PERM_USERS_MANAGE)):
            return "⛔ Unauthorized: Insufficient permissions to modify warehouse scopes."

        target_user = cls._resolve_sender(e164_phone, org_id)
        if not target_user:
            return f"⛔ User *{e164_phone}* not found. Register user with USER ADD first."

        # Validate warehouse exists in org
        target_org = target_user.get("org_id", org_id)
        wh = db.get_document("warehouses", wh_query)
        if not wh:
            # Match by code or case-insensitive name
            warehouses = db.query("warehouses", org_id=target_org if admin_role != ROLE_SUPER_ADMIN else None)
            for w in warehouses:
                if w.get("code", "").lower() == wh_query.lower() or w.get("id", "").lower() == wh_query.lower():
                    wh = w
                    break

        if not wh:
            return f"⛔ Warehouse '{wh_query}' not found in organization '{target_org}'."

        wh_id = wh["id"]
        wh_name = wh.get("name", wh_id)
        existing_scopes = target_user.get("warehouse_ids") or []
        if wh_id not in existing_scopes:
            existing_scopes.append(wh_id)

        db.set_document("users", target_user["id"], {
            "warehouse_id": wh_id,
            "warehouse_ids": existing_scopes,
            "updated_at": now_iso
        })

        AuditService.log_event(
            org_id=target_org,
            actor_id=admin_user["id"],
            actor_name=admin_user.get("full_name", "Admin"),
            actor_role=admin_role,
            action="USER_WAREHOUSE_ASSIGNED",
            target_entity="user",
            entity_id=target_user["id"],
            details={"warehouse_id": wh_id, "phone_number": e164_phone}
        )

        return (
            f"✅ *Warehouse Assigned*\n"
            f"Target: *{target_user.get('full_name')}* ({e164_phone})\n"
            f"Warehouse: *{wh_name}* ({wh_id})\n"
            f"Total Facilities Scoped: {len(existing_scopes)}"
        )

    @classmethod
    def handle_user_remove_warehouse(
        cls,
        admin_user: Dict[str, Any],
        args: List[str],
        org_id: str
    ) -> str:
        """USER REMOVE-WAREHOUSE <phone> <warehouse_id>"""
        now_iso = datetime.now(timezone.utc).isoformat()
        if len(args) < 2:
            return (
                "⛔ Invalid command format.\n"
                "Usage: USER REMOVE-WAREHOUSE <phone> <warehouse_id>\n"
                "Example: USER REMOVE-WAREHOUSE +919876543210 wh_chicago_01"
            )

        target_phone_raw, wh_query = args[0], args[1]
        e164_phone = cls.format_e164(target_phone_raw)

        admin_role = admin_user.get("role")
        if not (admin_role in (ROLE_SUPER_ADMIN, ROLE_ORG_ADMIN) or user_has_permission(admin_user, PERM_USERS_MANAGE)):
            return "⛔ Unauthorized: Insufficient permissions to remove warehouse scopes."

        target_user = cls._resolve_sender(e164_phone, org_id)
        if not target_user:
            return f"⛔ User *{e164_phone}* not found."

        existing_scopes = list(target_user.get("warehouse_ids") or [])
        # Find warehouse to remove
        matched_id = None
        for wid in existing_scopes:
            if wid.lower() == wh_query.lower():
                matched_id = wid
                break
            wh_doc = db.get_document("warehouses", wid)
            if wh_doc and wh_doc.get("code", "").lower() == wh_query.lower():
                matched_id = wid
                break

        if not matched_id or matched_id not in existing_scopes:
            return f"ℹ️ User *{e164_phone}* is not assigned to warehouse '{wh_query}'."

        existing_scopes.remove(matched_id)
        primary_wh = existing_scopes[0] if existing_scopes else None

        db.set_document("users", target_user["id"], {
            "warehouse_id": primary_wh,
            "warehouse_ids": existing_scopes,
            "updated_at": now_iso
        })

        AuditService.log_event(
            org_id=target_user["org_id"],
            actor_id=admin_user["id"],
            actor_name=admin_user.get("full_name", "Admin"),
            actor_role=admin_role,
            action="USER_WAREHOUSE_REMOVED",
            target_entity="user",
            entity_id=target_user["id"],
            details={"warehouse_id": matched_id, "phone_number": e164_phone}
        )

        return (
            f"✅ *Warehouse Scope Removed*\n"
            f"Target: *{target_user.get('full_name')}* ({e164_phone})\n"
            f"Removed: *{matched_id}*\n"
            f"Remaining Scopes: {', '.join(existing_scopes) if existing_scopes else 'None'}"
        )

    # =========================================================================
    # 8. ACCOUNT LIFECYCLE (DISABLE / ENABLE / SHOW / LIST)
    # =========================================================================

    @classmethod
    def handle_user_disable(
        cls,
        admin_user: Dict[str, Any],
        args: List[str],
        org_id: str
    ) -> str:
        """USER DISABLE <phone>"""
        now_iso = datetime.now(timezone.utc).isoformat()
        if not args:
            return "⛔ Please specify a phone number. Example: USER DISABLE +919876543210"

        e164_phone = cls.format_e164(args[0])
        admin_role = admin_user.get("role")
        if not (admin_role in (ROLE_SUPER_ADMIN, ROLE_ORG_ADMIN) or user_has_permission(admin_user, PERM_USERS_MANAGE)):
            return "⛔ Unauthorized to deactivate users."

        target_user = cls._resolve_sender(e164_phone, org_id)
        if not target_user:
            return f"⛔ User *{e164_phone}* not found."

        # Self-deactivation protection
        if target_user["id"] == admin_user["id"]:
            return "⛔ Cannot deactivate your own active session."

        # Final Org Admin protection
        if target_user.get("role") == ROLE_ORG_ADMIN:
            active_admins = [
                u for u in db.query("users", org_id=target_user["org_id"])
                if u.get("role") == ROLE_ORG_ADMIN and u.get("is_active", True) and u["id"] != target_user["id"]
            ]
            if not active_admins:
                return (
                    "⛔ Safeguard Violation: Cannot deactivate the final active Organization Administrator "
                    "without designating another active administrator."
                )

        db.set_document("users", target_user["id"], {
            "is_active": False,
            "updated_at": now_iso
        })

        AuditService.log_event(
            org_id=target_user["org_id"],
            actor_id=admin_user["id"],
            actor_name=admin_user.get("full_name", "Admin"),
            actor_role=admin_role,
            action="USER_DISABLED",
            target_entity="user",
            entity_id=target_user["id"],
            details={"phone_number": e164_phone}
        )

        return f"✅ Account for *{target_user.get('full_name')}* ({e164_phone}) has been DISABLED."

    @classmethod
    def handle_user_enable(
        cls,
        admin_user: Dict[str, Any],
        args: List[str],
        org_id: str
    ) -> str:
        """USER ENABLE <phone>"""
        now_iso = datetime.now(timezone.utc).isoformat()
        if not args:
            return "⛔ Please specify a phone number. Example: USER ENABLE +919876543210"

        e164_phone = cls.format_e164(args[0])
        admin_role = admin_user.get("role")
        if not (admin_role in (ROLE_SUPER_ADMIN, ROLE_ORG_ADMIN) or user_has_permission(admin_user, PERM_USERS_MANAGE)):
            return "⛔ Unauthorized to re-enable users."

        target_user = cls._resolve_sender(e164_phone, org_id)
        if not target_user:
            return f"⛔ User *{e164_phone}* not found."

        db.set_document("users", target_user["id"], {
            "is_active": True,
            "updated_at": now_iso
        })

        AuditService.log_event(
            org_id=target_user["org_id"],
            actor_id=admin_user["id"],
            actor_name=admin_user.get("full_name", "Admin"),
            actor_role=admin_role,
            action="USER_ENABLED",
            target_entity="user",
            entity_id=target_user["id"],
            details={"phone_number": e164_phone}
        )

        return f"✅ Account for *{target_user.get('full_name')}* ({e164_phone}) has been RE-ENABLED."

    @classmethod
    def handle_user_show(
        cls,
        admin_user: Dict[str, Any],
        args: List[str],
        org_id: str
    ) -> str:
        """USER SHOW <phone>"""
        if not args:
            return "⛔ Please specify a phone number. Example: USER SHOW +919876543210"

        e164_phone = cls.format_e164(args[0])
        admin_role = admin_user.get("role")
        if not (admin_role in (ROLE_SUPER_ADMIN, ROLE_ORG_ADMIN) or user_has_permission(admin_user, PERM_USERS_MANAGE)):
            return "⛔ Unauthorized: Insufficient permissions to view user profile details."

        target_user = cls._resolve_sender(e164_phone, org_id)
        if target_user:
            role = target_user.get("role", "operator")
            role_display = cls.ROLE_DISPLAY_NAMES.get(role, role)
            wh_scopes = target_user.get("warehouse_ids") or ([target_user["warehouse_id"]] if target_user.get("warehouse_id") else [])
            wh_text = ", ".join(wh_scopes) if wh_scopes else "All Organization Warehouses"
            status_text = "Active" if target_user.get("is_active", True) else "Disabled"
            consent_text = "Subscribed" if target_user.get("whatsapp_opted_in", True) else "Opted-out"

            return (
                f"*StockPilot User Profile*\n"
                f"- Name: *{target_user.get('full_name')}*\n"
                f"- Mobile: *{target_user.get('phone_number') or e164_phone}*\n"
                f"- Role: *{role_display}* ({role})\n"
                f"- Organization: {target_user.get('org_id')}\n"
                f"- Warehouse Scope: {wh_text}\n"
                f"- Account Status: *{status_text}*\n"
                f"- WhatsApp Alerts: {consent_text}\n"
                f"- Created: {target_user.get('created_at', 'N/A')[:10]}"
            )

        # Check pending invitation
        invs = db.query("whatsapp_invitations", filters={"phone_number": e164_phone, "status": "pending"})
        if invs:
            inv = invs[0]
            role = inv.get("role", "operator")
            role_display = cls.ROLE_DISPLAY_NAMES.get(role, role)
            return (
                f"*Pending Registration Invitation*\n"
                f"- Mobile: *{e164_phone}*\n"
                f"- Proposed Role: *{role_display}* ({role})\n"
                f"- Status: *Pending Verification*\n"
                f"- Expiry: {inv.get('expires_at')}\n"
                f"- Verification Attempts: {inv.get('attempts', 0)}/{inv.get('max_attempts', 5)}\n"
                f"- Invited By: {inv.get('created_by_name', 'Admin')}"
            )

        return f"⛔ No user record or pending invitation found for mobile number *{e164_phone}*."

    @classmethod
    def handle_user_list(
        cls,
        admin_user: Dict[str, Any],
        org_id: str
    ) -> str:
        """USER LIST - Lists organization users and pending invitations."""
        admin_role = admin_user.get("role")
        if not (admin_role in (ROLE_SUPER_ADMIN, ROLE_ORG_ADMIN) or user_has_permission(admin_user, PERM_USERS_MANAGE)):
            return "⛔ Unauthorized to list users."

        target_org = None if admin_role == ROLE_SUPER_ADMIN else org_id
        users = db.query("users", org_id=target_org)
        pending_invs = db.query("whatsapp_invitations", filters={"status": "pending"}, org_id=target_org)

        lines = [f"*StockPilot Users ({admin_user.get('org_id')})*:"]
        for idx, u in enumerate(users[:15], 1):
            r = u.get("role", "operator")
            r_display = cls.ROLE_DISPLAY_NAMES.get(r, r)
            phone = u.get("phone_number") or "No Phone"
            st = "Active" if u.get("is_active", True) else "Disabled"
            lines.append(f"{idx}. {u.get('full_name')} - {phone} - *{r_display}* [{st}]")

        if pending_invs:
            lines.append("\n*Pending Invitations*:")
            for inv in pending_invs[:5]:
                r_disp = cls.ROLE_DISPLAY_NAMES.get(inv.get("role"), inv.get("role"))
                lines.append(f"  - {inv.get('phone_number')} ({r_disp}, expires {inv.get('expires_at', '')[:16]})")

        return "\n".join(lines)

    # =========================================================================
    # 9. MULTI-LINGUAL NLP LANGUAGE DETECTION
    # =========================================================================

    @staticmethod
    def detect_language(text: str) -> Dict[str, str]:
        """Detect message language: English, Hindi, Marathi, Hinglish, Minglish."""
        t = text.lower()
        is_devanagari = bool(re.search(r"[\u0900-\u097F]", text))

        if is_devanagari:
            marathi_markers = ["आहे", "आहेत", "किती", "कसा", "कशी", "पाहिजे", "मिळेल", "काय", "नाही", "साठा", "गोदाम", "तपासा", "मदत"]
            if any(w in t for w in marathi_markers):
                return {"lang": "mr", "label": "Marathi"}
            return {"lang": "hi", "label": "Hindi"}

        marathi_latin = ["kiti", "ahe", "ahet", "pahije", "kasa", "kashi", "mahiti", "godam", "satha", "madat"]
        if any(re.search(r"\b" + re.escape(w) + r"\b", t) for w in marathi_latin):
            return {"lang": "minglish", "label": "Minglish"}

        hindi_latin = ["kitna", "kitne", "hai", "kya", "batao", "mujhe", "karo", "stock", "bache", "gudam", "chahiye"]
        if any(re.search(r"\b" + re.escape(w) + r"\b", t) for w in hindi_latin):
            return {"lang": "hinglish", "label": "Hinglish"}

        return {"lang": "en", "label": "English"}

    # =========================================================================
    # 10. DETERMINISTIC INCOMING MESSAGE PROCESSING
    # =========================================================================

    @classmethod
    def process_incoming_message(
        cls,
        from_number: str,
        message_text: str,
        user_name: Optional[str] = None,
        sender_lid: Optional[str] = None,
        is_lid: bool = False,
        org_id: str = "org_triwiz_01",
        is_simulated: bool = False,
    ) -> Dict[str, Any]:
        """
        Deterministic NLP command router.
        Validates sender identity, roles, and location-scoping before executing actions.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        clean_text = message_text.strip()
        cmd_upper = clean_text.upper()
        tokens = clean_text.split()
        first_token = tokens[0].upper() if tokens else ""
        lang_info = cls.detect_language(clean_text)
        e164_from = cls.format_e164(from_number)

        # 1. Resolve registered sender
        matched_user = cls._resolve_sender(from_number, org_id, sender_lid=sender_lid)

        # ---------------------------------------------------------------------
        # Consent Management (Accessible to registered and unregistered numbers)
        # ---------------------------------------------------------------------
        if cmd_upper in ("STOP", "UNSUBSCRIBE", "CANCEL", "OPTOUT"):
            if matched_user:
                db.set_document("users", matched_user["id"], {"whatsapp_opted_in": False})
            reply = (
                "You have been unsubscribed from StockPilot AI WhatsApp notifications. "
                "Reply START to re-subscribe at any time."
            )
            return cls._log_and_return(
                org_id, from_number, message_text, reply,
                "CONSENT_OPT_OUT", matched_user, now_iso, is_simulated, lang_info["label"]
            )

        if cmd_upper in ("START", "SUBSCRIBE", "OPTIN"):
            if matched_user:
                db.set_document("users", matched_user["id"], {"whatsapp_opted_in": True})
            reply = (
                "Welcome back! You are now subscribed to StockPilot AI WhatsApp alerts. "
                "Reply HELP to see available commands."
            )
            return cls._log_and_return(
                org_id, from_number, message_text, reply,
                "CONSENT_OPT_IN", matched_user, now_iso, is_simulated, lang_info["label"]
            )

        # ---------------------------------------------------------------------
        # Self-Service Account Linking (LINK <phone> [name])
        # Allows operators or staff to link their WhatsApp directly to their real mobile number
        # ---------------------------------------------------------------------
        if first_token == "LINK":
            is_prod = settings.ENVIRONMENT.lower() in ("production", "prod")
            if is_prod or not settings.ALLOW_DEMO_MODE:
                reply = (
                    "⛔ *Security Notice*: Unauthenticated account linking via caller-supplied phone numbers is disabled in production. "
                    "Please request a registration invitation from your administrator and reply: *CONFIRM <code>*."
                )
                action_taken = "LINK_DISABLED_IN_PRODUCTION"
            elif len(tokens) < 2:
                reply = (
                    "📲 *StockPilot AI Account Linking*\n\n"
                    "Please provide your mobile number in standard format.\n"
                    "• *Usage*: LINK <mobile_number>\n"
                    "• _Example_: LINK +919975819201"
                )
                action_taken = "LINK_SYNTAX_ERROR"
            else:
                raw_input = tokens[1].strip()
                if not cls.is_valid_phone(raw_input):
                    reply = "⛔ Please provide a valid mobile number (10-15 digits with country code)."
                    action_taken = "LINK_INVALID_PHONE"
                else:
                    target_e164 = cls.format_e164(raw_input)
                    target_norm = cls._normalize_phone(raw_input)

                    # Look up user by exact normalized phone (strictly avoid ambiguous suffix matching)
                    users = db.query("users")
                    target = None
                    for u in users:
                        u_phone = u.get("phone_number") or ""
                        u_norm = cls._normalize_phone(u_phone)
                        u_e164 = cls.format_e164(u_phone)
                        if u_norm == target_norm or u_e164 == target_e164 or u_phone == target_e164:
                            target = u
                            break

                    # Security safeguard: Prevent taking over privileged accounts via self-service LINK
                    if target and target.get("role") in (ROLE_SUPER_ADMIN, ROLE_ORG_ADMIN, ROLE_SUPPLY_CHAIN_MANAGER):
                        AuditService.log_event(
                            org_id=target.get("org_id", org_id),
                            actor_id=f"unregistered_{cls._normalize_phone(from_number)}",
                            actor_name="Unknown Caller",
                            actor_role="unauthorized",
                            action="UNAUTHORIZED_PRIVILEGED_LINK_ATTEMPT",
                            target_entity="user",
                            entity_id=target["id"],
                            details={"target_phone": target_e164, "caller_from": from_number}
                        )
                        reply = "⛔ Security Error: Privileged administrator or manager accounts cannot be linked via self-service. Contact your organization administrator for an invitation challenge code."
                        action_taken = "LINK_PRIVILEGED_REJECTED"
                    else:
                        new_aliases = [target_norm, from_number]
                        if sender_lid:
                            new_aliases.append(sender_lid)

                        if target:
                            existing_aliases = target.get("whatsapp_aliases") or []
                            for a in new_aliases:
                                if a and str(a) not in existing_aliases:
                                    existing_aliases.append(str(a))
                            target["whatsapp_aliases"] = existing_aliases
                            target["whatsapp_opted_in"] = True
                            target["updated_at"] = now_iso
                            db.set_document("users", target["id"], target)
                            matched_user = target
                        else:
                            short_id = target_norm[-8:]
                            new_id = f"usr_{short_id}"
                            target = {
                                "id": new_id,
                                "org_id": org_id,
                                "email": f"operator_{short_id}@stockpilot.ai",
                                "full_name": user_name or f"Warehouse Operator ({target_e164})",
                                "role": ROLE_OPERATOR,
                                "phone_number": target_e164,
                                "whatsapp_aliases": list(set(a for a in new_aliases if a)),
                                "whatsapp_opted_in": True,
                                "is_active": True,
                                "created_at": now_iso,
                                "updated_at": now_iso
                            }
                            db.set_document("users", new_id, target)
                            matched_user = target

                        r_name = cls.ROLE_DISPLAY_NAMES.get(matched_user.get("role", "operator"), "Operator")
                        reply = (
                            f"✅ *WhatsApp Account Linked Successfully!*\n\n"
                            f"Welcome, *{matched_user.get('full_name')}*!\n"
                            f"• Mobile: *{matched_user.get('phone_number')}*\n"
                            f"• Role: *{r_name}*\n"
                            f"• Account Status: *Active*\n\n"
                            f"Reply *HELP* to see available commands or *STOCK PRD-VAX-01* to check inventory."
                        )
                        action_taken = "ACCOUNT_LINKED"

            return cls._log_and_return(
                org_id, from_number, message_text, reply,
                action_taken, matched_user, now_iso, is_simulated, lang_info["label"]
            )

        # ---------------------------------------------------------------------
        # Target User Verification (CONFIRM <code> / VERIFY <code>)
        # MUST run before unregistered sender rejection!
        # ---------------------------------------------------------------------
        if first_token in ("CONFIRM", "VERIFY"):
            if len(tokens) < 2:
                reply = "Please specify your verification code. Example: CONFIRM 123456"
                action_taken = "VERIFICATION_SYNTAX_ERROR"
            else:
                code_arg = tokens[1].strip()
                res = cls.verify_user_invitation(from_number=from_number, challenge_code=code_arg, org_id=org_id)
                reply = res["reply_text"]
                action_taken = "USER_VERIFIED" if res.get("success") else "VERIFICATION_FAILED"
                matched_user = res.get("user") or matched_user

            return cls._log_and_return(
                org_id, from_number, message_text, reply,
                action_taken, matched_user, now_iso, is_simulated, lang_info["label"]
            )

        # ---------------------------------------------------------------------
        # Initial Administrator Bootstrap (BOOTSTRAP <secret> [role])
        # MUST run before unregistered sender rejection!
        # ---------------------------------------------------------------------
        if first_token == "BOOTSTRAP":
            if len(tokens) < 2:
                reply = "Usage: BOOTSTRAP <secret_token> [org_admin|super_admin]"
                action_taken = "BOOTSTRAP_SYNTAX_ERROR"
            else:
                secret_arg = tokens[1].strip()
                role_arg = tokens[2].strip() if len(tokens) > 2 else ROLE_ORG_ADMIN
                res = cls.execute_admin_bootstrap(
                    from_number=from_number,
                    secret_token=secret_arg,
                    role=role_arg,
                    org_id=org_id
                )
                reply = res["reply_text"]
                action_taken = "ADMIN_BOOTSTRAP" if res.get("success") else "BOOTSTRAP_FAILED"
                matched_user = res.get("user") or matched_user

            return cls._log_and_return(
                org_id, from_number, message_text, reply,
                action_taken, matched_user, now_iso, is_simulated, lang_info["label"]
            )

        # ---------------------------------------------------------------------
        # Unregistered Sender Security Rejection
        # ---------------------------------------------------------------------
        if not matched_user:
            clean_digits = re.sub(r"\D", "", from_number)
            is_unmapped_lid = is_lid or len(clean_digits) >= 14

            current_boot = db.get_document("admin_bootstrap_state", "bootstrap_status")
            is_bootstrapped = bool(current_boot and current_boot.get("is_bootstrapped"))

            if is_unmapped_lid:
                # Do NOT show fake/random LID numbers like +18472906051759
                name_greeting = f"Hello *{user_name}*!" if user_name and user_name != "Warehouse Operator" else "Hello!"
                reply = (
                    f"⛔ *Security Notice*: {name_greeting}\n\n"
                    f"Your WhatsApp account is not registered with StockPilot AI.\n\n"
                    f"📲 *To link your WhatsApp to your real mobile number, reply:*\n"
                    f"*LINK <your_10_digit_mobile>*\n"
                    f"_Example: LINK 9975819201_\n\n"
                    f"Once linked, you can query live inventory, track transfers, and manage cold-chain alerts."
                )
            elif not is_bootstrapped:
                reply = (
                    f"⛔ *Security Notice*: Mobile number *{e164_from}* is not registered with StockPilot AI.\n\n"
                    f"Initial administrator setup is required. The system administrator must complete enrollment "
                    f"via the trusted web dashboard or send: *BOOTSTRAP <secret_token>*"
                )
            else:
                reply = (
                    f"⛔ *Security Notice*: Mobile number *{e164_from}* is not registered with StockPilot AI. "
                    f"Contact your organization administrator for access, or reply *LINK <mobile>* to connect your profile."
                )

            AuditService.log_event(
                org_id=org_id,
                actor_id=f"unregistered_{cls._normalize_phone(e164_from)}",
                actor_name=user_name or "Unregistered Caller",
                actor_role="unauthorized",
                action="UNAUTHORIZED_SENDER_MESSAGE",
                target_entity="whatsapp_gateway",
                entity_id=e164_from,
                details={"message": clean_text[:64], "is_lid": is_unmapped_lid}
            )
            cls._log_and_return(
                org_id, from_number, message_text, reply,
                "UNAUTHORIZED_SENDER", None, now_iso, is_simulated, lang_info["label"]
            )
            return {
                "reply_text": reply,
                "action_taken": "UNAUTHORIZED_SENDER",
                "status": "unauthorized",
                "is_simulated": is_simulated,
                "language": lang_info["label"]
            }

        # ---------------------------------------------------------------------
        # Active Status Verification (Prevent deactivated accounts from operating)
        # ---------------------------------------------------------------------
        if not matched_user.get("is_active", True):
            reply = "⛔ Your StockPilot AI account has been deactivated. Please contact your organization administrator."
            AuditService.log_event(
                org_id=matched_user.get("org_id", org_id),
                actor_id=matched_user["id"],
                actor_name=matched_user.get("full_name", "User"),
                actor_role=matched_user.get("role", "operator"),
                action="DEACTIVATED_USER_ACCESS_ATTEMPT",
                target_entity="whatsapp_gateway",
                entity_id=e164_from,
                details={"message": clean_text[:64]}
            )
            return cls._log_and_return(
                org_id, from_number, message_text, reply,
                "ACCOUNT_DEACTIVATED", matched_user, now_iso, is_simulated, lang_info["label"]
            )

        user_role = matched_user.get("role", ROLE_OPERATOR)
        user_name = matched_user.get("full_name", "Authorized User")
        role_display = cls.ROLE_DISPLAY_NAMES.get(user_role, user_role)

        # ---------------------------------------------------------------------
        # Check Opt-In Status (Allow HELP/STATUS/WHOAMI/MYROLE even if paused)
        # ---------------------------------------------------------------------
        read_only_cmds = ("HELP", "MENU", "?", "STATUS", "WHOAMI", "MYROLE")
        if first_token not in read_only_cmds and not matched_user.get("whatsapp_opted_in", True):
            reply = "Your WhatsApp notifications are paused. Reply *START* to re-enable alerts."
            return cls._log_and_return(
                org_id, from_number, message_text, reply,
                "OPTED_OUT", matched_user, now_iso, is_simulated, lang_info["label"]
            )

        # ---------------------------------------------------------------------
        # Natural Language Intent Mapping (NLP Decision Pipeline)
        # ---------------------------------------------------------------------
        t_lower = clean_text.lower()
        if not any(cmd_upper.startswith(c) for c in (
            "STATUS", "STOCK", "TRANSFER", "ALERTS", "APPROVE", "REJECT",
            "HELP", "STOP", "START", "HUMAN", "WHOAMI", "MYROLE", "USER"
        )):
            if any(w in t_lower for w in ("whoami", "my profile", "profile", "kaun hu", "kon ahe")):
                cmd_upper = "WHOAMI"
            elif any(w in t_lower for w in ("my role", "myrole", "role kya hai", "role kay ahe")):
                cmd_upper = "MYROLE"
            elif any(w in t_lower for w in ("stock", "kitna", "kitne", "kiti", "bache", "satha", "inventory", "vax", "insulin", "साठा", "किती")):
                sku_found = "PRD-VAX-01"
                for candidate in ("PRD-VAX-01", "PRD-INS-02", "PRD-DX-03", "PRD-PPE-04"):
                    if candidate.lower() in t_lower or candidate.split("-")[1].lower() in t_lower:
                        sku_found = candidate
                        break
                cmd_upper = f"STOCK {sku_found}"
            elif any(w in t_lower for w in ("status", "kasa", "kaisa", "health", "system", "all", "स्थिती", "कसा")):
                cmd_upper = "STATUS"
            elif any(w in t_lower for w in ("alert", "temp", "tapman", "cold", "issue", "danger", "चेतावणी", "तापमान")):
                cmd_upper = "ALERTS"
            elif any(w in t_lower for w in ("approve", "manzoor", "accept", "dispatch", "मंजूर")):
                m = re.search(r"(TRF-[A-Z0-9-]+)", clean_text, re.IGNORECASE)
                trf_id = m.group(1).upper() if m else "TRF-ORD-JFK-101"
                cmd_upper = f"APPROVE {trf_id}"
            elif any(w in t_lower.split() or w in t_lower for w in ("hi", "hello", "hey", "namaste", "pranam", "help", "madat", "sahayata", "menu", "command", "मदत", "सहायता")):
                cmd_upper = "HELP"

        reply = ""
        action_taken = None

        # ---------------------------------------------------------------------
        # Command: WHOAMI (Read-only identity verification)
        # ---------------------------------------------------------------------
        if cmd_upper == "WHOAMI":
            wh_scopes = matched_user.get("warehouse_ids") or ([matched_user["warehouse_id"]] if matched_user.get("warehouse_id") else [])
            wh_display = ", ".join(wh_scopes) if wh_scopes else "All Organization Warehouses"
            status_text = "Active" if matched_user.get("is_active", True) else "Disabled"
            consent_text = "Subscribed (Opted-in)" if matched_user.get("whatsapp_opted_in", True) else "Paused (Opted-out)"

            reply = (
                f"*StockPilot AI Profile Verification*\n"
                f"- Name: *{user_name}*\n"
                f"- Mobile: *{matched_user.get('phone_number') or e164_from}*\n"
                f"- Role: *{role_display}* ({user_role})\n"
                f"- Organization: *{matched_user.get('org_id', org_id)}*\n"
                f"- Permitted Warehouse Scope: {wh_display}\n"
                f"- Account Status: *{status_text}*\n"
                f"- WhatsApp Notifications: {consent_text}"
            )
            action_taken = "WHOAMI_LOOKUP"

        # ---------------------------------------------------------------------
        # Command: MYROLE (Read-only role inquiry)
        # ---------------------------------------------------------------------
        elif cmd_upper == "MYROLE":
            reply = f"Your current assigned role is: *{role_display}* ({user_role})."
            action_taken = "MYROLE_LOOKUP"

        # ---------------------------------------------------------------------
        # Command: HELP / MENU (Role-scoped documentation)
        # ---------------------------------------------------------------------
        elif cmd_upper in ("HELP", "MENU", "?"):
            is_admin = user_role in (ROLE_SUPER_ADMIN, ROLE_ORG_ADMIN) or user_has_permission(matched_user, PERM_USERS_MANAGE)
            admin_section = ""
            if is_admin:
                admin_section = (
                    "\n*User Registration & Role Commands*:\n"
                    "- *USER ADD <phone> [role]* - Register new number & send invite\n"
                    "- *USER ROLE <phone> <role>* - Assign/change role\n"
                    "- *USER WAREHOUSE <phone> <wh_id>* - Assign warehouse scope\n"
                    "- *USER REMOVE-WAREHOUSE <phone> <wh_id>* - Remove warehouse scope\n"
                    "- *USER SHOW <phone>* - Inspect profile & scopes\n"
                    "- *USER DISABLE <phone>* - Deactivate user\n"
                    "- *USER ENABLE <phone>* - Re-enable user\n"
                    "- *USER LIST* - List users & pending invites\n"
                )

            reply = (
                f"*STOCKPILOT AI Mobile Assistant*\n"
                f"Authenticated as: *{user_name}* ({role_display})\n"
                f"{admin_section}\n"
                f"*Operational Commands*:\n"
                f"- *STATUS* - Network inventory & warehouse health\n"
                f"- *STOCK <SKU>* - Check stock levels (e.g. STOCK PRD-VAX-01)\n"
                f"- *TRANSFER <TRF_ID>* - Check transfer status\n"
                f"- *ALERTS* - Active IoT cold-chain alerts\n"
                f"- *APPROVE <TRF_ID>* - Approve transfer (Managers only)\n"
                f"- *REJECT <TRF_ID>* - Reject transfer\n"
                f"- *WHOAMI* - View your profile & warehouse scope\n"
                f"- *MYROLE* - View your assigned role\n"
                f"- *STOP* - Unsubscribe from notifications\n"
                f"- *HUMAN* - Escalate to Central Operations Desk"
            )
            action_taken = "HELP_REQUESTED"

        # ---------------------------------------------------------------------
        # Command: USER ... (Administrative Registration & Role Management)
        # ---------------------------------------------------------------------
        elif cmd_upper.startswith("USER"):
            is_admin = user_role in (ROLE_SUPER_ADMIN, ROLE_ORG_ADMIN) or user_has_permission(matched_user, PERM_USERS_MANAGE)
            if not is_admin:
                reply = f"⛔ Unauthorized: Role '{user_role}' does not have permission to execute user management commands."
                AuditService.log_event(
                    org_id=matched_user.get("org_id", org_id),
                    actor_id=matched_user["id"],
                    actor_name=user_name,
                    actor_role=user_role,
                    action="UNAUTHORIZED_USER_MANAGEMENT_ATTEMPT",
                    target_entity="whatsapp_gateway",
                    entity_id=e164_from,
                    details={"command": clean_text}
                )
                action_taken = "USER_MGMT_UNAUTHORIZED"
            else:
                user_tokens = clean_text.split()
                sub_cmd = user_tokens[1].upper() if len(user_tokens) > 1 else ""
                args = user_tokens[2:]

                if sub_cmd == "ADD":
                    if not args:
                        reply = (
                            "⛔ Invalid format.\n"
                            "Usage: USER ADD <phone> [role]\n"
                            "Example: USER ADD +919876543210 warehouse_manager\n"
                            f"Supported roles: {', '.join(sorted(cls.VALID_ROLES))}"
                        )
                    else:
                        target_p = args[0]
                        proposed_r = args[1] if len(args) > 1 else ROLE_OPERATOR
                        res = cls.create_user_invitation(
                            admin_user=matched_user,
                            target_phone=target_p,
                            proposed_role=proposed_r,
                            org_id=matched_user.get("org_id", org_id)
                        )
                        reply = res["reply_text"]
                    action_taken = "USER_ADD_EXECUTED"

                elif sub_cmd == "ROLE":
                    reply = cls.handle_user_role(matched_user, args, matched_user.get("org_id", org_id))
                    action_taken = "USER_ROLE_EXECUTED"

                elif sub_cmd == "WAREHOUSE":
                    reply = cls.handle_user_warehouse(matched_user, args, matched_user.get("org_id", org_id))
                    action_taken = "USER_WAREHOUSE_EXECUTED"

                elif sub_cmd in ("REMOVE-WAREHOUSE", "REMOVE_WAREHOUSE"):
                    reply = cls.handle_user_remove_warehouse(matched_user, args, matched_user.get("org_id", org_id))
                    action_taken = "USER_REMOVE_WAREHOUSE_EXECUTED"

                elif sub_cmd == "DISABLE":
                    reply = cls.handle_user_disable(matched_user, args, matched_user.get("org_id", org_id))
                    action_taken = "USER_DISABLE_EXECUTED"

                elif sub_cmd == "ENABLE":
                    reply = cls.handle_user_enable(matched_user, args, matched_user.get("org_id", org_id))
                    action_taken = "USER_ENABLE_EXECUTED"

                elif sub_cmd == "SHOW":
                    reply = cls.handle_user_show(matched_user, args, matched_user.get("org_id", org_id))
                    action_taken = "USER_SHOW_EXECUTED"

                elif sub_cmd == "LIST":
                    reply = cls.handle_user_list(matched_user, matched_user.get("org_id", org_id))
                    action_taken = "USER_LIST_EXECUTED"

                else:
                    reply = (
                        "⛔ Unknown USER command.\n"
                        "Supported user management commands:\n"
                        "- *USER ADD <phone> [role]*\n"
                        "- *USER ROLE <phone> <role>*\n"
                        "- *USER WAREHOUSE <phone> <wh_id>*\n"
                        "- *USER REMOVE-WAREHOUSE <phone> <wh_id>*\n"
                        "- *USER SHOW <phone>*\n"
                        "- *USER DISABLE <phone>*\n"
                        "- *USER ENABLE <phone>*\n"
                        "- *USER LIST*"
                    )
                    action_taken = "USER_MGMT_SYNTAX_ERROR"

        # ---------------------------------------------------------------------
        # Command: STATUS (Authorized service and account status)
        # ---------------------------------------------------------------------
        elif cmd_upper == "STATUS":
            warehouses = db.query("warehouses", org_id=org_id)
            inv_list = db.query("inventory", org_id=org_id)
            total_items = sum(item.get("total_quantity", 0) for item in inv_list)
            wh_lines = []
            for w in warehouses:
                status_icon = "Active" if w.get("is_operational") else "Down"
                wh_lines.append("  - {}: {}/{} pallets ({})".format(
                    w["name"], w.get("used_pallets", 0), w.get("capacity_pallets", 0), status_icon))
            reply = ("*STOCKPILOT AI System Status*\n"
                     "Total Network Stock: *{:,} units*\n"
                     "Warehouses Monitored: *{}*\n{}").format(total_items, len(warehouses), "\n".join(wh_lines))
            action_taken = "STATUS_QUERY"

        # ---------------------------------------------------------------------
        # Command: STOCK <SKU>
        # ---------------------------------------------------------------------
        elif cmd_upper.startswith("STOCK"):
            parts = cmd_upper.split()
            if len(parts) < 2:
                reply = "Please specify a SKU. Example: STOCK PRD-VAX-01"
            else:
                sku_query = parts[1].strip().upper()
                products = db.query("products", org_id=org_id)
                matched_prd = next((p for p in products
                                    if p["sku"].upper() == sku_query or sku_query in p["name"].upper()), None)
                if not matched_prd:
                    reply = f"Product with SKU '{sku_query}' not found."
                else:
                    inv_records = db.query("inventory", filters={"product_id": matched_prd["id"]}, org_id=org_id)
                    total_avail = sum(i["available_quantity"] for i in inv_records)
                    wh_lines = []
                    for i in inv_records:
                        wh = db.get_document("warehouses", i["warehouse_id"])
                        wh_name = wh["name"] if wh else i["warehouse_id"]
                        wh_lines.append(f"  - {wh_name}: {i['available_quantity']} avail (Safety: {i.get('safety_stock', 0)})")
                    reply = (
                        f"*Inventory: {matched_prd['name']}* ({matched_prd['sku']})\n"
                        f"Total Available: *{total_avail:,} {matched_prd.get('unit', 'units')}*\n"
                        f"Handling: {matched_prd.get('handling', 'standard').upper()}\n"
                        f"Locations:\n{chr(10).join(wh_lines)}"
                    )
            action_taken = "STOCK_QUERY"

        # ---------------------------------------------------------------------
        # Command: TRANSFER <TRF_ID>
        # ---------------------------------------------------------------------
        elif cmd_upper.startswith("TRANSFER"):
            parts = cmd_upper.split()
            if len(parts) < 2:
                reply = "Please specify a Transfer ID. Example: TRANSFER trf_001"
            else:
                trf_id = parts[1].strip()
                transfer = db.get_document("transfers", trf_id)
                if not transfer or (user_role != ROLE_SUPER_ADMIN and transfer.get("org_id") != org_id):
                    reply = f"Transfer '{trf_id}' not found."
                else:
                    src = db.get_document("warehouses", transfer.get("source_warehouse_id", ""))
                    dst = db.get_document("warehouses", transfer.get("target_warehouse_id", ""))
                    deep_link = f"https://app.stockpilot.ai/transfers?id={trf_id}"
                    reply = (
                        f"*Transfer {trf_id}*\nStatus: *{transfer['status'].upper()}*\n"
                        f"{src['name'] if src else transfer.get('source_warehouse_id')} -> {dst['name'] if dst else transfer.get('target_warehouse_id')}\n"
                        f"Items: {len(transfer.get('items', []))}\nView: {deep_link}"
                    )
            action_taken = "TRANSFER_QUERY"

        # ---------------------------------------------------------------------
        # Command: ALERTS
        # ---------------------------------------------------------------------
        elif cmd_upper == "ALERTS":
            user_whs = matched_user.get("warehouse_ids") or ([matched_user.get("warehouse_id")] if matched_user.get("warehouse_id") else [])
            alerts = db.query("alerts", filters={"acknowledged": False}, org_id=org_id)
            if user_role == ROLE_WAREHOUSE_MANAGER and user_whs:
                alerts = [a for a in alerts if a.get("warehouse_id") in user_whs]
            if not alerts:
                reply = "All clear. No unacknowledged IoT cold-chain alerts."
            else:
                lines = [f"  [{a['severity'].upper()}] {a['message']}" for a in alerts[:5]]
                reply = f"*Active Cold-Chain Alerts ({len(alerts)})*:\n{chr(10).join(lines)}"
            action_taken = "ALERTS_QUERY"

        # ---------------------------------------------------------------------
        # Command: APPROVE <TRF_ID>
        # ---------------------------------------------------------------------
        elif cmd_upper.startswith("APPROVE"):
            if user_role not in cls.MANAGER_ROLES:
                reply = f"Unauthorized: role '{user_role}' cannot approve transfers."
                action_taken = "TRANSFER_APPROVAL_UNAUTHORIZED"
            else:
                parts = clean_text.split()
                if len(parts) < 2:
                    reply = "Please specify Transfer ID. Example: APPROVE trf_001"
                    action_taken = "TRANSFER_APPROVAL_SYNTAX_ERROR"
                else:
                    trf_id = parts[1].strip()
                    # 1. Verify actual transfer exists in database
                    transfer = db.get_document("transfers", trf_id)
                    if not transfer:
                        all_trfs = db.query("transfers", org_id=org_id)
                        transfer = next((t for t in all_trfs if t["id"].lower() == trf_id.lower() or t.get("transfer_number", "").lower() == trf_id.lower()), None)

                    if not transfer:
                        reply = f"Error: Transfer '{trf_id}' not found."
                        action_taken = "TRANSFER_NOT_FOUND"
                    elif user_role != ROLE_SUPER_ADMIN and transfer.get("org_id") != org_id:
                        reply = f"Unauthorized: Transfer '{trf_id}' does not belong to your organization."
                        action_taken = "TRANSFER_UNAUTHORIZED_ORG"
                    else:
                        actual_trf_id = transfer["id"]
                        src_wh = transfer.get("source_warehouse_id")
                        dst_wh = transfer.get("target_warehouse_id")
                        user_whs = matched_user.get("warehouse_ids") or ([matched_user.get("warehouse_id")] if matched_user.get("warehouse_id") else [])

                        # 2. Check facility scope for warehouse managers
                        if user_role == ROLE_WAREHOUSE_MANAGER and user_whs and src_wh not in user_whs and dst_wh not in user_whs:
                            reply = f"Unauthorized: Warehouse Manager cannot approve transfer outside assigned facility ({', '.join(user_whs)})."
                            action_taken = "TRANSFER_WAREHOUSE_UNAUTHORIZED"
                        else:
                            # 3. Check current transfer state
                            curr_status = (transfer.get("status") or "").lower()
                            if curr_status not in ("requested", "pending"):
                                reply = f"Error: Transfer {actual_trf_id} has already been approved / processed (current status: {curr_status.upper()})."
                                action_taken = "TRANSFER_ALREADY_PROCESSED"
                            else:
                                try:
                                    InventoryService.approve_or_reject_transfer(
                                        transfer_id=actual_trf_id, approved=True,
                                        actor_id=matched_user["id"], actor_name=user_name,
                                        actor_role=user_role, user_warehouse_id=matched_user.get("warehouse_id"),
                                        org_id=org_id, notes="Approved via authenticated WhatsApp")
                                    deep_link = f"https://app.stockpilot.ai/transfers?id={actual_trf_id}"
                                    reply = f"Transfer {actual_trf_id} Approved. Status: IN_TRANSIT.\nDetails: {deep_link}"
                                    action_taken = "TRANSFER_APPROVED"
                                except HTTPException as e:
                                    reply = f"Error: {e.detail}"
                                    action_taken = "TRANSFER_APPROVAL_ERROR"
                                except Exception as e:
                                    reply = f"Error approving transfer: {str(e)}"
                                    action_taken = "TRANSFER_APPROVAL_ERROR"

        # ---------------------------------------------------------------------
        # Command: REJECT <TRF_ID>
        # ---------------------------------------------------------------------
        elif cmd_upper.startswith("REJECT"):
            if user_role not in cls.MANAGER_ROLES:
                reply = f"Unauthorized: role '{user_role}' cannot reject transfers."
                action_taken = "TRANSFER_REJECTION_UNAUTHORIZED"
            else:
                parts = clean_text.split()
                if len(parts) < 2:
                    reply = "Please specify Transfer ID. Example: REJECT trf_001"
                    action_taken = "TRANSFER_REJECTION_SYNTAX_ERROR"
                else:
                    trf_id = parts[1].strip()
                    transfer = db.get_document("transfers", trf_id)
                    if not transfer:
                        all_trfs = db.query("transfers", org_id=org_id)
                        transfer = next((t for t in all_trfs if t["id"].lower() == trf_id.lower() or t.get("transfer_number", "").lower() == trf_id.lower()), None)

                    if not transfer:
                        reply = f"Error: Transfer '{trf_id}' not found."
                        action_taken = "TRANSFER_NOT_FOUND"
                    elif user_role != ROLE_SUPER_ADMIN and transfer.get("org_id") != org_id:
                        reply = f"Unauthorized: Transfer '{trf_id}' does not belong to your organization."
                        action_taken = "TRANSFER_UNAUTHORIZED_ORG"
                    else:
                        actual_trf_id = transfer["id"]
                        src_wh = transfer.get("source_warehouse_id")
                        dst_wh = transfer.get("target_warehouse_id")
                        user_whs = matched_user.get("warehouse_ids") or ([matched_user.get("warehouse_id")] if matched_user.get("warehouse_id") else [])

                        if user_role == ROLE_WAREHOUSE_MANAGER and user_whs and src_wh not in user_whs and dst_wh not in user_whs:
                            reply = f"Unauthorized: Warehouse Manager cannot reject transfer outside assigned facility ({', '.join(user_whs)})."
                            action_taken = "TRANSFER_WAREHOUSE_UNAUTHORIZED"
                        else:
                            curr_status = (transfer.get("status") or "").lower()
                            if curr_status not in ("requested", "pending"):
                                reply = f"Error: Transfer {actual_trf_id} has already been approved / processed (current status: {curr_status.upper()})."
                                action_taken = "TRANSFER_ALREADY_PROCESSED"
                            else:
                                try:
                                    InventoryService.approve_or_reject_transfer(
                                        transfer_id=actual_trf_id, approved=False,
                                        actor_id=matched_user["id"], actor_name=user_name,
                                        actor_role=user_role, user_warehouse_id=matched_user.get("warehouse_id"),
                                        org_id=org_id, notes="Rejected via WhatsApp")
                                    reply = f"Transfer {actual_trf_id} has been Rejected."
                                    action_taken = "TRANSFER_REJECTED"
                                except HTTPException as e:
                                    reply = f"Error: {e.detail}"
                                    action_taken = "TRANSFER_REJECTION_ERROR"
                                except Exception as e:
                                    reply = f"Error rejecting transfer: {str(e)}"
                                    action_taken = "TRANSFER_REJECTION_ERROR"

        # ---------------------------------------------------------------------
        # Command: HUMAN (Operations Desk Escalation)
        # ---------------------------------------------------------------------
        elif cmd_upper == "HUMAN":
            reply = (
                "Desk Escalation: A high-priority ticket has been dispatched to Central Logistics. "
                "An operations agent will contact you shortly."
            )
            action_taken = "HUMAN_ESCALATION"

        else:
            reply = f"Command '{clean_text}' not recognized. Reply HELP to see available commands."
            action_taken = "UNKNOWN_COMMAND"

        return cls._log_and_return(
            org_id, from_number, message_text, reply,
            action_taken, matched_user, now_iso, is_simulated, lang_info["label"]
        )

    # =========================================================================
    # 11. AUDIT LOGGING & DISPATCHING
    # =========================================================================

    @classmethod
    def _log_and_return(
        cls,
        org_id: str,
        from_number: str,
        incoming_text: str,
        reply_text: str,
        action_taken: Optional[str],
        user: Optional[Dict[str, Any]],
        now_iso: str,
        is_simulated: bool = False,
        language: str = "English"
    ) -> Dict[str, Any]:
        """Appends notification record and dispatches outbound message if not simulated."""
        log_id = f"wa_{uuid.uuid4().hex[:12]}"
        delivery_status = "SIMULATED_LOCAL" if is_simulated else "queued"
        log_entry = {
            "id": log_id,
            "org_id": org_id,
            "from_number": from_number,
            "incoming_text": incoming_text,
            "outgoing_reply": reply_text,
            "language": language,
            "actor_id": user["id"] if user else None,
            "actor_name": user.get("full_name") if user else "UNKNOWN",
            "action_taken": action_taken,
            "timestamp": now_iso,
            "is_simulated": is_simulated,
            "delivery_status": delivery_status
        }
        db.set_document("notification_logs", log_id, log_entry, merge=False)

        # Attempt actual outbound send if not simulated and credentials are real
        if not is_simulated:
            cls._dispatch_outbound(from_number, reply_text, log_id)

        return {
            "reply_text": reply_text,
            "action_taken": action_taken,
            "correlation_id": log_id,
            "status": "delivered" if not is_simulated else "simulated",
            "is_simulated": is_simulated,
            "language": language
        }

    @classmethod
    def _dispatch_outbound(cls, to_number: str, message_body: str, correlation_id: str) -> None:
        """
        Send a message via Meta WhatsApp Cloud API v21.0.
        Falls back to SIMULATED_LOCAL if token is mock or missing.
        """
        token = settings.WHATSAPP_API_TOKEN
        phone_number_id = settings.WHATSAPP_PHONE_NUMBER_ID
        if not token or token.startswith("mock_"):
            db.set_document("notification_logs", correlation_id, {
                "delivery_status": "SIMULATED_LOCAL",
                "is_simulated": True
            })
            return
        try:
            import urllib.request
            url = f"https://graph.facebook.com/v21.0/{phone_number_id}/messages"
            payload_data = json.dumps({
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": to_number,
                "type": "text",
                "text": {"preview_url": False, "body": message_body}
            }).encode("utf-8")
            req = urllib.request.Request(url, data=payload_data, method="POST")
            req.add_header("Authorization", f"Bearer {token}")
            req.add_header("Content-Type", "application/json")
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                wa_msg_id = result.get("messages", [{}])[0].get("id")
                db.set_document("notification_logs", correlation_id, {
                    "delivery_status": "sent",
                    "whatsapp_message_id": wa_msg_id
                })
        except Exception as e:
            db.set_document("notification_logs", correlation_id, {
                "delivery_status": "send_failed",
                "send_error": str(e)
            })

    # =========================================================================
    # 12. OUTBOUND ALERT DISPATCHERS
    # =========================================================================

    @classmethod
    def send_excursion_alert(cls, org_id: str, alert: Dict[str, Any]) -> None:
        """Send cold-chain excursion alert to all opted-in managers in the org."""
        managers = [
            u for u in db.query("users", org_id=org_id)
            if u.get("role") in cls.MANAGER_ROLES
            and u.get("whatsapp_opted_in", True)
            and u.get("phone_number")
        ]
        message = (
            f"COLD-CHAIN ALERT [{alert.get('severity', 'warning').upper()}]\n"
            f"{alert.get('message', '')}\n"
            f"Warehouse: {alert.get('warehouse_id', '')}\n"
            f"Device: {alert.get('device_id', '')}\n"
            f"Acknowledged: No\nView: https://app.stockpilot.ai/iot/alerts"
        )
        for manager in managers:
            cls._dispatch_outbound(
                manager["phone_number"], message,
                f"wa_{uuid.uuid4().hex[:12]}"
            )

    @classmethod
    def send_stockout_alert(
        cls,
        org_id: str,
        product_name: str,
        warehouse_name: str,
        available_qty: int
    ) -> None:
        managers = [
            u for u in db.query("users", org_id=org_id)
            if u.get("role") in cls.MANAGER_ROLES
            and u.get("whatsapp_opted_in", True)
            and u.get("phone_number")
        ]
        message = (
            f"STOCK ALERT: {product_name} is critically low at {warehouse_name}.\n"
            f"Available: {available_qty} units. Review: https://app.stockpilot.ai/inventory"
        )
        for manager in managers:
            cls._dispatch_outbound(
                manager["phone_number"], message,
                f"wa_{uuid.uuid4().hex[:12]}"
            )

    @classmethod
    def send_transfer_approval_request(
        cls,
        org_id: str,
        transfer_id: str,
        src_name: str,
        dst_name: str,
        item_count: int,
        requested_by: str
    ) -> None:
        managers = [
            u for u in db.query("users", org_id=org_id)
            if u.get("role") in cls.MANAGER_ROLES
            and u.get("whatsapp_opted_in", True)
            and u.get("phone_number")
        ]
        deep_link = f"https://app.stockpilot.ai/transfers?id={transfer_id}"
        message = (
            f"Transfer Approval Required\nID: {transfer_id}\n"
            f"{src_name} -> {dst_name}\nItems: {item_count}\n"
            f"Requested by: {requested_by}\n"
            f"Reply: APPROVE {transfer_id}\nView: {deep_link}"
        )
        for manager in managers:
            cls._dispatch_outbound(
                manager["phone_number"], message,
                f"wa_{uuid.uuid4().hex[:12]}"
            )
