"""
Configuración de base de datos y sesiones.

En desarrollo (sin `DATABASE_URL`) FARO usa SQLite local, así el portal
arranca sin necesidad de levantar Postgres ni Tor. En producción se apunta
`DATABASE_URL` a PostgreSQL.
"""
import os

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, Session
from contextlib import contextmanager

from db.models import Base


DATABASE_URL = os.getenv('DATABASE_URL') or 'sqlite:///./faro.db'
IS_SQLITE = DATABASE_URL.startswith('sqlite')


def _engine_kwargs():
    if IS_SQLITE:
        return {
            'connect_args': {'check_same_thread': False},
            'pool_pre_ping': True,
        }
    return {
        'pool_pre_ping': True,
        'pool_size': 10,
        'max_overflow': 20,
    }


engine = create_engine(DATABASE_URL, echo=False, **_engine_kwargs())


SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
    bind=engine,
)


# Columnas agregadas después de la primera versión del esquema. No hay
# framework de migraciones, así que se aplican de forma idempotente al boot.
_ADDED_COLUMNS = {
    'onion_sites': {
        'category': 'VARCHAR(64)',
        'language': 'VARCHAR(8)',
        'is_mirror': 'BOOLEAN DEFAULT 0',
    },
}


def _ensure_columns():
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table, columns in _ADDED_COLUMNS.items():
            if table not in existing_tables:
                continue
            current = {col['name'] for col in inspector.get_columns(table)}
            for name, ddl in columns.items():
                if name in current:
                    continue
                ddl_dialect = ddl
                if not IS_SQLITE:
                    ddl_dialect = ddl.replace('DEFAULT 0', 'DEFAULT false')
                conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {name} {ddl_dialect}'))
                print(f'· columna {table}.{name} agregada')


def init_db():
    """Inicializar base de datos (tablas + columnas nuevas)."""
    Base.metadata.create_all(bind=engine)
    _ensure_columns()
    print('✓ Esquema de FARO listo')


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
