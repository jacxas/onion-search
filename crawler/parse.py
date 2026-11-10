"""
Extracción de contenido y enlaces de páginas onion.

Usa BeautifulSoup si está disponible; si no, cae a ``html.parser`` de la
librería estándar para que el rastreo nunca dependa de un extra opcional.
"""
import re
from datetime import datetime
from typing import Dict, List
from urllib.parse import urljoin

from crawler.transport import content_fingerprint, domain_of, is_onion, normalize_url

try:  # pragma: no cover - depende del entorno
    from bs4 import BeautifulSoup
    _PARSER = 'lxml'
    try:
        import lxml  # noqa: F401
    except ImportError:
        _PARSER = 'html.parser'
except ImportError:  # pragma: no cover
    BeautifulSoup = None
    _PARSER = 'html.parser'

SKIP_SCHEMES = ('javascript:', 'mailto:', 'tel:', 'data:', '#', 'magnet:')
MAX_CONTENT_CHARS = 20_000


def _clean_text(text: str) -> str:
    text = re.sub(r'\s+', ' ', text or '').strip()
    return text[:MAX_CONTENT_CHARS]


def extract(html: str, url: str) -> Dict:
    """Devuelve título, descripción, texto y enlaces onion de una página."""
    url = normalize_url(url)
    title, description, text = '', '', ''
    links: List[str] = []

    if BeautifulSoup is not None:
        soup = BeautifulSoup(html or '', _PARSER)

        if soup.title and soup.title.get_text(strip=True):
            title = soup.title.get_text(strip=True)

        meta = soup.find('meta', attrs={'name': 'description'})
        if meta and meta.get('content'):
            description = meta['content'].strip()
        if not description:
            meta_og = soup.find('meta', attrs={'property': 'og:description'})
            if meta_og and meta_og.get('content'):
                description = meta_og['content'].strip()

        for tag in soup(['script', 'style', 'noscript', 'template', 'svg']):
            tag.decompose()

        for anchor in soup.find_all('a', href=True):
            href = (anchor['href'] or '').strip()
            if not href or href.lower().startswith(SKIP_SCHEMES):
                continue
            absolute = normalize_url(urljoin(url, href))
            if is_onion(absolute) and absolute not in links:
                links.append(absolute)

        text = soup.get_text(separator=' ', strip=True)
    else:  # pragma: no cover - fallback sin BeautifulSoup
        title_match = re.search(r'<title[^>]*>(.*?)</title>', html or '',
                                re.I | re.S)
        if title_match:
            title = re.sub(r'<[^>]+>', '', title_match.group(1)).strip()
        desc_match = re.search(
            r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']',
            html or '', re.I | re.S)
        if desc_match:
            description = desc_match.group(1).strip()
        for href in re.findall(r'<a[^>]+href=["\']([^"\']+)["\']', html or '',
                               re.I):
            if href.lower().startswith(SKIP_SCHEMES):
                continue
            absolute = normalize_url(urljoin(url, href))
            if is_onion(absolute) and absolute not in links:
                links.append(absolute)
        text = re.sub(r'<[^>]+>', ' ', html or '')

    text = _clean_text(text)
    title = _clean_text(title) or domain_of(url)
    description = _clean_text(description)[:400]

    return {
        'url': url,
        'domain': domain_of(url),
        'title': title[:400],
        'description': description or text[:200],
        'content': text,
        'content_hash': content_fingerprint(text),
        'links': links,
        'crawled_at': datetime.utcnow().isoformat(),
    }
