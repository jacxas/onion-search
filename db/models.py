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

    category = Column(String(64), nullable=True, index=True)
    language = Column(String(8), default='es')
    is_mirror = Column(Boolean, default=False)
    
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


class SiteReport(Base):
    """
    Reporte enviado por un usuario sobre un sitio del índice.
    """
    __tablename__ = 'site_reports'

    id = Column(Integer, primary_key=True, autoincrement=True)
    site_id = Column(Integer, nullable=True, index=True)
    url = Column(String(255), nullable=False)
    reason = Column(String(64), nullable=False, default='otro')
    details = Column(Text, nullable=True)
    status = Column(String(16), nullable=False, default='pendiente')
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<SiteReport(url='{self.url[:40]}...', reason='{self.reason}')>"


class SiteCheck(Base):
    """
    Historial de chequeos de salud de un sitio (últimos N en la ficha).
    """
    __tablename__ = 'site_checks'

    id = Column(Integer, primary_key=True, autoincrement=True)
    site_id = Column(Integer, nullable=False, index=True)
    checked_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    online = Column(Boolean, default=False)
    response_time = Column(Float, nullable=True)
    status_code = Column(Integer, default=0)


class CrawlSeed(Base):
    """
    Semilla de rastreo: punto de entrada .onion para el crawler.
    """
    __tablename__ = 'crawl_seeds'

    id = Column(Integer, primary_key=True, autoincrement=True)
    url = Column(String(255), unique=True, nullable=False, index=True)
    source = Column(String(32), nullable=False, default='manual')
    active = Column(Boolean, default=True, nullable=False)
    added_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_crawled = Column(DateTime, nullable=True)
    notes = Column(String(255), nullable=True)

    def __repr__(self):
        return f"<CrawlSeed(url='{self.url[:40]}...', active={self.active})>"


class CrawlRun(Base):
    """
    Ejecución de una tarea del pipeline (rastreo, salud, reindexado).

    Se guarda en la base y no solo en memoria: el portal, el worker y el
    panel pueden leer el progreso aunque corran en procesos distintos.
    """
    __tablename__ = 'crawl_runs'

    id = Column(Integer, primary_key=True, autoincrement=True)
    kind = Column(String(16), nullable=False, default='crawl')       # crawl | health | reindex
    mode = Column(String(8), nullable=False, default='sim')           # sim | live
    status = Column(String(16), nullable=False, default='pendiente')  # pendiente | corriendo | ok | error | cancelado
    trigger = Column(String(24), nullable=False, default='manual')    # manual | worker | boot
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    finished_at = Column(DateTime, nullable=True)
    pages_ok = Column(Integer, default=0, nullable=False)
    pages_failed = Column(Integer, default=0, nullable=False)
    sites_new = Column(Integer, default=0, nullable=False)
    blocked = Column(Integer, default=0, nullable=False)
    checked = Column(Integer, default=0, nullable=False)
    message = Column(Text, nullable=True)

    @property
    def duration(self):
        end = self.finished_at or datetime.utcnow()
        return max(0, int((end - self.started_at).total_seconds()))

    @property
    def running(self):
        return self.status in ('pendiente', 'corriendo')

    def __repr__(self):
        return f"<CrawlRun({self.kind} {self.status} ok={self.pages_ok})>"
