"""
Transporte HTTP para la red onion.

Dos implementaciones con la misma interfaz:

- ``TorTransport``  usa el proxy SOCKS5 de Tor (``socks5h`` = DNS remoto, el
  único modo que resuelve ``.onion``). Es el modo ``live``.
- ``SimTransport``  sirve una red onion determinista en memoria, para
  desarrollo y demos sin Tor. Es el modo ``sim``.

Ambos devuelven ``FetchResult`` y nunca lanzan por un fallo de red: un nodo
caído es un dato más del índice, no una excepción que rompa el rastreo.
"""
import hashlib
import os
import threading
import time
import zlib
from dataclasses import dataclass
from typing import Dict, List, Optional
from urllib.parse import urlparse

import requests

DEFAULT_TIMEOUT = float(os.getenv('CRAWL_TIMEOUT_MS', '30000')) / 1000
DEFAULT_PROXY = os.getenv('TOR_SOCKS_PROXY', 'socks5h://127.0.0.1:9050')
USER_AGENT = os.getenv(
    'CRAWLER_USER_AGENT',
    'Mozilla/5.0 (compatible; FARO/1.0; bot indexador onion; +onion)',
)


@dataclass
class FetchResult:
    url: str
    status_code: int = 0
    text: str = ''
    elapsed: float = 0.0
    error: Optional[str] = None

    @property
    def ok(self) -> bool:
        return self.error is None and 0 < self.status_code < 400


def normalize_url(url: str) -> str:
    """URL canónica: esquema http, host en minúsculas, sin fragmento."""
    url = (url or '').strip()
    if not url:
        return ''
    if '://' not in url:
        url = 'http://' + url
    parsed = urlparse(url)
    host = (parsed.hostname or '').lower()
    if not host:
        return ''
    path = parsed.path or '/'
    if parsed.query:
        path = f'{path}?{parsed.query}'
    return f'http://{host}{path}'


def domain_of(url: str) -> str:
    return (urlparse(normalize_url(url)).hostname or '').lower()


def is_onion(url: str) -> bool:
    return domain_of(url).endswith('.onion')


def node_url(url: str) -> str:
    """URL canónica de un nodo: esquema + dominio, sin ruta ni barra final.

    FARO indexa servicios, no páginas sueltas: la ficha y el ranking son por
    nodo, así que todas las rutas de un mismo host colapsan en una entrada.
    """
    host = domain_of(url)
    return f'http://{host}' if host else ''


# ==========================================================================
# Modo live: proxy SOCKS5 de Tor
# ==========================================================================

class TorTransport:
    """HTTP sobre el proxy SOCKS5 de Tor, con reintentos acotados."""

    mode = 'live'

    def __init__(self, proxy: str = None, timeout: float = None, retries: int = 2):
        self.proxy = proxy or DEFAULT_PROXY
        self.timeout = timeout or DEFAULT_TIMEOUT
        self.retries = retries
        self._local = threading.local()

    # Una sesión por hilo: requests.Session no es thread-safe.
    @property
    def session(self) -> requests.Session:
        session = getattr(self._local, 'session', None)
        if session is None:
            session = requests.Session()
            session.proxies = {'http': self.proxy, 'https': self.proxy}
            session.headers.update({
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'es,en;q=0.8',
                'Connection': 'close',
            })
            self._local.session = session
        return session

    def fetch(self, url: str, timeout: float = None) -> FetchResult:
        url = normalize_url(url)
        result = FetchResult(url=url)
        started = time.perf_counter()

        for attempt in range(self.retries + 1):
            try:
                response = self.session.get(
                    url, timeout=timeout or self.timeout, allow_redirects=True
                )
                result.status_code = response.status_code
                result.text = response.text[:2_000_000] if response.text else ''
                result.elapsed = round(time.perf_counter() - started, 2)
                result.error = None
                return result
            except requests.exceptions.Timeout:
                result.error = 'timeout'
            except requests.exceptions.ProxyError as exc:
                result.error = f'proxy: {exc.__class__.__name__}'
                break  # sin Tor no tiene sentido reintentar
            except requests.exceptions.ConnectionError as exc:
                result.error = f'conexion: {exc.__class__.__name__}'
            except requests.exceptions.RequestException as exc:
                result.error = f'http: {exc.__class__.__name__}'
            if attempt < self.retries:
                time.sleep(1.5 * (attempt + 1))

        result.elapsed = round(time.perf_counter() - started, 2)
        return result

    def healthcheck(self) -> Dict:
        """¿El proxy responde? Se usa para avisar en el panel."""
        try:
            response = self.session.get(
                'http://check.torproject.org/', timeout=min(self.timeout, 8)
            )
            return {'ok': True, 'status': response.status_code, 'proxy': self.proxy}
        except Exception as exc:
            return {'ok': False, 'error': str(exc)[:160], 'proxy': self.proxy}

    def close(self):
        session = getattr(self._local, 'session', None)
        if session is not None:
            session.close()


# ==========================================================================
# Modo sim: red onion determinista en memoria
# ==========================================================================

_SIM_PAGES: Dict[str, str] = {}
_SIM_LOCK = threading.Lock()


