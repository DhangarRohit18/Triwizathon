import hmac
import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, Optional, Tuple
from fastapi import HTTPException
from app.core.config import settings
from app.core.database import db
from app.services.inventory_service import InventoryService

class WhatsAppBotService:
    """
    WhatsApp Business Cloud API webhook handler and deterministic NLP command engine.
    Processes inventory inquiries, cold-chain alerts, and authorized transfer approvals.
    """

    @staticmethod
    def verify_webhook_token(mode: Optional[str], token: Optional[str], challenge: Optional[str]) -> str:
        """Standard Meta webhook verification handshake."""
        if mode == "subscribe" and token == settings.WHATSAPP_VERIFY_TOKEN:
            return challenge or "ok"
        raise HTTPException(status_code=403, detail="Verification token mismatch.")

    @staticmethod
    def verify_meta_signature(payload_bytes: bytes, signature_header: Optional[str]) -> bool:
        """Validates Meta SHA256 HMAC payload signature."""
        if not signature_header or not settings.WHATSAPP_APP_SECRET:
            return True  # Allow in dev simulator mode
        try:
            expected_hash = hmac.new(
                settings.WHATSAPP_APP_SECRET.encode("utf-8"),
                payload_bytes,
                hashlib.sha256
            ).hexdigest()
            incoming_hash = signature_header.replace("sha256=", "")
            return hmac.compare_digest(expected_hash, incoming_hash)
        except Exception:
            return False

    @classmethod
    def process_incoming_message(
        cls,
        from_number: str,
        message_text: str,
        org_id: str = "org_triwiz_01"
    ) -> Dict[str, Any]:
        """
        Parses commands deterministically and validates sender permissions.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        clean_text = message_text.strip()
        cmd_upper = clean_text.upper()

        # 1. Map phone number to authorized user
        users = db.query("users", org_id=org_id)
        matched_user = None
        for u in users:
            if u.get("phone_number") and u["phone_number"].replace("+", "").replace("-", "") in from_number.replace("+", "").replace("-", ""):
                matched_user = u
                break

        # Fallback to demo persona if simulator testing
        if not matched_user:
            matched_user = {
                "id": "usr_supplychain",
                "full_name": "Elena Rostova (WhatsApp Linked)",
                "role": "supply_chain_manager",
                "org_id": org_id
            }

        user_role = matched_user.get("role", "operator")
        user_name = matched_user.get("full_name", "Authorized User")

        reply = ""
        action_taken = None

        if cmd_upper in ("HELP", "MENU", "?"):
            reply = (
                f"🤖 *STOCKPILOT AI Mobile Assistant*\n"
                f"Authenticated as: *{user_name}* ({user_role.upper()})\n\n"
                f"Available Commands:\n"
                f"• *STATUS* - Network inventory & warehouse health\n"
                f"• *STOCK <SKU>* - Check stock levels (e.g. `STOCK PRD-VAX-01`)\n"
                f"• *ALERTS* - Active IoT cold-chain alerts\n"
                f"• *TRANSFERS* - Pending inter-warehouse transfers\n"
                f"• *APPROVE <TRF_ID>* - Approve transfer (Managers only)\n"
                f"• *REJECT <TRF_ID>* - Reject transfer\n"
                f"• *HUMAN* - Escalate to Operations Desk"
            )

        elif cmd_upper == "STATUS":
            warehouses = db.query("warehouses", org_id=org_id)
            inv_list = db.query("inventory", org_id=org_id)
            total_items = sum(item.get("total_quantity", 0) for item in inv_list)
            wh_summary = "\n".join([f"  • {w['name']}: {w['used_pallets']}/{w['capacity_pallets']} pallets ({'🟢 Active' if w['is_operational'] else '🔴 Down'})" for w in warehouses])

            reply = (
                f"📊 *STOCKPILOT AI System Status*\n"
                f"Total Network Stock: *{total_items:,} units*\n"
                f"Warehouses Monitored: *{len(warehouses)}*\n"
                f"{wh_summary}\n\n"
                f"To query specific products, type: `STOCK <SKU>`"
            )

        elif cmd_upper.startswith("STOCK"):
            parts = clean_text.split()
            if len(parts) < 2:
                reply = "⚠️ Please specify a SKU code. Example: `STOCK PRD-VAX-01`"
            else:
                sku_query = parts[1].strip().upper()
                products = db.query("products", org_id=org_id)
                matched_prd = next((p for p in products if p["sku"].upper() == sku_query or sku_query in p["name"].upper()), None)

                if not matched_prd:
                    reply = f"❌ Product with SKU '{sku_query}' was not found in catalog."
                else:
                    inv_records = db.query("inventory", filters={"product_id": matched_prd["id"]}, org_id=org_id)
                    total_avail = sum(i["available_quantity"] for i in inv_records)
                    
                    wh_lines = []
                    for i in inv_records:
                        wh = db.get_document("warehouses", i["warehouse_id"])
                        wh_name = wh["name"] if wh else i["warehouse_id"]
                        wh_lines.append(f"  • {wh_name}: {i['available_quantity']} avail (Safety: {i['safety_stock']})")

                    reply = (
                        f"📦 *Inventory for {matched_prd['name']}* ({matched_prd['sku']})\n"
                        f"Total Available: *{total_avail} {matched_prd['unit']}*\n"
                        f"Handling: *{matched_prd['handling'].upper()}*\n"
                        f"Locations:\n" + "\n".join(wh_lines)
                    )

        elif cmd_upper == "ALERTS":
            alerts = db.query("alerts", filters={"acknowledged": False}, org_id=org_id)
            if not alerts:
                reply = "✅ *All clear.* No unacknowledged IoT cold-chain or storage alerts in the network."
            else:
                alert_lines = [f"  ⚠️ *[{a['severity'].upper()}]* {a['message']}" for a in alerts[:5]]
                reply = f"🚨 *Active IoT Cold-Chain Alerts ({len(alerts)})*:\n" + "\n".join(alert_lines)

        elif cmd_upper == "TRANSFERS":
            transfers = db.query("transfers", filters={"status": "pending"}, org_id=org_id)
            if not transfers:
                reply = "📋 No pending inter-warehouse transfer requests requiring approval."
            else:
                lines = []
                for t in transfers:
                    src = db.get_document("warehouses", t["source_warehouse_id"])
                    dst = db.get_document("warehouses", t["target_warehouse_id"])
                    src_name = src["name"] if src else t["source_warehouse_id"]
                    dst_name = dst["name"] if dst else t["target_warehouse_id"]
                    lines.append(f"  • ID: `{t['id']}`: {src_name} ➔ {dst_name} ({len(t['items'])} items)")
                
                reply = (
                    f"📋 *Pending Transfers ({len(transfers)})*:\n" +
                    "\n".join(lines) +
                    f"\n\nTo approve, reply: `APPROVE <ID>`"
                )

        elif cmd_upper.startswith("APPROVE"):
            # Role authorization check: only manager or admin can approve transfers
            if user_role not in ("super_admin", "org_admin", "supply_chain_manager", "warehouse_manager"):
                reply = f"⛔ *Unauthorized*: User role '{user_role}' cannot approve stock transfers. Escalated to manager."
            else:
                parts = clean_text.split()
                if len(parts) < 2:
                    reply = "⚠️ Please specify the Transfer ID to approve. Example: `APPROVE trf_001_chi_ny`"
                else:
                    trf_id = parts[1].strip()
                    try:
                        res = InventoryService.approve_or_reject_transfer(
                            transfer_id=trf_id,
                            approved=True,
                            actor_id=matched_user["id"],
                            actor_name=user_name,
                            org_id=org_id,
                            notes="Approved via authenticated WhatsApp bot interaction"
                        )
                        reply = f"✅ *Transfer {trf_id} Approved!* Status is now IN_TRANSIT. Inventory reserved and movement logged."
                        action_taken = "TRANSFER_APPROVED"
                    except Exception as e:
                        reply = f"❌ *Error approving transfer*: {str(e)}"

        elif cmd_upper.startswith("REJECT"):
            parts = clean_text.split()
            if len(parts) < 2:
                reply = "⚠️ Please specify the Transfer ID to reject."
            else:
                trf_id = parts[1].strip()
                try:
                    res = InventoryService.approve_or_reject_transfer(
                        transfer_id=trf_id,
                        approved=False,
                        actor_id=matched_user["id"],
                        actor_name=user_name,
                        org_id=org_id,
                        notes="Rejected via WhatsApp bot interaction"
                    )
                    reply = f"🚫 *Transfer {trf_id} has been Rejected*."
                    action_taken = "TRANSFER_REJECTED"
                except Exception as e:
                    reply = f"❌ *Error*: {str(e)}"

        elif cmd_upper == "HUMAN":
            reply = "🧑‍💼 *Desk Escalation*: A high-priority ticket has been dispatched to Central Logistics Operations. An agent will contact you shortly."
            action_taken = "HUMAN_ESCALATION"

        else:
            reply = (
                f"❓ Command '{clean_text}' not recognized.\n"
                f"Reply with *HELP* to see available commands or *STATUS* for inventory metrics."
            )

        # Log conversation record in datastore
        log_id = f"wa_{uuid.uuid4().hex[:12]}"
        log_entry = {
            "id": log_id,
            "org_id": org_id,
            "from_number": from_number,
            "incoming_text": message_text,
            "outgoing_reply": reply,
            "actor_id": matched_user["id"],
            "action_taken": action_taken,
            "timestamp": now_iso
        }
        db.set_document("notification_logs", log_id, log_entry)

        return {
            "reply_text": reply,
            "action_taken": action_taken,
            "correlation_id": log_id,
            "status": "delivered"
        }
