import pytest
import hmac
import hashlib
from fastapi.testclient import TestClient
from app.main import app
from app.core.database import db
from app.core.config import settings
from app.core.security import create_access_token
from app.services.whatsapp_service import WhatsAppBotService
from app.core.permissions import (
    ROLE_SUPER_ADMIN,
    ROLE_ORG_ADMIN,
    ROLE_SUPPLY_CHAIN_MANAGER,
    ROLE_WAREHOUSE_MANAGER,
    ROLE_OPERATOR,
    ROLE_DISTRIBUTOR,
    PERM_USERS_MANAGE,
    PERM_ROLES_ASSIGN,
)

client = TestClient(app)

ORG_ID = "org_triwiz_01"
SUPER_ADMIN_PHONE = "+13125550101"
ORG_ADMIN_PHONE = "+13125550102"
OPERATOR_PHONE = "+13125550106"
UNREGISTERED_PHONE = "+919999900001"
TARGET_NEW_PHONE = "+919876543210"


@pytest.fixture(autouse=True)
def setup_test_users():
    """Ensure baseline test users exist with consistent personas."""
    # Ensure super admin
    super_admin = db.get_document("users", "usr_superadmin") or {}
    super_admin.update({
        "id": "usr_superadmin",
        "email": "superadmin@stockpilot.ai",
        "full_name": "Sarah Chen",
        "role": ROLE_SUPER_ADMIN,
        "org_id": ORG_ID,
        "warehouse_id": None,
        "warehouse_ids": [],
        "phone_number": SUPER_ADMIN_PHONE,
        "is_active": True,
        "whatsapp_opted_in": True,
    })
    db.set_document("users", "usr_superadmin", super_admin)

    # Ensure org admin
    org_admin = db.get_document("users", "usr_orgadmin") or {}
    org_admin.update({
        "id": "usr_orgadmin",
        "email": "orgadmin@stockpilot.ai",
        "full_name": "Marcus Vance",
        "role": ROLE_ORG_ADMIN,
        "org_id": ORG_ID,
        "warehouse_id": None,
        "warehouse_ids": [],
        "phone_number": ORG_ADMIN_PHONE,
        "is_active": True,
        "whatsapp_opted_in": True,
    })
    db.set_document("users", "usr_orgadmin", org_admin)

    # Ensure second org admin (for final org admin safeguard tests)
    admin2 = db.get_document("users", "usr_organizer_vk") or {}
    admin2.update({
        "id": "usr_organizer_vk",
        "email": "organizer@stockpilot.ai",
        "full_name": "Organizer (Vk)",
        "role": ROLE_ORG_ADMIN,
        "org_id": ORG_ID,
        "warehouse_id": None,
        "warehouse_ids": [],
        "phone_number": "+917385819857",
        "is_active": True,
        "whatsapp_opted_in": True,
    })
    db.set_document("users", "usr_organizer_vk", admin2)

    # Ensure operator
    operator = db.get_document("users", "usr_operator") or {}
    operator.update({
        "id": "usr_operator",
        "email": "operator@stockpilot.ai",
        "full_name": "James O'Connor",
        "role": ROLE_OPERATOR,
        "org_id": ORG_ID,
        "warehouse_id": "wh_chicago_01",
        "warehouse_ids": ["wh_chicago_01"],
        "phone_number": OPERATOR_PHONE,
        "is_active": True,
        "whatsapp_opted_in": True,
    })
    db.set_document("users", "usr_operator", operator)

    # Clean target phone user and invitations
    for uid, u in list(db._collections.get("users", {}).items()):
        if u.get("phone_number") == TARGET_NEW_PHONE:
            db.delete_document("users", uid)

    db._collections["whatsapp_invitations"] = {}
    db.delete_document("admin_bootstrap_state", "bootstrap_status")
    yield


# =============================================================================
# 1. ADMIN BOOTSTRAP WORKFLOW TESTS
# =============================================================================

