from typing import Dict, Any, Optional, List
from fastapi import APIRouter, Request, Query, Header, HTTPException, Depends
from pydantic import BaseModel
from app.core.database import db
from app.api.deps import get_current_user
from app.services.whatsapp_service import WhatsAppBotService

router = APIRouter(prefix="/whatsapp", tags=["WhatsApp Cloud API Integration"])

@router.get("/webhook")
def meta_webhook_verification(
    hub_mode: Optional[str] = Query(None, alias="hub.mode"),
    hub_challenge: Optional[str] = Query(None, alias="hub.challenge"),
    hub_verify_token: Optional[str] = Query(None, alias="hub.verify_token"),
):
    """
    Standard Meta WhatsApp Cloud API webhook registration handshake.
    """
    return WhatsAppBotService.verify_webhook_token(
        mode=hub_mode,
        token=hub_verify_token,
        challenge=hub_challenge
    )

@router.post("/webhook")
async def meta_incoming_webhook(
    request: Request,
    x_hub_signature_256: Optional[str] = Header(None, alias="X-Hub-Signature-256")
):
    """
    Processes incoming messages from Meta WhatsApp Business Cloud API.
    Validates HMAC signature and routes deterministic supply chain commands.
    """
    raw_body = await request.body()
    if not WhatsAppBotService.verify_meta_signature(raw_body, x_hub_signature_256):
        raise HTTPException(status_code=403, detail="Invalid WhatsApp payload signature.")

    try:
        data = await request.json()
        entry = data.get("entry", [])[0]
        changes = entry.get("changes", [])[0]
        value = changes.get("value", {})
        messages = value.get("messages", [])

        if not messages:
            return {"status": "ignored_no_message"}

        msg = messages[0]
        from_num = msg.get("from", "")
        text_body = msg.get("text", {}).get("body", "")

        res = WhatsAppBotService.process_incoming_message(
            from_number=from_num,
            message_text=text_body,
            org_id="org_triwiz_01"
        )
        return res
    except Exception as e:
        return {"status": "error", "detail": str(e)}

class SimulatorChatRequest(BaseModel):
    message_text: str
    from_number: Optional[str] = "+13125550103"

@router.post("/simulator/chat")
def simulate_whatsapp_chat(
    req: SimulatorChatRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Interactive WhatsApp Simulator for testing stock lookups, alerts,
    and transfer approvals directly from the UI without Meta cloud credentials.
    """
    res = WhatsAppBotService.process_incoming_message(
        from_number=req.from_number or current_user.get("phone_number") or "+13125550103",
        message_text=req.message_text,
        org_id=current_user["org_id"]
    )
    return res

@router.get("/logs", response_model=List[Dict[str, Any]])
def list_whatsapp_logs(current_user: dict = Depends(get_current_user)):
    org_id = current_user["org_id"]
    logs = db.query("notification_logs", org_id=org_id, order_by="timestamp", descending=True, limit=50)
    return logs
