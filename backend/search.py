"""
Motor de búsqueda de FARO.

Usa Meilisearch cuando está disponible y cae a un motor local sobre la base
de datos (título > descripción > contenido) cuando no lo está. El ranking
siempre premia los servicios en línea y con mejor uptime, porque en la red
onion la disponibilidad es parte de la relevancia.
"""
import re
import time
from typing import Dict, List, Optional

from sqlalchemy import and_, case, func, or_

from db.models import OnionSite
from indexer.meili_client import MeiliIndexer

WORDS_RE = re.compile(r'[^\wáéíóúüñÁÉÍÓÚÜÑ]+', re.UNICODE)
STOPWORDS = {
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'pero',
    'de', 'del', 'en', 'con', 'por', 'para', 'que', 'al', 'se', 'su', 'the',
    'a', 'an', 'and', 'or', 'of', 'to', 'for',
}


def normalize_terms(query: str) -> List[str]:
    terms = [t for t in WORDS_RE.split(query.lower()) if t]
    useful = [t for t in terms if t not in STOPWORDS and len(t) > 1]
    return useful or terms


def _score_expression(terms: List[str]):
    score = None
    for term in terms:
        pattern = f'%{term}%'
        weight = case(
            (OnionSite.title.ilike(pattern), 5),
            (OnionSite.description.ilike(pattern), 2),
            (OnionSite.content.ilike(pattern), 1),
            else_=0,
        )
        score = weight if score is None else score + weight
    return score


def _local_search(
    db,
    query: str,
    category: Optional[str],
    status: str,
    sort: str,
    offset: int,
    limit: int,
) -> Dict:
    base = db.query(OnionSite).filter(OnionSite.is_blocked.is_(False))
    if category:
        base = base.filter(OnionSite.category == category)

    terms = normalize_terms(query)
    if terms:
        conditions = []
        for term in terms:
            pattern = f'%{term}%'
            conditions.append(or_(
                OnionSite.title.ilike(pattern),
                OnionSite.description.ilike(pattern),
                OnionSite.content.ilike(pattern),
                OnionSite.url.ilike(pattern),
            ))
        scored = base.filter(and_(*conditions))
        score = _score_expression(terms)
        scored = scored.add_columns(score.label('score'))
    else:
        scored = base.add_columns(case((OnionSite.id.isnot(None), 0)).label('score'))

    if status == 'online':
        scored = scored.filter(OnionSite.online.is_(True))
    elif status == 'offline':
        scored = scored.filter(OnionSite.online.is_(False))

    total = scored.count()

    if sort == 'uptime':
        order = (OnionSite.online.desc(), OnionSite.uptime_ratio.desc())
        rows = scored.order_by(*order).offset(offset).limit(limit).all()
    elif sort == 'latencia':
        order = (OnionSite.online.desc(), OnionSite.avg_response_time.asc().nulls_last())
        rows = scored.order_by(*order).offset(offset).limit(limit).all()
    elif sort == 'reciente':
        order = (OnionSite.last_crawled.desc().nulls_last(),)
        rows = scored.order_by(*order).offset(offset).limit(limit).all()
    else:  # relevancia
        order = (
            func.coalesce(score, 0).desc() if terms else OnionSite.uptime_ratio.desc(),
            OnionSite.online.desc(),
            OnionSite.uptime_ratio.desc(),
        )
        rows = scored.order_by(*order).offset(offset).limit(limit).all()

    hits = []
    for row in rows:
        site = row if isinstance(row, OnionSite) else row[0]
        hits.append({
            'url': site.url,
            'title': site.title,
            'description': site.description,
            'category': site.category,
            'uptime_ratio': site.uptime_ratio,
            'avg_response_time': site.avg_response_time,
            'online': site.online,
            'last_checked': site.last_checked,
            'domain': site.url.replace('http://', '').replace('https://', '').strip('/'),
        })
    return {'hits': hits, 'estimatedTotalHits': total, 'engine': 'local'}


