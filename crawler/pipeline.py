"""
Pipeline de rastreo de FARO.

Recorre semillas .onion, extrae contenido y enlaces, deduplica por huella de
contenido (agrupando espejos), respeta la blocklist y escribe en la base de
datos y en Meilisearch. Todo el estado observable va a ``CrawlRun`` para que
el panel muestre progreso real aunque el rastreo corra en otro proceso.
"""
import logging
import os
from collections import deque
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Set

from sqlalchemy import func

from crawler.parse import extract
from crawler.transport import (
    build_transport, domain_of, is_onion, node_url, normalize_url,
)
from db.database import get_db
from db.models import Blocklist, CrawlRun, CrawlSeed, OnionSite
from indexer.meili_client import create_indexer

logger = logging.getLogger(__name__)

MAX_PAGES = int(os.getenv('CRAWL_MAX_PAGES', '80'))
MAX_DEPTH = int(os.getenv('CRAWL_MAX_DEPTH', '3'))
DOMAIN_CAP = int(os.getenv('CRAWL_DOMAIN_CAP', '12'))
PAGES_PER_DOMAIN = int(os.getenv('CRAWL_PAGES_PER_DOMAIN', '3'))
REQUEST_DELAY = float(os.getenv('CRAWL_DELAY', '0.35'))

CATEGORY_HINTS = {
    'Biblioteca': ('biblioteca', 'libro', 'archivo', 'texto', 'wiki',
                   'glosario', 'manual', 'documento'),
    'Foros': ('foro', 'foros', 'discusión', 'comunidad', 'club', 'chat'),
    'Mercados': ('mercado', 'tienda', 'venta', 'catálogo', 'envío', 'escrow'),
    'Noticias': ('noticia', 'boletín', 'revista', 'periódico', 'blog'),
    'Correo': ('correo', 'buzón', 'mail', 'pgp', 'mensajería'),
    'Seguridad': ('seguridad', 'cripto', 'vpn', 'túnel', 'hardening',
                  'exploit', 'laboratorio'),
    'Servicios': ('servicio', 'consulta', 'radio', 'emisora', 'soporte',
                  'clínica', 'sala'),
    'Herramientas': ('herramienta', 'paste', 'mapa', 'relay', 'directorio',
                     'lista', 'índice'),
}


def infer_category(title: str, content: str) -> str:
    """Categoría aproximada por palabras clave (mejor esfuerzo)."""
    haystack = f'{title} {content[:1200]}'.lower()
    best, best_score = None, 0
    for category, words in CATEGORY_HINTS.items():
        score = sum(haystack.count(word) for word in words)
        if score > best_score:
            best, best_score = category, score
    return best or 'Servicios'


def load_seeds() -> List[str]:
    """Semillas activas: base de datos + ``TOR_SEED_URLS`` + ``seed_list.txt``."""
    seeds: List[str] = []
    seen: Set[str] = set()

    def add(url: str):
        url = normalize_url(url)
        if url and is_onion(url) and url not in seen:
            seen.add(url)
            seeds.append(url)

    with get_db() as db:
        for seed in db.query(CrawlSeed).filter(CrawlSeed.active.is_(True)).all():
            add(seed.url)

    for raw in (os.getenv('TOR_SEED_URLS') or '').replace('\n', ',').split(','):
        if raw.strip():
            add(raw.strip())

    try:
        with open('seed_list.txt', 'r', encoding='utf-8') as handle:
            for line in handle:
                line = line.strip()
                if line and not line.startswith('#') and '.onion' in line:
                    add(line)
    except FileNotFoundError:
        pass

    return seeds


def load_blocklist() -> Dict[str, Set[str]]:
    """Blocklist de la base + ``blocklist.txt`` (dominios y huellas)."""
    domains: Set[str] = set()
    hashes: Set[str] = set()

    with get_db() as db:
        for entry in db.query(Blocklist).all():
            domains.add(domain_of(entry.url))
            if entry.content_hash:
                hashes.add(entry.content_hash)
        for site in db.query(OnionSite).filter(OnionSite.is_blocked.is_(True)).all():
            domains.add(domain_of(site.url))

    try:
        with open('blocklist.txt', 'r', encoding='utf-8') as handle:
            for line in handle:
                line = line.strip()
                if line and not line.startswith('#') and '.onion' in line:
                    domains.add(domain_of(line))
    except FileNotFoundError:
        pass

    return {'domains': domains, 'hashes': hashes}


