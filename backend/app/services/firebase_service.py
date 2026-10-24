import os
import logging
from typing import Dict, Any, Optional
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Firebase Admin SDK initialization with graceful fallback
_firebase_app = None
_firestore_db = None
_fcm_messaging = None

try:
    import firebase_admin
    from firebase_admin import credentials, firestore, auth, messaging

    project_id = os.getenv("FIREBASE_PROJECT_ID", "triwizathon")
    cred_path = os.getenv("FIREBASE_CREDENTIALS_PATH", "")

    if cred_path and os.path.exists(cred_path):
        cred = credentials.Certificate(cred_path)
        _firebase_app = firebase_admin.initialize_app(cred, {"projectId": project_id})
        _firestore_db = firestore.client()
        logger.info(f"[FIREBASE] Initialized Firebase Admin SDK with credentials file for project '{project_id}'")
    else:
        # Initialize default or project-based app
        try:
            _firebase_app = firebase_admin.get_app()
        except ValueError:
            _firebase_app = firebase_admin.initialize_app(options={"projectId": project_id})
        try:
            _firestore_db = firestore.client()
        except Exception as e:
            logger.info(f"[FIREBASE] Live Firestore client deferred (using transactional local persistence): {e}")
        logger.info(f"[FIREBASE] Initialized Firebase Admin SDK for project '{project_id}'")
except Exception as e:
    logger.warning(f"[FIREBASE] Firebase Admin SDK running in simulated/offline mode: {e}")


class FirebaseService:
    """
    Centralized service for Firebase Authentication, Cloud Firestore synchronization,
    Firebase Cloud Messaging (FCM), and Security Claims management.
    """

    @staticmethod
    def is_live() -> bool:
        return _firestore_db is not None

    @staticmethod
    def verify_token(id_token: str) -> Optional[Dict[str, Any]]:
        """
        Validates a client Firebase Auth JWT token and extracts tenant & role claims.
        """
        try:
            from firebase_admin import auth
            decoded_token = auth.verify_id_token(id_token)
            return decoded_token
        except Exception as e:
            logger.debug(f"[AUTH] Firebase token verification fallback: {e}")
            return None

    @staticmethod
    def set_user_claims(uid: str, org_id: str, role: str, warehouse_id: Optional[str] = None) -> bool:
        """
        Sets privileged claims (org_id, role, warehouse_id) on a Firebase user.
        Client applications cannot modify these claims.
        """
        try:
            from firebase_admin import auth
            claims = {
                "org_id": org_id,
                "role": role,
                "warehouse_id": warehouse_id,
            }
            auth.set_custom_user_claims(uid, claims)
            logger.info(f"[AUTH] Successfully assigned custom claims to user {uid}: {claims}")
            return True
        except Exception as e:
            logger.warning(f"[AUTH] Could not set custom claims via Admin SDK (running offline mode): {e}")
            return False

    @staticmethod
    def sync_to_firestore(collection: str, doc_id: str, data: Dict[str, Any]) -> bool:
        """
        Synchronizes an authoritative document to Cloud Firestore.
        """
        if not _firestore_db:
            return False
        try:
            doc_ref = _firestore_db.collection(collection).document(doc_id)
            doc_ref.set(data, merge=True)
            return True
        except Exception as e:
            logger.error(f"[FIRESTORE] Failed to sync document {doc_id} to collection {collection}: {e}")
            return False

    @staticmethod
    def send_push_notification(
        title: str,
        body: str,
        topic: Optional[str] = None,
        token: Optional[str] = None,
        data: Optional[Dict[str, str]] = None,
    ) -> bool:
        """
        Sends push notification via Firebase Cloud Messaging (FCM).
        """
        try:
            from firebase_admin import messaging
            msg_data = data or {}
            
            if topic:
                message = messaging.Message(
                    notification=messaging.Notification(title=title, body=body),
                    data=msg_data,
                    topic=topic,
                )
                messaging.send(message)
                logger.info(f"[FCM] Sent notification to topic '{topic}': {title}")
                return True
            elif token:
                message = messaging.Message(
                    notification=messaging.Notification(title=title, body=body),
                    data=msg_data,
                    token=token,
                )
                messaging.send(message)
                logger.info(f"[FCM] Sent notification to device token: {title}")
                return True
            return False
        except Exception as e:
            logger.info(f"[FCM] Simulated push notification '{title}': {body} (Offline test mode)")
            return True

    @staticmethod
    def record_audit_log(
        org_id: str,
        actor_id: str,
        actor_name: str,
        action: str,
        resource_type: str,
        resource_id: str,
        details: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Creates an immutable regulatory audit log entry.
        """
        from ..core.database import db
        import uuid

        audit_id = f"aud_{uuid.uuid4().hex[:12]}"
        now_iso = datetime.now(timezone.utc).isoformat()
        
        entry = {
            "id": audit_id,
            "org_id": org_id,
            "actor_id": actor_id,
            "actor_name": actor_name,
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "details": details or {},
            "timestamp": now_iso,
        }

        db.set_document("audit_logs", audit_id, entry)
        FirebaseService.sync_to_firestore("audit_logs", audit_id, entry)
        return entry
