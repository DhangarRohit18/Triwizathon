from datetime import datetime, timedelta, timezone
from typing import Optional, Any, Union
import jwt
from passlib.context import CryptContext
from fastapi import HTTPException, status, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security_bearer = HTTPBearer(auto_error=False)

# 6 Enterprise Roles
ROLE_SUPER_ADMIN = "super_admin"
ROLE_ORG_ADMIN = "org_admin"
ROLE_SUPPLY_CHAIN_MANAGER = "supply_chain_manager"
ROLE_WAREHOUSE_MANAGER = "warehouse_manager"
ROLE_DISTRIBUTOR = "distributor"
ROLE_OPERATOR = "operator"

ALL_ROLES = [
    ROLE_SUPER_ADMIN,
    ROLE_ORG_ADMIN,
    ROLE_SUPPLY_CHAIN_MANAGER,
    ROLE_WAREHOUSE_MANAGER,
    ROLE_DISTRIBUTOR,
    ROLE_OPERATOR,
]

ROLE_HIERARCHY = {
    ROLE_SUPER_ADMIN: 100,
    ROLE_ORG_ADMIN: 80,
    ROLE_SUPPLY_CHAIN_MANAGER: 60,
    ROLE_WAREHOUSE_MANAGER: 50,
    ROLE_DISTRIBUTOR: 30,
    ROLE_OPERATOR: 20,
}

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        # Fallback for plain demo/seed comparison if bcrypt is incompatible
        return plain_password == hashed_password

def get_password_hash(password: str) -> str:
    try:
        return pwd_context.hash(password)
    except Exception:
        return password

def create_access_token(subject: Union[str, Any], expires_delta: Optional[timedelta] = None, extra_claims: Optional[dict] = None) -> str:
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode = {"exp": expire, "sub": str(subject)}
    if extra_claims:
        to_encode.update(extra_claims)
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt

def decode_access_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except (jwt.InvalidTokenError, Exception):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