class TestAdminBootstrap:

    def test_bootstrap_with_invalid_secret_fails(self):
        """Unauthenticated sender with incorrect bootstrap secret is rejected."""
        res = WhatsAppBotService.process_incoming_message(
            from_number="+919888877771",
            message_text="BOOTSTRAP wrong_secret org_admin",
            org_id=ORG_ID
        )
        assert "Invalid administrator bootstrap secret" in res["reply_text"]
        assert res.get("action_taken") == "BOOTSTRAP_FAILED"

        # Verify audit log was recorded
        audit_records = db.query("audit_logs", filters={"action": "UNAUTHORIZED_BOOTSTRAP_ATTEMPT"})
        assert len(audit_records) > 0

    def test_bootstrap_with_valid_secret_succeeds_and_locks(self):
        """Valid secret registers initial admin and locks further bootstrap."""
        # Reset bootstrap status for this test
        db.delete_document("admin_bootstrap_state", "bootstrap_status")
        bootstrap_phone = "+919888877772"

        res = WhatsAppBotService.process_incoming_message(
            from_number=bootstrap_phone,
            message_text=f"BOOTSTRAP {settings.ADMIN_BOOTSTRAP_SECRET} org_admin",
            org_id=ORG_ID
        )
        assert "Administrator Bootstrap Succeeded" in res["reply_text"]
        assert "Organization Administrator" in res["reply_text"]

        # Sender should now be resolved as an Org Admin
        user = WhatsAppBotService._resolve_sender(bootstrap_phone, ORG_ID)
        assert user is not None
        assert user["role"] == ROLE_ORG_ADMIN
        assert user["is_active"] is True

        # Second attempt must be rejected (bootstrap is locked)
        res_repeat = WhatsAppBotService.process_incoming_message(
            from_number="+919888877773",
            message_text=f"BOOTSTRAP {settings.ADMIN_BOOTSTRAP_SECRET} org_admin",
            org_id=ORG_ID
        )
        assert "already been completed and locked" in res_repeat["reply_text"]


# =============================================================================
# 2. INVITATION & VERIFICATION WORKFLOW TESTS
# =============================================================================

