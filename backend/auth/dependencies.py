"""
Dependencias de autenticaciÃ³n para FastAPI.
"""
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt
from typing import Optional

from db.database import get_db
from backend.models.admin_user import AdminUser
from backend.auth.security import verify_token, SECRET_KEY, ALGORITHM

security = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> AdminUser:
    """
    Obtener usuario actual desde JWT token o cookie.
    """
    # Intentar obtener token de cookie primero
    token = request.cookies.get('admin_token')
    
    # Si no hay cookie, intentar header Authorization
    if not token and credentials:
        token = credentials.credentials
    
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Verificar token
    payload = verify_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    email = payload.get("sub")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )
    
    # Buscar usuario en DB
    with get_db() as db:
        user = db.query(AdminUser).filter(AdminUser.email == email).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
            )
    
    return user


async def verify_admin(request: Request, user: AdminUser = Depends(get_current_user)) -> bool:
    """
    Verificar que el usuario es admin (placeholder para roles).
    """
    # Por ahora, todos los AdminUser son admins
    # En el futuro podrias agregar campo 'role' al modelo
    return True
