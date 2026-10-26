"""
FARO — portal de búsqueda para servicios .onion.

Un solo proceso FastAPI que sirve la interfaz pública (Jinja2) y la API JSON,
más el centro de mando protegido en /admin.
"""
import hashlib
import hmac
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime
from urllib.parse import quote_plus
from typing import List, Optional

from fastapi import (
    BackgroundTasks, Depends, FastAPI, Form, HTTPException, Query, Request,
)
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy import desc, func, or_

from backend.search import global_stats, search_sites
from db.database import SessionLocal, get_db, init_db
from db.models import Blocklist, OnionSite, SiteCheck, SiteReport
from db.seed import seed_demo_data
from indexer.meili_client import create_indexer

APP_NAME = 'FARO'
APP_VERSION = '1.0.0'
ADMIN_TOKEN = os.getenv('ADMIN_TOKEN', 'admin-secret-token')
CRAWL_MODE = os.getenv('CRAWL_MODE', 'sim')
DEMO_MODE = CRAWL_MODE != 'live'
ONION_RE = re.compile(r'^[a-z2-7]{16,56}\.onion$')
REPORT_REASONS = [
    ('caido', 'No responde'),
    ('phishing', 'Phishing o suplantación'),
    ('espejo_falso', 'Espejo falso'),
    ('contenido_ilegal', 'Contenido ilegal'),
    ('otro', 'Otro'),
]


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _token_ok(candidate: Optional[str]) -> bool:
    """Comparación en tiempo constante del token de administración."""
    if not candidate:
        return False
    return hmac.compare_digest(_hash(candidate), _hash(ADMIN_TOKEN))


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    if os.getenv('FARO_SEED', '1') == '1':
        seed_demo_data()
    yield


app = FastAPI(
    title='FARO · motor de búsqueda onion',
    description='Buscador para servicios .onion con verificación de salud y uptime.',
    version=APP_VERSION,
    lifespan=lifespan,
)

app.mount('/static', StaticFiles(directory='backend/static'), name='static')
templates = Jinja2Templates(directory='backend/templates')

meili = create_indexer()


# ==================== HELPERS DE VISTA ====================

def domain_of(url: str) -> str:
    return url.replace('http://', '').replace('https://', '').strip('/')


def time_ago(value: Optional[datetime]) -> str:
    if not value:
        return 'nunca'
    delta = datetime.utcnow() - value
    seconds = int(delta.total_seconds())
    if seconds < 60:
        return 'hace instantes'
    if seconds < 3600:
        return f'hace {seconds // 60} min'
    if seconds < 86400:
        return f'hace {seconds // 3600} h'
    return f'hace {seconds // 86400} d'


templates.env.filters['timeago'] = time_ago
templates.env.globals.update(
    app_name=APP_NAME,
    app_version=APP_VERSION,
    demo_mode=DEMO_MODE,
    report_reasons=REPORT_REASONS,
)


def ctx(request: Request, **kwargs) -> dict:
    base = {
        'request': request,
        'app_name': APP_NAME,
        'app_version': APP_VERSION,
        'demo_mode': DEMO_MODE,
        'report_reasons': REPORT_REASONS,
        'nav': '',
    }
    base.update(kwargs)
    return base


def site_to_dict(site: OnionSite) -> dict:
    return {
        'url': site.url,
        'domain': domain_of(site.url),
        'title': site.title,
        'description': site.description,
        'category': site.category,
        'uptime_ratio': site.uptime_ratio,
        'avg_response_time': site.avg_response_time,
        'online': site.online,
        'last_checked': site.last_checked,
        'is_mirror': site.is_mirror,
    }


# ==================== AUTENTICACIÓN ====================

def verify_admin(request: Request):
    """Token de admin en cookie o header X-Admin-Token."""
    token = request.cookies.get('admin_token') or request.headers.get('X-Admin-Token')
    if not _token_ok(token):
        raise HTTPException(status_code=401, detail='No autorizado')
    return True


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if exc.status_code == 401:
        if request.url.path.startswith('/api'):
            return JSONResponse({'detail': 'No autorizado'}, status_code=401)
        return RedirectResponse(url='/admin/login?next=' + request.url.path, status_code=302)
    if exc.status_code == 404 and not request.url.path.startswith('/api'):
        return templates.TemplateResponse(request, 'error.html',
            ctx(request, code=404, title='Nodo no encontrado',
                message='Esa dirección no está en el índice de FARO.'),
            status_code=404,
        )
    return JSONResponse({'detail': exc.detail}, status_code=exc.status_code)


