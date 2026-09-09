"""
MÃ³dulo de seguridad para autenticaciÃ³n, hashing, JWT y TOTP.
"""
import secrets
import io
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
import pyotp
import qrcode

# Config
SECRET_KEY = secrets.token_urlsafe(32)
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Hashear contraseÃ±a con bcrypt."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verificar contraseÃ±a contra hash."""
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Crear JWT token."""
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> Optional[dict]:
    """Verificar JWT token."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


def generate_totp_secret(email: str) -> tuple:
    """
    Generar secreto TOTP y QR code para Google Authenticator.
    
    Returns:
        (secret, provisioning_uri, qr_base64)
    """
    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret)
    provisioning_uri = totp.provisioning_uri(name=email, issuer_name="Onion Search Admin")
    
    # Generar QR code
    qr = qrcode.make(provisioning_uri)
    buffer = io.BytesIO()
    qr.save(buffer, format="PNG")
    qr_base64 = buffer.getvalue().hex()
    
    return secret, provisioning_uri, qr_base64


def verify_totp(secret: str, code: str) -> bool:
    """Verificar cÃ³digo TOTP."""
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)


def create_temp_session_token() -> str:
    """Crear token temporal para sesiÃ³n de 2FA (5 min)."""
    return secrets.token_urlsafe(32)
