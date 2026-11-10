"""
Ejecución de tareas del pipeline desde el portal.

Las tareas (rastreo, barrido de salud, reindexado) corren en un hilo aparte
para no bloquear la respuesta HTTP, y su progreso se guarda en ``CrawlRun``
en la base de datos: así el panel muestra avance real aunque el proceso se
reinicie o el trabajo lo haga el worker.

Reglas:
- una sola tarea por tipo a la vez (single-flight, en proceso y en base);
- en modo ``sim`` usa la red simulada y sin esperas entre páginas;
- en modo ``live`` usa el proxy Tor y respeta los delays corteses del crawler.
"""
import logging
import os
import threading
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple

from crawler.pipeline import CrawlPipeline
from crawler.transport import build_transport
from db.database import get_db
from db.models import CrawlRun, OnionSite
from health_checker.checker import run_health_sweep
from indexer.meili_client import create_indexer

logger = logging.getLogger(__name__)

CRAWL_MODE = os.getenv('CRAWL_MODE', 'sim').lower()
LIVE = CRAWL_MODE == 'live'
STALE_AFTER = timedelta(hours=2)

_RUNNING: set = set()
_LOCK = threading.Lock()


def is_running(kind: str) -> bool:
    with _LOCK:
        if kind in _RUNNING:
            return True
    with get_db() as db:
        cutoff = datetime.utcnow() - STALE_AFTER
        active = (
            db.query(CrawlRun)
            .filter(
                CrawlRun.kind == kind,
                CrawlRun.status.in_(('pendiente', 'corriendo')),
                CrawlRun.started_at >= cutoff,
            )
            .count()
        )
    return active > 0


def recent_runs(limit: int = 12):
    with get_db() as db:
        return (
            db.query(CrawlRun)
            .order_by(CrawlRun.started_at.desc())
            .limit(limit)
            .all()
        )


def active_run(kind: str = None) -> Optional[CrawlRun]:
    with get_db() as db:
        query = db.query(CrawlRun).filter(
            CrawlRun.status.in_(('pendiente', 'corriendo'))
        )
        if kind:
            query = query.filter(CrawlRun.kind == kind)
        return query.order_by(CrawlRun.started_at.desc()).first()


def recover_stale_runs() -> int:
    """Marca como error las corridas que quedaron colgadas de un reinicio."""
    with get_db() as db:
        cutoff = datetime.utcnow() - STALE_AFTER
        stale = (
            db.query(CrawlRun)
            .filter(
                CrawlRun.status.in_(('pendiente', 'corriendo')),
                CrawlRun.started_at < cutoff,
            )
            .all()
        )
        for run in stale:
            run.status = 'error'
            run.finished_at = datetime.utcnow()
            run.message = 'Interrumpida (proceso reiniciado)'
        return len(stale)


def _create_run(kind: str, trigger: str) -> int:
    with get_db() as db:
        run = CrawlRun(
            kind=kind,
            mode='live' if LIVE else 'sim',
            status='pendiente',
            trigger=trigger,
        )
        db.add(run)
        db.flush()
        return run.id


def _mark(run_id: int, **fields):
    with get_db() as db:
        run = db.query(CrawlRun).filter(CrawlRun.id == run_id).first()
        if run is None:
            return
        for key, value in fields.items():
            setattr(run, key, value)


def _tor_ready() -> tuple:
    """En modo live, verifica el proxy antes de encolar trabajo inútil."""
    if not LIVE:
        return True, ''
    transport = build_transport()
    try:
        info = transport.healthcheck()
    finally:
        transport.close()
    if info.get('ok'):
        return True, ''
    return False, (
        'Tor no responde en ' + str(info.get('proxy', 'el proxy configurado')) +
        ': revisá que el demonio esté corriendo (SOCKS5 en 9050) o cambiá '
        'CRAWL_MODE=sim para operar en modo demostración.'
    )