# ==================== MODELOS API ====================

class SearchResult(BaseModel):
    url: str
    domain: str
    title: str
    description: Optional[str] = None
    category: Optional[str] = None
    uptime_ratio: float
    avg_response_time: Optional[float] = None
    last_checked: Optional[datetime] = None
    online: bool


class SearchResponse(BaseModel):
    query: str
    page: int
    total: int
    pages: int
    engine: str
    elapsed_ms: int
    results: List[SearchResult]


# ==================== PORTAL PÚBLICO ====================

@app.get('/', response_class=HTMLResponse)
async def home(request: Request):
    with get_db() as db:
        stats = global_stats(db, meili)
        destacados = (
            db.query(OnionSite)
            .filter(OnionSite.is_blocked.is_(False), OnionSite.online.is_(True))
            .order_by(desc(OnionSite.uptime_ratio), OnionSite.avg_response_time.asc())
            .limit(6)
            .all()
        )
        recientes = (
            db.query(OnionSite)
            .filter(OnionSite.is_blocked.is_(False))
            .order_by(desc(OnionSite.last_checked))
            .limit(5)
            .all()
        )
    return templates.TemplateResponse(request, 'search.html', ctx(
        request,
        query='',
        searcher=False,
        stats=stats,
        categories=stats['categories'],
        destacados=[site_to_dict(s) for s in destacados],
        recientes=[site_to_dict(s) for s in recientes],
        filters={'category': '', 'status': 'todos', 'sort': 'relevancia'},
    ))


@app.get('/search', response_class=HTMLResponse)
async def search_html(
    request: Request,
    q: str = Query(default=''),
    category: str = Query(default=''),
    status: str = Query(default='todos'),
    sort: str = Query(default='relevancia'),
    page: int = Query(default=1, ge=1),
):
    q = q.strip()[:120]
    with get_db() as db:
        stats = global_stats(db, meili)
        result = search_sites(
            db, meili, query=q, category=category or None,
            status=status, sort=sort, page=page,
        )
    return templates.TemplateResponse(request, 'search.html', ctx(
        request,
        nav='search',
        query=q,
        searcher=True,
        stats=stats,
        categories=stats['categories'],
        results=result['results'],
        total=result['total'],
        page=result['page'],
        pages=result['pages'],
        engine=result['engine'],
        elapsed_ms=result['elapsed_ms'],
        filters={'category': category, 'status': status, 'sort': sort},
    ))


@app.get('/directorio', response_class=HTMLResponse)
async def directorio(request: Request, category: str = Query(default='')):
    with get_db() as db:
        stats = global_stats(db, meili)
        query = db.query(OnionSite).filter(OnionSite.is_blocked.is_(False))
        if category:
            query = query.filter(OnionSite.category == category)
        sites = query.order_by(
            OnionSite.category.asc(),
            desc(OnionSite.uptime_ratio),
        ).limit(300).all()
        grouped = {}
        for site in sites:
            grouped.setdefault(site.category or 'Sin categoría', []).append(site)
    return templates.TemplateResponse(request, 'directorio.html', ctx(
        request,
        nav='directorio',
        stats=stats,
        categories=stats['categories'],
        grouped=grouped,
        active_category=category,
    ))


@app.get('/estado', response_class=HTMLResponse)
async def estado(request: Request):
    with get_db() as db:
        stats = global_stats(db, meili)
        caidos = (
            db.query(OnionSite)
            .filter(OnionSite.is_blocked.is_(False), OnionSite.online.is_(False))
            .order_by(desc(OnionSite.last_checked))
            .limit(12)
            .all()
        )
        lentos = (
            db.query(OnionSite)
            .filter(OnionSite.is_blocked.is_(False), OnionSite.online.is_(True),
                    OnionSite.avg_response_time.isnot(None))
            .order_by(desc(OnionSite.avg_response_time))
            .limit(6)
            .all()
        )
        recientes = db.query(SiteCheck).order_by(desc(SiteCheck.checked_at)).limit(14).all()
        domains = {
            s.id: domain_of(s.url)
            for s in db.query(OnionSite).filter(
                OnionSite.id.in_([c.site_id for c in recientes] or [0])
            ).all()
        }
    return templates.TemplateResponse(request, 'estado.html', ctx(
        request,
        nav='estado',
        stats=stats,
        caidos=[site_to_dict(s) for s in caidos],
        lentos=[site_to_dict(s) for s in lentos],
        checks=recientes,
        domains=domains,
        meili_online=meili.available,
    ))


