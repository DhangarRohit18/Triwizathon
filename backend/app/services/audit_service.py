import uuid
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from app.core.database import db

class AuditService:
    @staticmethod
    def log_event(
        org_id: str,
        actor_id: str,
        actor_name: str,
        actor_role: str,
        action: str,
        target_entity: str,
        entity_id: str,
        details: Dict[str, Any],
        ip_address: Optional[str] = "127.0.0.1"
    ) -> Dict[str, Any]:
        log_id = f"aud_{uuid.uuid4().hex[:12]}"
        now_iso = datetime.now(timezone.utc).isoformat()
        entry = {
            "id": log_id,
            "org_id": org_id,
            "actor_id": actor_id,
            "actor_name": actor_name,
            "actor_role": actor_role,
            "action": action,
            "target_entity": target_entity,
            "entity_id": entity_id,
            "details": details,
            "ip_address": ip_address,
            "timestamp": now_iso
        }
        db.set_document("audit_logs", log_id, entry)
        return entry