def _sim_html(host: str, title: str, body: str, links: List[str]) -> str:
    items = ''.join(
        f'<li><a href="http://{link}/">{link}</a></li>' for link in links
    )
    return (
        f'<!doctype html><html lang="es"><head><meta charset="utf-8">'
        f'<title>{title}</title>'
        f'<meta name="description" content="{body[:140]}">'
        f'</head><body><h1>{title}</h1><p>{body}</p>'
        f'<nav><ul>{items}</ul></nav>'
        f'<footer>nodo {host} · red simulada de FARO</footer>'
        f'</body></html>'
    )


def _register_sim_network():
    """Construye la red simulada una vez (dominios y contenido fijos)."""
    if _SIM_PAGES:
        return

    from db.seed import DOWN_SITES, SEED_SITES, MIRROR_OF, onion_address

    catalog = []
    for slug, title, category, description in SEED_SITES:
        catalog.append((slug, title, category, description))
    for parent, aliases in MIRROR_OF.items():
        for alias in aliases:
            entry = next(e for e in SEED_SITES if e[0] == parent)
            catalog.append((alias, entry[1] + ' (espejo)', entry[2], entry[3]))

    hosts = {slug: onion_address(slug) for slug, *_ in catalog}
    order = [slug for slug, *_ in catalog]
    with _SIM_LOCK:
        for index, (slug, title, category, description) in enumerate(catalog):
            links = [hosts[order[(index + step * 7) % len(order)]]
                     for step in (1, 2, 3)]
            _SIM_PAGES[hosts[slug]] = _sim_html(
                hosts[slug], f'{title}', f'{description}', links
            )

        # Nodos que solo aparecen al seguir enlaces: el crawler los descubre.
        from db.seed import onion_address as addr
        hidden = {
            'archivo-vivo': (
                'Archivo Vivo',
                'Repositorio de documentos recientes sobre derechos digitales. '
                'Actualización diaria y espejos en tres regiones.'
            ),
            'club-radio': (
                'Club Radio',
                'Foro técnico de radioaficionados que operan repetidoras '
                'clandestinas. Guías de antenas y horarios de contacto.'
            ),
            'mercado-libros': (
                'Mercado de Libros Usados',
                'Catálogo de libros descatalogados con envío regional. '
                'Pagos por escrow y reputación pública.'
            ),
        }
        for index, (slug, (title, body)) in enumerate(hidden.items()):
            host = addr(slug)
            visible = [
                hosts[order[(index * 5) % len(order)]],
                hosts[order[(index * 5 + 3) % len(order)]],
                hosts[order[(index * 5 + 6) % len(order)]],
            ]
            _SIM_PAGES[host] = _sim_html(host, title, body, visible)
            # Enlazar desde un par de nodos visibles.
            for parent_slug in (order[index * 4 % len(order)],
                                order[(index * 4 + 9) % len(order)]):
                parent = hosts[parent_slug]
                _SIM_PAGES[parent] = _SIM_PAGES[parent].replace(
                    '</ul>', f'<li><a href="http://{host}/">{title}</a></li></ul>'
                )


class SimTransport:
    """Red onion simulada: mismos dominios, contenidos y fallos siempre."""

    mode = 'sim'

    def __init__(self, timeout: float = None, latency: float = 0.0):
        _register_sim_network()
        self.timeout = timeout or DEFAULT_TIMEOUT
        self.latency = latency

    def fetch(self, url: str, timeout: float = None) -> FetchResult:
        url = normalize_url(url)
        host = domain_of(url)
        started = time.perf_counter()
        if self.latency:
            time.sleep(self.latency)

        page = _SIM_PAGES.get(host)
        if page is None:
            return FetchResult(
                url=url, status_code=404, error='sin respuesta en la red simulada',
                elapsed=round(time.perf_counter() - started, 3),
            )

        # Determinismo: 1 de cada 9 hosts está caído, más los nodos que la
        # semilla demo marca como caídos (para que la historia sea coherente).
        from db.seed import DOWN_SITES, onion_address
        down_hosts = {onion_address(slug) for slug in DOWN_SITES}
        if host in down_hosts or zlib.crc32(host.encode()) % 9 == 0:
            return FetchResult(
                url=url, status_code=0, error='timeout',
                elapsed=round(time.perf_counter() - started, 3),
            )

        return FetchResult(
            url=url, status_code=200, text=page,
            elapsed=round(time.perf_counter() - started, 3),
        )

    def healthcheck(self) -> Dict:
        return {'ok': True, 'status': 'sim', 'proxy': 'red simulada'}

    def close(self):
        return None


def build_transport(mode: str = None) -> object:
    """Crea el transporte según CRAWL_MODE (sim por defecto)."""
    mode = (mode or os.getenv('CRAWL_MODE', 'sim')).lower()
    if mode == 'live':
        return TorTransport()
    return SimTransport(latency=float(os.getenv('SIM_LATENCY', '0.05')))


def content_fingerprint(text: str) -> str:
    """Hash del contenido normalizado, para agrupar espejos."""
    normalized = ' '.join((text or '').lower().split())
    return hashlib.sha256(normalized.encode('utf-8', 'ignore')).hexdigest()
