#!/usr/bin/env python3
"""
Worker programado de FARO.

Ejecuta en segundo plano el barrido de salud (cada HEALTH_INTERVAL_MIN) y el
rastreo de semillas (cada CRAWL_INTERVAL_MIN). En modo ``live`` usa Tor; en
``sim`` usa la red simulada, así el índice se mantiene fresco en demos.

Uso:
    python -m scripts.worker            # ciclo continuo
    python -m scripts.worker --once     # un barrido de salud y sale
"""
import argparse
import logging
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.jobs import LIVE, recover_stale_runs, run_now  # noqa: E402
from db.database import init_db  # noqa: E402

logging.basicConfig(
    level=os.getenv('LOG_LEVEL', 'INFO'),
    format='%(asctime)s  %(levelname)-7s %(name)s  %(message)s',
)
logger = logging.getLogger('faro.worker')

HEALTH_EVERY = float(os.getenv('HEALTH_INTERVAL_MIN', '30')) * 60
CRAWL_EVERY = float(os.getenv('CRAWL_INTERVAL_MIN', '180')) * 60


def cycle(health: bool = True, crawl: bool = True):
    if health:
        logger.info('Barrido de salud…')
        result = run_now('health', trigger='worker')
        logger.info('Salud: %s', result)
    if crawl:
        logger.info('Rastreo de semillas…')
        result = run_now('crawl', trigger='worker')
        logger.info('Rastreo: %s', result)


def main():
    parser = argparse.ArgumentParser(description='Worker de FARO')
    parser.add_argument('--once', action='store_true',
                        help='un barrido de salud y termina')
    parser.add_argument('--no-crawl', action='store_true')
    args = parser.parse_args()

    init_db()
    stale = recover_stale_runs()
    if stale:
        logger.warning('%s corridas colgadas marcadas como error', stale)
    logger.info('Modo %s · salud cada %.0f min · rastreo cada %.0f min',
                'live (Tor)' if LIVE else 'sim', HEALTH_EVERY / 60, CRAWL_EVERY / 60)

    if args.once:
        cycle(health=True, crawl=False)
        return

    next_health = 0.0
    next_crawl = 0.0
    while True:
        now = time.time()
        do_health = now >= next_health
        do_crawl = now >= next_crawl and not args.no_crawl
        if do_health or do_crawl:
            try:
                cycle(health=do_health, crawl=do_crawl)
            except Exception:  # pragma: no cover
                logger.exception('Ciclo del worker falló')
            if do_health:
                next_health = time.time() + HEALTH_EVERY
            if do_crawl:
                next_crawl = time.time() + CRAWL_EVERY
        time.sleep(5)


if __name__ == '__main__':
    main()