class CrawlPipeline:
    """Rastreo breadth-first acotado, con deduplicación y blocklist."""

    def __init__(
        self,
        transport=None,
        run_id: Optional[int] = None,
        max_pages: int = None,
        max_depth: int = None,
        domain_cap: int = None,
    ):
        self.transport = transport or build_transport()
        self.run_id = run_id
        self.max_pages = max_pages or MAX_PAGES
        self.max_depth = max_depth or MAX_DEPTH
        self.domain_cap = domain_cap or DOMAIN_CAP

        self.queue: deque = deque()
        self.seen: Set[str] = set()
        self.queued: Set[str] = set()
        self.per_domain: Dict[str, int] = {}
        self.blocklist = load_blocklist()
        self.indexer = create_indexer()

        self.pages_ok = 0
        self.pages_failed = 0
        self.sites_new = 0
        self.blocked = 0
        self.enqueued_sites: Set[str] = set()
        self._batch: List[Dict] = []

    # ------------------------------------------------------------------
    # Cola
    # ------------------------------------------------------------------
    def add_seed(self, url: str, depth: int = 0):
        """Encola la portada del nodo (una entrada por dominio)."""
        url = node_url(url)
        if not url or not is_onion(url) or url in self.seen or url in self.queued:
            return
        self.queued.add(url)
        self.queue.append((url + '/', depth))

    def _allowed_domain(self, url: str) -> bool:
        domain = domain_of(url)
        if domain in self.blocklist['domains']:
            self.blocked += 1
            return False
        return self.per_domain.get(domain, 0) < self.domain_cap

    # ------------------------------------------------------------------
    # Persistencia
    # ------------------------------------------------------------------
    def _save_page(self, data: Dict) -> bool:
        """Escribe/actualiza un nodo. Devuelve True si quedó guardado."""
        is_new = False
        canonical = node_url(data['url'])
        with get_db() as db:
            site = db.query(OnionSite).filter(OnionSite.url == canonical).first()
            if site is None:
                site = OnionSite(
                    url=canonical,
                    content_hash=data['content_hash'],
                    title=data['title'],
                )
                db.add(site)
                is_new = True

            site.title = data['title']
            site.description = data['description']
            site.content = data['content']
            site.content_hash = data['content_hash']
            site.last_crawled = datetime.utcnow()
            site.status_code = 200
            site.online = True
            if not site.category:
                site.category = infer_category(data['title'], data['content'])
            if site.is_blocked:
                db.rollback()
                return False

            db.flush()

            # Espejos: mismo contenido normalizado en otro nodo.
            twin = (
                db.query(OnionSite)
                .filter(
                    OnionSite.content_hash == data['content_hash'],
                    OnionSite.id != site.id,
                )
                .first()
            )
            site.is_mirror = twin is not None

        if is_new:
            self.sites_new += 1
        return True

    def save_page(self, data: Dict) -> bool:
        if data['content_hash'] in self.blocklist['hashes']:
            self.blocked += 1
            logger.info('Bloqueado por huella de contenido: %s', data['domain'])
            return False
        return self._save_page(data)

    def flush_index(self):
        """Envía el lote acumulado a Meilisearch (si está disponible)."""
        if not self._batch:
            return
        documents = [{
            'url': item['url'],
            'title': item['title'],
            'description': item['description'],
            'content': item['content'][:8000],
            'content_hash': item['content_hash'],
            'category': item.get('category'),
            'crawled_at': item['crawled_at'],
        } for item in self._batch]
        self.indexer.add_or_update_documents(documents)
        self._batch.clear()

    def update_run(self, status: str = None, message: str = None):
        if not self.run_id:
            return
        with get_db() as db:
            run = db.query(CrawlRun).filter(CrawlRun.id == self.run_id).first()
            if run is None:
                return
            run.pages_ok = self.pages_ok
            run.pages_failed = self.pages_failed
            run.sites_new = self.sites_new
            run.blocked = self.blocked
            if status:
                run.status = status
            if message:
                run.message = message[:2000]
            if status in ('ok', 'error', 'cancelado'):
                run.finished_at = datetime.utcnow()

    # ------------------------------------------------------------------
    # Ciclo principal
    # ------------------------------------------------------------------
    def run(self, seeds: Optional[Iterable[str]] = None, delay: float = None) -> Dict:
        import time

        delay = REQUEST_DELAY if delay is None else delay
        seeds = list(seeds) if seeds is not None else load_seeds()

        if not seeds:
            message = ('Sin semillas activas: agregá direcciones .onion en '
                       '/admin/acciones o definí TOR_SEED_URLS.')
            self.update_run(status='error', message=message)
            return {'ok': False, 'message': message, 'pages_ok': 0}

        for seed in seeds:
            self.add_seed(seed)

        self.update_run(status='corriendo', message='Rastreo en curso')

        try:
            while self.queue and self.pages_ok < self.max_pages:
                url, depth = self.queue.popleft()
                if url in self.seen:
                    continue
                self.seen.add(url)

                if not self._allowed_domain(url):
                    continue

                result = self.transport.fetch(url)
                domain = domain_of(url)
                self.per_domain[domain] = self.per_domain.get(domain, 0) + 1

                if not result.ok or not result.text:
                    self.pages_failed += 1
                    self._record_failure(url, result)
                    continue

                data = extract(result.text, url)
                if not self.save_page(data):
                    continue

                self.pages_ok += 1
                data['category'] = infer_category(data['title'], data['content'])
                self._batch.append(data)
                if len(self._batch) >= 25:
                    self.flush_index()

                if depth < self.max_depth:
                    for link in data['links']:
                        self.add_seed(link, depth + 1)

                self.update_run()
                if delay:
                    time.sleep(delay)

            self.flush_index()
            self._mark_seeds(seeds)
            message = (
                f'{self.pages_ok} páginas indexadas · {self.sites_new} nodos nuevos · '
                f'{self.pages_failed} fallos · {self.blocked} bloqueos'
            )
            self.update_run(status='ok', message=message)
            return {
                'ok': True,
                'message': message,
                'pages_ok': self.pages_ok,
                'pages_failed': self.pages_failed,
                'sites_new': self.sites_new,
                'blocked': self.blocked,
            }
        except Exception as exc:  # pragma: no cover - red / disco
            logger.exception('Rastreo interrumpido')
            self.update_run(status='error', message=f'Error: {exc}')
            return {'ok': False, 'message': str(exc), 'pages_ok': self.pages_ok}
        finally:
            self.transport.close()

    # ------------------------------------------------------------------
    def _record_failure(self, url: str, result):
        """Un nodo caído se indexa igual (sin contenido) para monitorearlo."""
        canonical = node_url(url)
        with get_db() as db:
            site = db.query(OnionSite).filter(OnionSite.url == canonical).first()
            if site is None:
                domain = domain_of(url)
                site = OnionSite(
                    url=canonical,
                    title=domain,
                    content_hash=f'failed:{domain}',
                    category=None,
                )
                db.add(site)
                self.sites_new += 1
            site.last_crawled = datetime.utcnow()
            site.status_code = result.status_code or 0
            if result.status_code == 0:
                site.online = False
            if result.error:
                site.description = site.description or f'Sin respuesta ({result.error})'

    def _mark_seeds(self, seeds: List[str]):
        with get_db() as db:
            hosts = {domain_of(seed) for seed in seeds}
            for seed in db.query(CrawlSeed).all():
                if domain_of(seed.url) in hosts:
                    seed.last_crawled = datetime.utcnow()


def run_crawl(run_id: Optional[int] = None, trigger: str = 'manual') -> Dict:
    pipeline = CrawlPipeline(run_id=run_id)
    return pipeline.run()
