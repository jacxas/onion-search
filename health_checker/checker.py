"""
Verificación de salud de nodos onion.

Hace un barrido de los nodos indexados, mide latencia, actualiza el uptime
(últimos 100 chequeos), guarda cada resultado en ``SiteCheck`` y deja un
resumen en ``CrawlRun``.

Funciona con el mismo transporte que el crawler: proxy SOCKS5 de Tor en modo
``live`` o red simulada en modo ``sim``. Es sincrónico y usa un pool de hilos
acotado para ser cortés con la red.
"""
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Dict, List, Optional

from crawler.transport import build_transport, domain_of
from db.database import get_db
from db.models import CrawlRun, OnionSite, SiteCheck

logger = logging.getLogger(__name__)

BATCH = int(os.getenv('HEALTH_BATCH', '8'))
MAX_CHECK = int(os.getenv('HEALTH_MAX_SITES', '80'))
TIMEOUT = float(os.getenv('HEALTH_TIMEOUT_MS', '20000')) / 1000


def _check_one(transport, url: str) -> Dict:
    result = transport.fetch(url, timeout=TIMEOUT)
    return {
        'url': url,
        'online': result.ok,
        'status_code': result.status_code,
        'response_time': result.elapsed if result.ok else None,
        'error': result.error,
    }


def run_health_sweep(
    limit: int = None,
    run_id: Optional[int] = None,
    transport=None,
    delay: float = 0.0,
) -> Dict:
    """Verifica hasta ``limit`` nodos y persiste los resultados."""
    limit = limit or MAX_CHECK
    owns_transport = transport is None
    transport = transport or build_transport()

    with get_db() as db:
        sites = (
            db.query(OnionSite)
            .filter(OnionSite.is_blocked.is_(False))
            .order_by(OnionSite.last_checked.asc().nulls_first())
            .limit(limit)
            .all()
        )
        targets = [(site.id, site.url) for site in sites]

    started = time.perf_counter()
    results: List[Dict] = []
    with ThreadPoolExecutor(max_workers=max(1, min(BATCH, len(targets) or 1))) as pool:
        futures = {pool.submit(_check_one, transport, url): (site_id, url)
                   for site_id, url in targets}
        for future in as_completed(futures):
            site_id, url = futures[future]
            try:
                payload = future.result()
            except Exception as exc:  # pragma: no cover - defensivo
                payload = {'url': url, 'online': False, 'status_code': 0,
                           'response_time': None, 'error': str(exc)}
            payload['site_id'] = site_id
            results.append(payload)
            if delay:
                time.sleep(delay)

    online = sum(1 for item in results if item['online'])
    now = datetime.utcnow()

    with get_db() as db:
        for item in results:
            site = db.query(OnionSite).filter(OnionSite.id == item['site_id']).first()
            if site is None:
                continue
            site.total_checks = (site.total_checks or 0)
            site.update_uptime(item['online'], item['response_time'])
            site.status_code = item['status_code']
            if item['error'] == 'timeout':
                site.last_checked = now
            db.add(SiteCheck(
                site_id=site.id,
                checked_at=now,
                online=item['online'],
                response_time=item['response_time'],
                status_code=item['status_code'],
            ))

        if run_id:
            run = db.query(CrawlRun).filter(CrawlRun.id == run_id).first()
            if run:
                run.checked = len(results)
                run.pages_ok = online
                run.pages_failed = len(results) - online
                run.status = 'ok'
                run.finished_at = now
                run.message = (
                    f'{online}/{len(results)} nodos respondieron '
                    f'en {round(time.perf_counter() - started, 1)} s'
                )

    if owns_transport:
        transport.close()

    summary = {
        'checked': len(results),
        'online': online,
        'offline': len(results) - online,
        'elapsed': round(time.perf_counter() - started, 2),
    }
    logger.info('Barrido de salud: %s', summary)
    return summary


def down_sites(limit: int = 20) -> List[Dict]:
    """Nodos caídos con más de un chequeo, para alertas."""
    with get_db() as db:
        sites = (
            db.query(OnionSite)
            .filter(OnionSite.online.is_(False), OnionSite.is_blocked.is_(False))
            .order_by(OnionSite.last_checked.desc())
            .limit(limit)
            .all()
        )
        return [{
            'domain': domain_of(site.url),
            'title': site.title,
            'last_checked': site.last_checked,
            'uptime_ratio': site.uptime_ratio,
        } for site in sites]
