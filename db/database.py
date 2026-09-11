"""
ConfiguraciÃ³n de base de datos y sesiones.
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from contextlib import contextmanager

from db.models import Base


DATABASE_URL = os.getenv(
    'DATABASE_URL',
    'postgresql://postgres:postgres@localhost:5432/onion_search'
)


engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    echo=False
)


SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)


def init_db():
    """Inicializar base de datos."""
    Base.metadata.create_all(bind=engine)
    print("â£¿ Tablas creadas exitosamente")


@contextmanager
def get_db() -> Session:
    """Context manager para sesiones de DB."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