class TestUserInvitationAndVerification:

    def test_org_admin_creates_pending_invitation(self):
        """Authorized Org Admin sends USER ADD -> pending invitation created with 6-digit challenge."""
        res = WhatsAppBotService.process_incoming_message(
            from_number=ORG_ADMIN_PHONE,
            message_text=f"USER ADD {TARGET_NEW_PHONE} warehouse_manager",
            org_id=ORG_ID
        )
        assert "Invitation Created" in res["reply_text"]
        assert "Warehouse Manager" in res["reply_text"]
        assert "Pending Verification" in res["reply_text"]

        # Verify invitation doc exists in db
        invs = db.query("whatsapp_invitations", filters={"phone_number": TARGET_NEW_PHONE})
        assert len(invs) == 1
        inv = invs[0]
        assert inv["status"] == "pending"
        assert inv["role"] == ROLE_WAREHOUSE_MANAGER
        assert len(inv["challenge_code"]) == 6
        assert inv["attempts"] == 0

        # Verify audit log created (without sensitive plaintext challenge code)
        audits = db.query("audit_logs", filters={"action": "USER_INVITATION_CREATED"})
        assert len(audits) >= 1
        assert "challenge_code" not in audits[0].get("details", {})

    def test_pending_user_cannot_access_commands_before_verification(self):
        """Unverified target number receives security notice when attempting operational commands."""
        # Create invitation first
        WhatsAppBotService.process_incoming_message(
            from_number=ORG_ADMIN_PHONE,
            message_text=f"USER ADD {TARGET_NEW_PHONE} warehouse_manager",
            org_id=ORG_ID
        )
        # Target attempts STATUS before verifying
        res = WhatsAppBotService.process_incoming_message(
            from_number=TARGET_NEW_PHONE,
            message_text="STATUS",
            org_id=ORG_ID
        )
        assert "Security Notice" in res["reply_text"]
        assert "not registered" in res["reply_text"]

    def test_target_user_verifies_with_challenge_code(self):
        """Target sends CONFIRM <code> -> account activated, role bound."""
        # Create invitation
        WhatsAppBotService.process_incoming_message(
            from_number=ORG_ADMIN_PHONE,
            message_text=f"USER ADD {TARGET_NEW_PHONE} warehouse_manager",
            org_id=ORG_ID
        )
        inv = db.query("whatsapp_invitations", filters={"phone_number": TARGET_NEW_PHONE})[0]
        code = inv["challenge_code"]

        # Target confirms with valid code
        res = WhatsAppBotService.process_incoming_message(
            from_number=TARGET_NEW_PHONE,
            message_text=f"CONFIRM {code}",
            org_id=ORG_ID
        )
        assert "Welcome to StockPilot AI" in res["reply_text"]
        assert "Warehouse Manager" in res["reply_text"]
        assert "Active" in res["reply_text"]

        # Verify invitation status updated to verified
        updated_inv = db.get_document("whatsapp_invitations", inv["id"])
        assert updated_inv["status"] == "verified"

        # Verify target user now exists and is active in users collection
        user = WhatsAppBotService._resolve_sender(TARGET_NEW_PHONE, ORG_ID)
        assert user is not None
        assert user["role"] == ROLE_WAREHOUSE_MANAGER
        assert user["is_active"] is True

        # Target can now run authorized commands
        status_res = WhatsAppBotService.process_incoming_message(
            from_number=TARGET_NEW_PHONE,
            message_text="STATUS",
            org_id=ORG_ID
        )
        assert "System Status" in status_res["reply_text"]

    def test_invalid_verification_code_increments_attempts(self):
        """Entering incorrect code increments attempts counter and shows remaining attempts."""
        WhatsAppBotService.process_incoming_message(
            from_number=ORG_ADMIN_PHONE,
            message_text=f"USER ADD {TARGET_NEW_PHONE} operator",
            org_id=ORG_ID
        )
        res = WhatsAppBotService.process_incoming_message(
            from_number=TARGET_NEW_PHONE,
            message_text="CONFIRM 000000",
            org_id=ORG_ID
        )
        assert "Invalid verification code" in res["reply_text"]
        assert "attempt(s) remaining" in res["reply_text"]

        inv = db.query("whatsapp_invitations", filters={"phone_number": TARGET_NEW_PHONE})[0]
        assert inv["attempts"] == 1

    def test_exceeding_max_attempts_revokes_invitation(self):
        """Failing verification 5 times revokes the invitation."""
        WhatsAppBotService.process_incoming_message(
            from_number=ORG_ADMIN_PHONE,
            message_text=f"USER ADD {TARGET_NEW_PHONE} operator",
            org_id=ORG_ID
        )
        # Submit 5 wrong attempts
        for _ in range(5):
            res = WhatsAppBotService.process_incoming_message(
                from_number=TARGET_NEW_PHONE,
                message_text="CONFIRM 999999",
                org_id=ORG_ID
            )
        assert "revoked" in res["reply_text"].lower()

        inv = db.query("whatsapp_invitations", filters={"phone_number": TARGET_NEW_PHONE})[0]
        assert inv["status"] == "revoked"

    def test_reused_challenge_code_is_rejected(self):
        """Single-use challenge code cannot be used a second time."""
        WhatsAppBotService.process_incoming_message(
            from_number=ORG_ADMIN_PHONE,
            message_text=f"USER ADD {TARGET_NEW_PHONE} operator",
            org_id=ORG_ID
        )
        inv = db.query("whatsapp_invitations", filters={"phone_number": TARGET_NEW_PHONE})[0]
        code = inv["challenge_code"]

        # First verification succeeds
        res1 = WhatsAppBotService.process_incoming_message(
            from_number=TARGET_NEW_PHONE,
            message_text=f"CONFIRM {code}",
            org_id=ORG_ID
        )
        assert "Welcome to StockPilot AI" in res1["reply_text"]

        # Second verification with same code is rejected (invitation is no longer pending)
        res2 = WhatsAppBotService.process_incoming_message(
            from_number=TARGET_NEW_PHONE,
            message_text=f"CONFIRM {code}",
            org_id=ORG_ID
        )
        assert "No active registration invitation found" in res2["reply_text"]


# =============================================================================
# 3. ROLE HIERARCHY & AUTHORIZATION SAFEGUARDS
# =============================================================================

