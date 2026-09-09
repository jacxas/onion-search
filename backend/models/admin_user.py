"""
Modelo de usuario administrador con soporte para 2FA.
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime
from datetime import datetime
from db.database import Base


class AdminUser(Base):
    """
    Usuario administrador con autenticaciÃ³n segura.
    """
    __tablename__ = 'admin_users'
    
    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    
    # 2FA (TOTP)
    totp_secret = Column(String(32), nullable=True)
    totp_enabled = Column(Boolean, default=False)
    
    # Security tracking
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime, nullable=True)
    login_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime, nullable=True)
    
    # Password reset
    password_reset_token = Column(String(255), nullable=True)
    password_reset_expires = Column(DateTime, nullable=True)
    
    # Session temporal para 2FA
    temp_session_token = Column(String(255), nullable=True)
    temp_session_expires = Column(DateTime, nullable=True)
    
    def __repr__(self):
        return f"<AdminUser(email='{self.email}', 2FA={self.totp_enabled})>"
    
    def is_locked(self) -> bool:
        """Verificar si la cuenta estÃ¡ bloqueada temporalmente."""
        if self.locked_until is None:
            return False
        return datetime.utcnow() < self.locked_until
    
    def reset_lockout(self):
        """Resetear intentos de login y desbloquear."""
        self.login_attempts = 0
        self.locked_until = None
    
    def increment_login_attempts(self, max_attempts: int = 5, lockout_minutes: int = 15):
        """Incrementar intentos fallidos y bloquear si supera el mÃ¡ximo."""
        self.login_attempts += 1
        if self.login_attempts >= max_attempts:
            from datetime import timedelta
            self.locked_until = datetime.utcnow() + timedelta(minutes=lockout_minutes)
    
    def create_password_reset_token(self) -> str:
        """Generar token para reset de contraseÃ±a."""
        import secrets
        from datetime import timedelta
        
        token = secrets.token_urlsafe(32)
        self.password_reset_token = token
        self.password_reset_expires = datetime.utcnow() + timedelta(hours=1)
        return token
    
    def create_temp_session(self) -> str:
        """Crear sesiÃ³n temporal para 2FA (5 min)."""
        import secrets
        from datetime import timedelta
        
        token = secrets.token_urlsafe(32)
        self.temp_session_token = token
        self.temp_session_expires = datetime.utcnow() + timedelta(minutes=5)
        return token
    
    def verify_temp_session(self, token: str) -> bool:
        """Verificar sesiÃ³n temporal."""
        if self.temp_session_token != token:
            return False
        if self.temp_session_expires < datetime.utcnow():
            return False
        return True