def _crawl_job(run_id: int):
    try:
        _mark(run_id, status='corriendo')
        ready, detail = _tor_ready()
        if not ready:
            _mark(run_id, status='error', finished_at=datetime.utcnow(),
                  message=detail)
            return
        pipeline = CrawlPipeline(transport=build_transport())
        pipeline.run_id = run_id
        result = pipeline.run(delay=0.0 if not LIVE else None)
        if not result.get('ok'):
            _mark(run_id, status='error', finished_at=datetime.utcnow(),
                  message=result.get('message', 'Rastreo sin resultado'))
    except Exception as exc:  # pragma: no cover - defensivo
        logger.exception('Fallo el rastreo')
        _mark(run_id, status='error', finished_at=datetime.utcnow(),
              message=f'Error inesperado: {exc}')
    finally:
        with _LOCK:
            _RUNNING.discard('crawl')


def _health_job(run_id: int):
    try:
        _mark(run_id, status='corriendo')
        ready, detail = _tor_ready()
        if not ready:
            _mark(run_id, status='error', finished_at=datetime.utcnow(),
                  message=detail)
            return
        run_health_sweep(run_id=run_id, transport=build_transport())
    except Exception as exc:  # pragma: no cover
        logger.exception('Fallo el barrido de salud')
        _mark(run_id, status='error', finished_at=datetime.utcnow(),
              message=f'Error inesperado: {exc}')
    finally:
        with _LOCK:
            _RUNNING.discard('health')


def _reindex_job(run_id: int):
    try:
        _mark(run_id, status='corriendo')
        meili = create_indexer()
        if not meili.available:
            _mark(run_id, status='error', finished_at=datetime.utcnow(),
                  message='Meilisearch no responde: la búsqueda sigue en modo local')
            return
        with get_db() as db:
            sites = db.query(OnionSite).filter(OnionSite.is_blocked.is_(False)).all()
            documents = [{
                'url': site.url,
                'title': site.title,
                'description': site.description,
                'content': (site.content or '')[:8000],
                'content_hash': site.content_hash,
                'category': site.category,
                'crawled_at': (site.last_crawled or site.first_crawled).isoformat()
                if (site.last_crawled or site.first_crawled) else None,
            } for site in sites]
        meili.add_or_update_documents(documents)
        _mark(run_id, status='ok', finished_at=datetime.utcnow(),
              pages_ok=len(documents),
              message=f'{len(documents)} documentos enviados a Meilisearch')
    except Exception as exc:  # pragma: no cover
        logger.exception('Fallo el reindexado')
        _mark(run_id, status='error', finished_at=datetime.utcnow(),
              message=f'Error inesperado: {exc}')
    finally:
        with _LOCK:
            _RUNNING.discard('reindex')


JOBS = {
    'crawl': _crawl_job,
    'health': _health_job,
    'reindex': _reindex_job,
}


def enqueue(kind: str, trigger: str = 'manual') -> Tuple[bool, Optional[int], str]:
    """Lanza una tarea. Devuelve (lanzada, run_id, mensaje)."""
    if kind not in JOBS:
        return False, None, f'Tarea desconocida: {kind}'
    if is_running(kind):
        current = active_run(kind)
        return False, current.id if current else None, (
            'Ya hay una tarea de este tipo en curso; esperá a que termine.'
        )

    run_id = _create_run(kind, trigger)
    with _LOCK:
        _RUNNING.add(kind)

    thread = threading.Thread(
        target=JOBS[kind], args=(run_id,),
        name=f'faro-{kind}-{run_id}', daemon=True,
    )
    thread.start()

    if kind == 'crawl' and not LIVE:
        note = ' (red simulada: el rastreo real requiere CRAWL_MODE=live y Tor)'
    else:
        note = ''
    return True, run_id, f'Tarea «{kind}» iniciada{note}'


def run_now(kind: str, trigger: str = 'boot') -> Optional[Dict]:
    """Versión bloqueante, usada por el worker programado."""
    succeeded, run_id, _message = enqueue(kind, trigger=trigger)
    if not succeeded or run_id is None:
        return None
    while is_running(kind):
        import time
        time.sleep(0.4)
    with get_db() as db:
        run = db.query(CrawlRun).filter(CrawlRun.id == run_id).first()
        if run is None:
            return None
        return {
            'id': run.id, 'kind': run.kind, 'status': run.status,
            'message': run.message, 'pages_ok': run.pages_ok,
            'pages_failed': run.pages_failed, 'checked': run.checked,
        }
