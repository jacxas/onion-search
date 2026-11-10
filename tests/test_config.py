"""Pruebas de configuración de despliegue (URLs y contexto de build)."""
import os

import pytest


def test_normalize_database_url():
    from db.database import normalize_database_url as norm

    # Fly / Heroku entregan `postgres://`, que SQLAlchemy no reconoce.
    assert norm('postgres://u:p@h:5432/db') == 'postgresql+psycopg2://u:p@h:5432/db'
    assert norm('postgresql://u:p@h/db') == 'postgresql+psycopg2://u:p@h/db'
    assert (
        norm('postgresql://u:p@h/db?sslmode=require')
        == 'postgresql+psycopg2://u:p@h/db?sslmode=require'
    )
    # Lo ya explícito no se toca.
    assert norm('postgresql+psycopg2://u:p@h/db') == 'postgresql+psycopg2://u:p@h/db'
    assert norm('sqlite:///./faro.db') == 'sqlite:///./faro.db'
    assert norm('') == ''


def test_fly_requires_database_url():
    """En Fly sin DATABASE_URL el módulo debe abortar (disco efímero)."""
    import importlib

    import db.database as database

    saved = {k: os.environ.get(k) for k in ('DATABASE_URL', 'FLY_APP_NAME')}
    try:
        os.environ.pop('DATABASE_URL', None)
        os.environ['FLY_APP_NAME'] = 'faro-test'
        with pytest.raises(RuntimeError, match='DATABASE_URL'):
            importlib.reload(database)
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        importlib.reload(database)


def test_dockerfiles_copy_from_valid_context():
    """Ningún COPY de los Dockerfiles puede apuntar a algo ignorado."""
    import fnmatch
    import re

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ignore_file = os.path.join(root, '.dockerignore')
    patterns = []
    with open(ignore_file, encoding='utf-8') as handle:
        for line in handle:
            line = line.strip()
            if line and not line.startswith('#') and not line.startswith('!'):
                patterns.append(line)

    def ignored(path):
        top = path.split('/')[0]
        return any(fnmatch.fnmatch(path, p) or fnmatch.fnmatch(top, p)
                   for p in patterns)

    missing = []
    for dockerfile in ('Dockerfile', 'deploy/fly/Dockerfile.tor'):
        path = os.path.join(root, dockerfile)
        with open(path, encoding='utf-8') as handle:
            for raw in handle:
                line = raw.strip()
                if not line.upper().startswith('COPY') or '--from=' in line:
                    continue
                args = [a for a in re.split(r'\s+', line)[1:] if not a.startswith('--')]
                for src in args[:-1]:
                    src = src.rstrip('/')
                    if any(ch in src for ch in '*?'):
                        continue
                    full = os.path.join(root, src)
                    if not os.path.exists(full) or ignored(src):
                        missing.append((dockerfile, src))

    assert not missing, f'COPY sin origen en el contexto: {missing}'