def search_sites(
    db,
    meili: MeiliIndexer,
    query: str = '',
    category: Optional[str] = None,
    status: str = 'todos',
    sort: str = 'relevancia',
    page: int = 1,
    per_page: int = 12,
) -> Dict:
    started = time.perf_counter()
    offset = (page - 1) * per_page

    result = None
    engine = 'local'

    meili_hits = []
    if query.strip() and sort == 'relevancia' and meili.available:
        filters = []
        if category:
            filters.append(f'category = "{category}"')
        meili_results = meili.search(
            query=query,
            filters=' AND '.join(filters) if filters else None,
            limit=per_page,
            offset=offset,
        )
        meili_hits = meili_results.get('hits', [])
        if meili_hits:
            engine = 'meilisearch'
            urls = [h.get('url') for h in meili_hits]
            sites = {
                s.url: s for s in db.query(OnionSite)
                .filter(OnionSite.url.in_(urls))
                .filter(OnionSite.is_blocked.is_(False))
                .all()
            }
            hits = []
            for hit in meili_hits:
                site = sites.get(hit.get('url'))
                if site is None:
                    continue
                if status == 'online' and not site.online:
                    continue
                if status == 'offline' and site.online:
                    continue
                hits.append({
                    'url': site.url,
                    'title': site.title,
                    'description': site.description,
                    'category': site.category,
                    'uptime_ratio': site.uptime_ratio,
                    'avg_response_time': site.avg_response_time,
                    'online': site.online,
                    'last_checked': site.last_checked,
                    'domain': site.url.replace('http://', '').strip('/'),
                })
            result = {
                'hits': hits,
                'estimatedTotalHits': meili_results.get('estimatedTotalHits', len(hits)),
                'engine': 'meilisearch',
            }

    if result is None:
        result = _local_search(
            db, query, category, status, sort, offset, per_page
        )

    total = result['estimatedTotalHits']
    pages = max(1, (total + per_page - 1) // per_page)
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    return {
        'results': result['hits'],
        'total': total,
        'page': page,
        'pages': pages,
        'per_page': per_page,
        'engine': result['engine'],
        'elapsed_ms': elapsed_ms,
    }


def global_stats(db, meili: MeiliIndexer) -> Dict:
    total = db.query(OnionSite).count()
    online = db.query(OnionSite).filter(OnionSite.online.is_(True)).count()
    blocked = db.query(OnionSite).filter(OnionSite.is_blocked.is_(True)).count()
    avg_uptime = db.query(func.avg(OnionSite.uptime_ratio)).filter(
        OnionSite.uptime_ratio > 0
    ).scalar() or 0.0
    avg_latency = db.query(func.avg(OnionSite.avg_response_time)).filter(
        OnionSite.online.is_(True), OnionSite.avg_response_time.isnot(None)
    ).scalar()
    last_check = db.query(func.max(OnionSite.last_checked)).scalar()
    last_crawl = db.query(func.max(OnionSite.last_crawled)).scalar()

    try:
        indexed = meili.get_stats().get('numberOfDocuments', 0) if meili.available else 0
    except Exception:
        indexed = 0
    if not indexed:
        indexed = total

    rows = (
        db.query(OnionSite.category, func.count(OnionSite.id))
        .filter(OnionSite.is_blocked.is_(False))
        .group_by(OnionSite.category)
        .order_by(func.count(OnionSite.id).desc())
        .all()
    )
    categories = [
        {'name': name or 'Sin categoría', 'count': count}
        for name, count in rows
        if count
    ]

    return {
        'total': total,
        'online': online,
        'offline': max(0, total - online),
        'blocked': blocked,
        'avg_uptime': round((avg_uptime or 0) * 100),
        'avg_latency': round(avg_latency, 2) if avg_latency else None,
        'last_check': last_check,
        'last_crawl': last_crawl,
        'indexed_documents': indexed,
        'categories': categories,
    }