@app.get('/azar')
async def random_site():
    """Lleva a un nodo en línea al azar."""
    import random
    with get_db() as db:
        sites = (
            db.query(OnionSite)
            .filter(OnionSite.is_blocked.is_(False), OnionSite.online.is_(True))
            .all()
        )
    if not sites:
        return RedirectResponse(url='/directorio', status_code=303)
    return RedirectResponse(
        url=f'/sitio/{domain_of(random.choice(sites).url)}', status_code=303
    )


@app.get('/sitio/{domain}', response_class=HTMLResponse)
async def site_detail(request: Request, domain: str, reportado: int = 0):
    domain = domain.strip().lower()
    if '.' not in domain:
        domain = f'{domain}.onion'
    url = f'http://{domain}'
    with get_db() as db:
        site = db.query(OnionSite).filter(OnionSite.url == url).first()
        if site is None:
            raise HTTPException(status_code=404)

        checks = (
            db.query(SiteCheck)
            .filter(SiteCheck.site_id == site.id)
            .order_by(desc(SiteCheck.checked_at))
            .limit(30)
            .all()
        )[::-1]

        mirrors = (
            db.query(OnionSite)
            .filter(OnionSite.content_hash == site.content_hash, OnionSite.id != site.id)
            .all()
        )

        related = (
            db.query(OnionSite)
            .filter(
                OnionSite.category == site.category,
                OnionSite.id != site.id,
                OnionSite.is_blocked.is_(False),
            )
            .order_by(desc(OnionSite.uptime_ratio))
            .limit(5)
            .all()
        )
        reports = (
            db.query(SiteReport)
            .filter(SiteReport.url == site.url)
            .order_by(desc(SiteReport.created_at))
            .limit(5)
            .all()
        )
        stats = global_stats(db, meili)

    return templates.TemplateResponse(request, 'sitio.html', ctx(
        request,
        nav=site.category or 'directorio',
        site=site_to_dict(site),
        site_obj=site,
        checks=checks,
        mirrors=[site_to_dict(s) for s in mirrors],
        related=[site_to_dict(s) for s in related],
        reports=reports,
        stats=stats,
        reportado=bool(reportado),
    ))


@app.post('/sitio/{domain}/reportar')
async def site_report(
    domain: str,
    reason: str = Form(default='otro'),
    details: str = Form(default=''),
):
    domain = domain.strip().lower()
    if '.' not in domain:
        domain = f'{domain}.onion'
    url = f'http://{domain}'
    valid_reasons = {key for key, _ in REPORT_REASONS}
    if reason not in valid_reasons:
        reason = 'otro'

    with get_db() as db:
        site = db.query(OnionSite).filter(OnionSite.url == url).first()
        db.add(SiteReport(
            site_id=site.id if site else None,
            url=url,
            reason=reason,
            details=(details or '').strip()[:2000] or None,
            status='pendiente',
        ))
    return RedirectResponse(url=f'/sitio/{domain}?reportado=1#reportar', status_code=303)


@app.get('/api', response_class=HTMLResponse)
async def api_docs(request: Request):
    with get_db() as db:
        stats = global_stats(db, meili)
    return templates.TemplateResponse(request, 'api.html', ctx(
        request, nav='api', stats=stats,
    ))


# ==================== API PÚBLICA ====================

@app.get('/api/search', response_model=SearchResponse)
async def search_api(
    q: str = Query(...),
    category: str = Query(default=''),
    status: str = Query(default='todos'),
    sort: str = Query(default='relevancia'),
    page: int = Query(default=1, ge=1),
):
    with get_db() as db:
        result = search_sites(
            db, meili, query=q.strip()[:120], category=category or None,
            status=status, sort=sort, page=page,
        )
    return SearchResponse(
        query=q,
        page=result['page'],
        total=result['total'],
        pages=result['pages'],
        engine=result['engine'],
        elapsed_ms=result['elapsed_ms'],
        results=[SearchResult(**hit) for hit in result['results']],
    )


@app.get('/api/stats')
async def stats_api():
    with get_db() as db:
        stats = global_stats(db, meili)
    return {
        'generated_at': datetime.utcnow().isoformat(),
        'sites': stats['total'],
        'online': stats['online'],
        'avg_uptime': stats['avg_uptime'],
        'indexed_documents': stats['indexed_documents'],
        'engine': 'meilisearch' if meili.available else 'local',
        'categories': stats['categories'],
    }