class TestRoleHierarchyAndSafeguards:

    def test_org_admin_cannot_assign_super_admin(self):
        """Org Admin cannot assign the Super Admin role."""
        res = WhatsAppBotService.process_incoming_message(
            from_number=ORG_ADMIN_PHONE,
            message_text=f"USER ADD {TARGET_NEW_PHONE} super_admin",
            org_id=ORG_ID
        )
        assert "Authorization Error" in res["reply_text"]
        assert "Only a Super Administrator can provision or assign the Super Admin role" in res["reply_text"]

    def test_super_admin_can_assign_super_admin(self):
        """Super Admin can assign any role including Super Admin."""
        res = WhatsAppBotService.process_incoming_message(
            from_number=SUPER_ADMIN_PHONE,
            message_text=f"USER ADD {TARGET_NEW_PHONE} super_admin",
            org_id=ORG_ID
        )
        assert "Invitation Created" in res["reply_text"]
        assert "Super Administrator" in res["reply_text"]

    def test_unregistered_sender_cannot_assign_roles(self):
        """Unregistered mobile number cannot execute USER commands."""
        res = WhatsAppBotService.process_incoming_message(
            from_number=UNREGISTERED_PHONE,
            message_text=f"USER ADD {TARGET_NEW_PHONE} operator",
            org_id=ORG_ID
        )
        assert "Security Notice" in res["reply_text"]
        assert "not registered" in res["reply_text"]

    def test_operator_cannot_manage_users_or_assign_roles(self):
        """Warehouse Operator cannot create invitations or assign roles."""
        res = WhatsAppBotService.process_incoming_message(
            from_number=OPERATOR_PHONE,
            message_text=f"USER ADD {TARGET_NEW_PHONE} operator",
            org_id=ORG_ID
        )
        assert "Unauthorized" in res["reply_text"]
        assert "does not have permission" in res["reply_text"]

    def test_operator_cannot_elevate_own_role(self):
        """Operator cannot change their own role to org_admin."""
        res = WhatsAppBotService.process_incoming_message(
            from_number=OPERATOR_PHONE,
            message_text=f"USER ROLE {OPERATOR_PHONE} org_admin",
            org_id=ORG_ID
        )
        assert "Unauthorized" in res["reply_text"]

    def test_invalid_phone_number_rejected(self):
        """Bad phone format returns clear error and syntax examples."""
        res = WhatsAppBotService.process_incoming_message(
            from_number=ORG_ADMIN_PHONE,
            message_text="USER ADD 12345 operator",
            org_id=ORG_ID
        )
        assert "Invalid mobile number format" in res["reply_text"]
        assert "Example:" in res["reply_text"]

    def test_role_reassignment_updates_user(self):
        """USER ROLE updates an existing user's role and logs audit entry."""
        res = WhatsAppBotService.process_incoming_message(
            from_number=ORG_ADMIN_PHONE,
            message_text=f"USER ROLE {OPERATOR_PHONE} supply_chain_manager",
            org_id=ORG_ID
        )
        assert "Role Reassigned" in res["reply_text"]
        assert "Supply Chain Manager" in res["reply_text"]

        updated_op = WhatsAppBotService._resolve_sender(OPERATOR_PHONE, ORG_ID)
        assert updated_op["role"] == ROLE_SUPPLY_CHAIN_MANAGER

        # Verify audit log
        audit = db.query("audit_logs", filters={"action": "USER_ROLE_REASSIGNED"})[-1]
        assert audit["details"]["new_role"] == ROLE_SUPPLY_CHAIN_MANAGER

    def test_cannot_demote_final_org_admin(self):
        """Safeguard: Demoting the last active Org Admin in the organization is blocked."""
        # Deactivate all other org admins in org so only Marcus Vance is active org admin
        for u in db.query("users", org_id=ORG_ID):
            if u.get("role") == ROLE_ORG_ADMIN and u.get("phone_number") != ORG_ADMIN_PHONE:
                db.set_document("users", u["id"], {"is_active": False})

        res = WhatsAppBotService.process_incoming_message(
            from_number=SUPER_ADMIN_PHONE,
            message_text=f"USER ROLE {ORG_ADMIN_PHONE} operator",
            org_id=ORG_ID
        )
        assert "Safeguard Violation" in res["reply_text"]
        assert "Cannot demote the final active Organization Administrator" in res["reply_text"]


