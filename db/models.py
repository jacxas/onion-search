"""
Modelos de base de datos con SQLAlchemy.
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, Index
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class OnionSite(Base):
    """
    Modelo para sitios .onion indexados.
    """
    __tablename__ = 'onion_sites'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    url = Column(String(255), unique=True, nullable=False, index=True)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    content = Column(Text, nullable=True)
    content_hash = Column(String(64), nullable=False, index=True)
    
    status_code = Column(Integer, default=0)
    online = Column(Boolean, default=False)
    response_time = Column(Float, nullable=True)
    avg_response_time = Column(Float, nullable=True)
    
    uptime_ratio = Column(Float, default=0.0)
    total_checks = Column(Integer, default=0)
    successful_checks = Column(Integer, default=0)
    
    first_crawled = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_crawled = Column(DateTime, nullable=True)
    last_checked = Column(DateTime, nullable=True)
    last_online = Column(DateTime, nullable=True)
    
    is_blocked = Column(Boolean, default=False)
    block_reason = Column(String(255), nullable=True)
    
    __table_args__ = (
        Index('idx_online', 'online'),
        Index('idx_uptime', 'uptime_ratio'),
        Index('idx_last_checked', 'last_checked'),
        Index('idx_blocked', 'is_blocked'),
    )
    
    def __repr__(self):
        return f"<OnionSite(url='{self.url[:50]}...', online={self.online})>"
    
    def update_uptime(self, is_online: bool, response_time: float = None):
        """Actualizar stats de uptime."""
        self.total_checks += 1
        if is_online:
            self.successful_checks += 1
            self.last_online = datetime.utcnow()
        
        self.online = is_online
        self.uptime_ratio = self.successful_checks / self.total_checks
        
        if response_time is not None and is_online:
            if self.avg_response_time is None:
                self.avg_response_time = response_time
            else:
                self.avg_response_time = 0.3 * response_time + 0.7 * self.avg_response_time
        
        self.last_checked = datetime.utcnow()


class Blocklist(Base):
    """
    Lista de sitios bloqueados.
    """
    __tablename__ = 'blocklist'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    url = Column(String(255), unique=True, nullable=False, index=True)
    content_hash = Column(String(64), nullable=True, index=True)
    reason = Column(String(255), nullable=False)
    added_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    def __repr__(self):
        return f"<Blocklist(url='{self.url[:50]}...', reason='{self.reason}')>"