@app.get('/api/sites')
async def sites_api(category: str = Query(default=''), limit: int = Query(default=25, le=100)):
    with get_db() as db:
        query = db.query(OnionSite).filter(OnionSite.is_blocked.is_(False))
        if category:
            query = query.filter(OnionSite.category == category)
        sites = query.order_by(desc(OnionSite.uptime_ratio)).limit(limit).all()
    return {'total': len(sites), 'results': [site_to_dict(s) for s in sites]}


@app.get('/health')
async def health():
    return {
        'status': 'healthy',
        'service': 'faro',
        'version': APP_VERSION,
        'timestamp': datetime.utcnow().isoformat(),
        'meilisearch': meili.available,
        'mode': CRAWL_MODE,
    }


# ==================== CENTRO DE MANDO ====================

@app.get('/admin/login', response_class=HTMLResponse)
async def admin_login(request: Request, next: str = Query(default='/admin')):
    return templates.TemplateResponse(request, 'admin_login.html', ctx(
        request, nav='admin', error=None, next=next,
    ))


@app.post('/admin/login')
async def admin_login_post(
    request: Request,
    token: str = Form(...),
    next: str = Form(default='/admin'),
):
    if _token_ok(token):
        target = next if next.startswith('/admin') else '/admin'
        response = RedirectResponse(url=target, status_code=303)
        response.set_cookie(
            key='admin_token', value=token, httponly=True, samesite='lax',
            secure=os.getenv('SECURE_COOKIES', 'false').lower() == 'true',
            max_age=3600 * 8,
        )
        return response
    return templates.TemplateResponse(request, 'admin_login.html', ctx(
        request, nav='admin', error='Token inválido. Verificá el valor de ADMIN_TOKEN.',
        next=next,
    ), status_code=401)


@app.get('/admin/logout')
async def admin_logout():
    response = RedirectResponse(url='/', status_code=303)
    response.delete_cookie('admin_token')
    return response


@app.get('/admin', response_class=HTMLResponse)
async def admin_dashboard(request: Request, _: bool = Depends(verify_admin)):
    with get_db() as db:
        stats = global_stats(db, meili)
        pending_reports = (
            db.query(SiteReport).filter(SiteReport.status == 'pendiente').count()
        )
        top = (
            db.query(OnionSite)
            .filter(OnionSite.is_blocked.is_(False))
            .order_by(desc(OnionSite.uptime_ratio))
            .limit(6)
            .all()
        )
        caidos = (
            db.query(OnionSite)
            .filter(OnionSite.online.is_(False), OnionSite.is_blocked.is_(False))
            .order_by(desc(OnionSite.last_checked))
            .limit(5)
            .all()
        )
        pendientes = (
            db.query(SiteReport)
            .filter(SiteReport.status == 'pendiente')
            .order_by(desc(SiteReport.created_at))
            .limit(5)
            .all()
        )
        reportes_total = db.query(SiteReport).filter(SiteReport.status == 'pendiente').count()
        bloqueados = db.query(Blocklist).count()
    return templates.TemplateResponse(request, 'admin_dashboard.html', ctx(
        request, nav='admin', admin_nav='dashboard', stats=stats,
        top=[site_to_dict(s) for s in top],
        caidos=[site_to_dict(s) for s in caidos],
        pendientes=pendientes,
        reportes_total=reportes_total,
        pending_reports=pending_reports,
        bloqueados=bloqueados,
        meili_online=meili.available,
    ))