# =============================================================================
# 4. LOCATION SCOPING (WAREHOUSE SCOPES)
# =============================================================================

class TestLocationScopingCommands:

    def test_assign_and_remove_warehouse_scope(self):
        """USER WAREHOUSE assigns authorized warehouse; USER REMOVE-WAREHOUSE removes it."""
        # Assign warehouse
        res_assign = WhatsAppBotService.process_incoming_message(
            from_number=ORG_ADMIN_PHONE,
            message_text=f"USER WAREHOUSE {OPERATOR_PHONE} wh_chicago_01",
            org_id=ORG_ID
        )
        assert "Warehouse Assigned" in res_assign["reply_text"]
        assert "wh_chicago_01" in res_assign["reply_text"]

        op = WhatsAppBotService._resolve_sender(OPERATOR_PHONE, ORG_ID)
        assert "wh_chicago_01" in (op.get("warehouse_ids") or [])

        # Remove warehouse
        res_remove = WhatsAppBotService.process_incoming_message(
            from_number=ORG_ADMIN_PHONE,
            message_text=f"USER REMOVE-WAREHOUSE {OPERATOR_PHONE} wh_chicago_01",
            org_id=ORG_ID
        )
        assert "Warehouse Scope Removed" in res_remove["reply_text"]

        op_after = WhatsAppBotService._resolve_sender(OPERATOR_PHONE, ORG_ID)
        assert "wh_chicago_01" not in (op_after.get("warehouse_ids") or [])

    def test_assign_nonexistent_warehouse_fails(self):
        """Attempting to assign a warehouse that does not exist returns error."""
        res = WhatsAppBotService.process_incoming_message(
            from_number=ORG_ADMIN_PHONE,
            message_text=f"USER WAREHOUSE {OPERATOR_PHONE} wh_nonexistent_99",
            org_id=ORG_ID
        )
        assert "Warehouse 'wh_nonexistent_99' not found" in res["reply_text"]


# =============================================================================
# 5. USER DISABLE & ENABLE WORKFLOW
# =============================================================================

class TestUserDisableEnable:

    def test_user_disable_blocks_subsequent_commands(self):
        """USER DISABLE deactivates user; deactivated user cannot send commands."""
        # Admin disables operator
        res_disable = WhatsAppBotService.process_incoming_message(
            from_number=ORG_ADMIN_PHONE,
            message_text=f"USER DISABLE {OPERATOR_PHONE}",
            org_id=ORG_ID
        )
        assert "DISABLED" in res_disable["reply_text"]

        # Operator tries to send STATUS
        res_op = WhatsAppBotService.process_incoming_message(
            from_number=OPERATOR_PHONE,
            message_text="STATUS",
            org_id=ORG_ID
        )
        assert "deactivated" in res_op["reply_text"]

        # Admin re-enables operator
        res_enable = WhatsAppBotService.process_incoming_message(
            from_number=ORG_ADMIN_PHONE,
            message_text=f"USER ENABLE {OPERATOR_PHONE}",
            org_id=ORG_ID
        )
        assert "RE-ENABLED" in res_enable["reply_text"]

        # Operator can now operate again
        res_op_after = WhatsAppBotService.process_incoming_message(
            from_number=OPERATOR_PHONE,
            message_text="STATUS",
            org_id=ORG_ID
        )
        assert "System Status" in res_op_after["reply_text"]

    def test_admin_cannot_disable_self(self):
        """Self-deactivation is blocked."""
        res = WhatsAppBotService.process_incoming_message(
            from_number=ORG_ADMIN_PHONE,
            message_text=f"USER DISABLE {ORG_ADMIN_PHONE}",
            org_id=ORG_ID
        )
        assert "Cannot deactivate your own active session" in res["reply_text"]


# =============================================================================
# 6. READ-ONLY COMMANDS (WHOAMI, MYROLE, HELP, USER SHOW, USER LIST)
# =============================================================================