@app.get('/admin/sites', response_class=HTMLResponse)
async def admin_sites(
    request: Request,
    _: bool = Depends(verify_admin),
    page: int = Query(default=1, ge=1),
    search: str = Query(default=''),
    status: str = Query(default='todos'),
    category: str = Query(default=''),
):
    with get_db() as db:
        query = db.query(OnionSite)
        if search:
            like = f'%{search.strip()}%'
            query = query.filter(or_(
                OnionSite.title.ilike(like),
                OnionSite.url.ilike(like),
                OnionSite.description.ilike(like),
            ))
        if status == 'online':
            query = query.filter(OnionSite.online.is_(True))
        elif status == 'offline':
            query = query.filter(OnionSite.online.is_(False))
        elif status == 'bloqueados':
            query = query.filter(OnionSite.is_blocked.is_(True))
        if category:
            query = query.filter(OnionSite.category == category)

        total = query.count()
        sites = (
            query.order_by(desc(OnionSite.last_checked))
            .offset((page - 1) * 25).limit(25).all()
        )
        stats = global_stats(db, meili)
        pending_reports = (
            db.query(SiteReport).filter(SiteReport.status == 'pendiente').count()
        )

    return templates.TemplateResponse(request, 'admin_sites.html', ctx(
        request, nav='admin', admin_nav='sites', sites=sites, page=page,
        total=total, pages=max(1, (total + 24) // 25), search=search,
        status=status, category=category, stats=stats,
        pending_reports=pending_reports,
    ))


@app.post('/admin/sites/{site_id}/bloquear')
async def admin_block_site(
    site_id: int,
    reason: str = Form(default='Bloqueo manual desde el panel'),
    _: bool = Depends(verify_admin),
):
    with get_db() as db:
        site = db.query(OnionSite).filter(OnionSite.id == site_id).first()
        if site:
            site.is_blocked = True
            site.block_reason = reason[:255]
            if not db.query(Blocklist).filter(Blocklist.url == site.url).first():
                db.add(Blocklist(url=site.url, reason=reason[:255]))
    return RedirectResponse(url='/admin/sites', status_code=303)


@app.post('/admin/sites/{site_id}/desbloquear')
async def admin_unblock_site(site_id: int, _: bool = Depends(verify_admin)):
    with get_db() as db:
        site = db.query(OnionSite).filter(OnionSite.id == site_id).first()
        if site:
            site.is_blocked = False
            site.block_reason = None
            entry = db.query(Blocklist).filter(Blocklist.url == site.url).first()
            if entry:
                db.delete(entry)
    return RedirectResponse(url='/admin/sites', status_code=303)


@app.get('/admin/blocklist', response_class=HTMLResponse)
async def admin_blocklist(request: Request, _: bool = Depends(verify_admin)):
    with get_db() as db:
        blocked = db.query(Blocklist).order_by(desc(Blocklist.added_at)).all()
        stats = global_stats(db, meili)
        pending_reports = (
            db.query(SiteReport).filter(SiteReport.status == 'pendiente').count()
        )
    return templates.TemplateResponse(request, 'admin_blocklist.html', ctx(
        request, nav='admin', admin_nav='blocklist', blocked=blocked, stats=stats,
        message=None, error=None, pending_reports=pending_reports,
    ))


@app.post('/admin/blocklist/add')
async def admin_blocklist_add(
    request: Request,
    url: str = Form(...),
    reason: str = Form(default='Bloqueo manual'),
    _: bool = Depends(verify_admin),
):
    url = url.strip().lower()
    if not url.startswith('http'):
        url = 'http://' + url.replace('https://', '')
    domain = domain_of(url)
    if not ONION_RE.match(domain):
        with get_db() as db:
            blocked = db.query(Blocklist).order_by(desc(Blocklist.added_at)).all()
            stats = global_stats(db, meili)
        return templates.TemplateResponse(request, 'admin_blocklist.html', ctx(
            request, nav='admin', admin_nav='blocklist', blocked=blocked,
            stats=stats, message=None,
            error='Dirección inválida: se espera una dirección .onion v3.',
        ), status_code=400)

    with get_db() as db:
        if not db.query(Blocklist).filter(Blocklist.url == url).first():
            db.add(Blocklist(url=url, reason=reason[:255] or 'Bloqueo manual'))
        site = db.query(OnionSite).filter(OnionSite.url == url).first()
        if site:
            site.is_blocked = True
            site.block_reason = reason[:255]
    return RedirectResponse(url='/admin/blocklist', status_code=303)


@app.post('/admin/blocklist/remove/{block_id}')
async def admin_blocklist_remove(block_id: int, _: bool = Depends(verify_admin)):
    with get_db() as db:
        block = db.query(Blocklist).filter(Blocklist.id == block_id).first()
        if block:
            site = db.query(OnionSite).filter(OnionSite.url == block.url).first()
            if site:
                site.is_blocked = False
                site.block_reason = None
            db.delete(block)
    return RedirectResponse(url='/admin/blocklist', status_code=303)


@app.get('/admin/reports', response_class=HTMLResponse)
async def admin_reports(request: Request, _: bool = Depends(verify_admin)):
    with get_db() as db:
        reports = db.query(SiteReport).order_by(desc(SiteReport.created_at)).limit(100).all()
        stats = global_stats(db, meili)
        pending_reports = (
            db.query(SiteReport).filter(SiteReport.status == 'pendiente').count()
        )
    return templates.TemplateResponse(request, 'admin_reports.html', ctx(
        request, nav='admin', admin_nav='reports', reports=reports, stats=stats,
        pending_reports=pending_reports,
    ))


@app.post('/admin/reports/{report_id}/{action}')
async def admin_report_action(
    report_id: int,
    action: str,
    _: bool = Depends(verify_admin),
):
    if action not in {'bloquear', 'descartar'}:
        raise HTTPException(status_code=400, detail='Acción inválida')
    with get_db() as db:
        report = db.query(SiteReport).filter(SiteReport.id == report_id).first()
        if report:
            report.status = 'resuelto' if action == 'bloquear' else 'descartado'
            if action == 'bloquear':
                site = db.query(OnionSite).filter(OnionSite.url == report.url).first()
                if site:
                    site.is_blocked = True
                    site.block_reason = f'Reporte: {report.reason}'
                if not db.query(Blocklist).filter(Blocklist.url == report.url).first():
                    db.add(Blocklist(url=report.url, reason=f'Reporte: {report.reason}'))
    return RedirectResponse(url='/admin/reports', status_code=303)


@app.get('/admin/actions', response_class=HTMLResponse)
async def admin_actions(
    request: Request,
    msg: str = Query(default=''),
    _: bool = Depends(verify_admin),
):
    with get_db() as db:
        stats = global_stats(db, meili)
        pending_reports = (
            db.query(SiteReport).filter(SiteReport.status == 'pendiente').count()
        )
    return templates.TemplateResponse(request, 'admin_actions.html', ctx(
        request, nav='admin', admin_nav='actions', stats=stats, message=msg or None,
        meili_online=meili.available, pending_reports=pending_reports,
    ))


def _refresh_health_demo(limit: int = 40):
    """Chequeo de salud simulado sobre el índice (sin Tor)."""
    import random
    rng = random.Random(int(datetime.utcnow().timestamp()))
    with SessionLocal() as db:
        sites = db.query(OnionSite).filter(OnionSite.is_blocked.is_(False)).limit(limit).all()
        for site in sites:
            online = rng.random() < max(0.15, site.uptime_ratio)
            latency = round(rng.uniform(0.3, 4.5), 2) if online else None
            site.update_uptime(online, latency)
            db.add(SiteCheck(
                site_id=site.id, online=online, response_time=latency,
                status_code=200 if online else 0,
            ))
        db.commit()


def _reindex():
    with SessionLocal() as db:
        sites = db.query(OnionSite).filter(OnionSite.is_blocked.is_(False)).all()
        docs = [{
            'url': s.url,
            'title': s.title,
            'description': s.description,
            'content': s.content,
            'content_hash': s.content_hash,
            'category': s.category,
            'crawled_at': (s.last_crawled or s.first_crawled).isoformat()
            if (s.last_crawled or s.first_crawled) else None,
        } for s in sites]
        if docs:
            meili.add_or_update_documents(docs)


@app.post('/admin/actions/force-health-check')
async def admin_force_health_check(
    background: BackgroundTasks,
    _: bool = Depends(verify_admin),
):
    background.add_task(_refresh_health_demo)
    return RedirectResponse(
        url='/admin/actions?msg=Chequeo+de+salud+iniciado+en+segundo+plano',
        status_code=303,
    )


@app.post('/admin/actions/force-crawl')
async def admin_force_crawl(
    request: Request,
    background: BackgroundTasks,
    _: bool = Depends(verify_admin),
):
    if DEMO_MODE:
        background.add_task(_refresh_health_demo)
        msg = 'Modo demo: se refrescó la salud del índice (el rastreo real requiere Tor)'
    else:
        msg = 'Rastreo encolado: el crawler corre por el proxy Tor configurado'
    return RedirectResponse(url='/admin/actions?msg=' + quote_plus(msg), status_code=303)


@app.post('/admin/actions/reindex')
async def admin_reindex(background: BackgroundTasks, _: bool = Depends(verify_admin)):
    background.add_task(_reindex)
    return RedirectResponse(
        url='/admin/actions?msg=Reindexado+de+Meilisearch+en+segundo+plano',
        status_code=303,
    )


@app.post('/admin/actions/seed')
async def admin_seed(_: bool = Depends(verify_admin)):
    created = seed_demo_data()
    return RedirectResponse(
        url=f'/admin/actions?msg=Semilla+demo+cargada+({created}+nodos)',
        status_code=303,
    )