class TestReadOnlyCommands:

    def test_whoami_returns_sender_profile(self):
        """WHOAMI returns sender identity, role, scope, and status."""
        res = WhatsAppBotService.process_incoming_message(
            from_number=ORG_ADMIN_PHONE,
            message_text="WHOAMI",
            org_id=ORG_ID
        )
        assert "Profile Verification" in res["reply_text"]
        assert "Marcus Vance" in res["reply_text"]
        assert "Organization Administrator" in res["reply_text"]
        assert "Active" in res["reply_text"]

    def test_myrole_returns_assigned_role(self):
        """MYROLE returns sender's current assigned role."""
        res = WhatsAppBotService.process_incoming_message(
            from_number=OPERATOR_PHONE,
            message_text="MYROLE",
            org_id=ORG_ID
        )
        assert "Warehouse Operator" in res["reply_text"]

    def test_help_shows_admin_commands_only_for_admin(self):
        """Admin sees USER ADD / USER ROLE in HELP; Operator does not."""
        res_admin = WhatsAppBotService.process_incoming_message(
            from_number=ORG_ADMIN_PHONE,
            message_text="HELP",
            org_id=ORG_ID
        )
        assert "USER ADD" in res_admin["reply_text"]
        assert "USER ROLE" in res_admin["reply_text"]

        res_op = WhatsAppBotService.process_incoming_message(
            from_number=OPERATOR_PHONE,
            message_text="HELP",
            org_id=ORG_ID
        )
        assert "USER ADD" not in res_op["reply_text"]
        assert "USER ROLE" not in res_op["reply_text"]

    def test_user_show_displays_profile(self):
        """USER SHOW displays target user details."""
        res = WhatsAppBotService.process_incoming_message(
            from_number=ORG_ADMIN_PHONE,
            message_text=f"USER SHOW {OPERATOR_PHONE}",
            org_id=ORG_ID
        )
        assert "StockPilot User Profile" in res["reply_text"]
        assert "James O'Connor" in res["reply_text"]
        assert "Warehouse Operator" in res["reply_text"]

    def test_user_list_returns_organization_members(self):
        """USER LIST returns users within the administrator's organization."""
        res = WhatsAppBotService.process_incoming_message(
            from_number=ORG_ADMIN_PHONE,
            message_text="USER LIST",
            org_id=ORG_ID
        )
        assert "StockPilot Users" in res["reply_text"]
        assert "Marcus Vance" in res["reply_text"]


# =============================================================================
# 7. WEBHOOK IDEMPOTENCY & REST ENDPOINTS
# =============================================================================

class TestWebhookIdempotencyAndApi:

    def test_webhook_deduplication(self):
        """Duplicate webhook message ID is deduplicated and not processed twice."""
        import uuid
        msg_id = f"wamid.HBgLTEST_{uuid.uuid4().hex}="
        payload = {
            "object": "whatsapp_business_account",
            "entry": [{
                "id": "10001",
                "changes": [{
                    "value": {
                        "messaging_product": "whatsapp",
                        "metadata": {"display_phone_number": "15550200", "phone_number_id": "10987"},
                        "messages": [{
                            "from": ORG_ADMIN_PHONE,
                            "id": msg_id,
                            "timestamp": "1730000000",
                            "type": "text",
                            "text": {"body": "STATUS"}
                        }]
                    },
                    "field": "messages"
                }]
            }]
        }

        # First request processes
        res1 = WhatsAppBotService.handle_webhook_payload(payload)
        assert res1.get("action_taken") == "STATUS_QUERY"

        # Second request with identical message ID is ignored
        res2 = WhatsAppBotService.handle_webhook_payload(payload)
        assert res2.get("status") == "duplicate_ignored"

    def test_admin_bind_phone_rest_endpoint(self):
        """Authenticated admin can bind their phone number via REST endpoint."""
        token = create_access_token(
            subject="usr_orgadmin",
            extra_claims={"role": ROLE_ORG_ADMIN, "org_id": ORG_ID, "email": "orgadmin@stockpilot.ai"}
        )
        headers = {"Authorization": f"Bearer {token}"}
        resp = client.post(
            "/api/v1/whatsapp/admin/bind-phone",
            json={"phone_number": "+919876543999"},
            headers=headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["phone_number"] == "+919876543999"

        # Verify user record updated
        u = db.get_document("users", "usr_orgadmin")
        assert u["phone_number"] == "+919876543999"
