"""
Backend API para el motor de búsqueda onion con admin dashboard profesional.
"""
import os
import hashlib
import hmac
from typing import List, Optional
from datetime import datetime, timedelta
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Query, HTTPException, Depends, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import or_, desc, func

from db.database import get_db, init_db
from db.models import OnionSite, Blocklist
from indexer.meili_client import create_indexer

# Admin token desde env.
# Sin default: si no está configurado, el dashboard queda bloqueado
# (antes caía a 'admin-secret-token' y cualquiera entraba).
ADMIN_TOKEN = os.getenv('ADMIN_TOKEN', '')

def _admin_token_configured() -> bool:
    return bool(ADMIN_TOKEN.strip())

# Inicializar app
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: inicializar DB
    init_db()
    yield
    # Shutdown: cleanup si hace falta

app = FastAPI(
    title="Onion Search API",
    description="Motor de búsqueda para la red Tor (.onion)",
    version="1.0.0",
    lifespan=lifespan
)

# Templates y static
app.mount("/static", StaticFiles(directory="backend/static"), name="static")
templates = Jinja2Templates(directory="backend/templates")

# Meilisearch client
meili = create_indexer()


# ==================== AUTH ====================

def verify_admin(request: Request):
    """Verificar token de admin en cookie o header."""
    if not _admin_token_configured():
        raise HTTPException(status_code=503, detail="ADMIN_TOKEN no configurado")
    
    token = request.cookies.get('admin_token') or request.headers.get('X-Admin-Token')
    
    if not token or not hmac.compare_digest(token.encode(), ADMIN_TOKEN.encode()):
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    return True


# ==================== MODELOS API ====================

class SearchResult(BaseModel):
    url: str
    title: str
    description: Optional[str]
    uptime_ratio: float
    avg_response_time: Optional[float]
    last_checked: datetime
    online: bool


class SearchResponse(BaseModel):
    query: str
    results: List[SearchResult]
    total: int
    page: int


class DashboardStats(BaseModel):
    total_sites: int
    online_sites: int
    offline_sites: int
    avg_uptime: float
    indexed_documents: int
    last_crawl: Optional[datetime]
    last_health_check: Optional[datetime]
    blocked_sites: int
    recent_reports: int


# ==================== ENDPOINTS PÚBLICOS ====================

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Interfaz pública de búsqueda."""
    return templates.TemplateResponse(
        request,
        "search.html",
        { "query": "", "results": [], "total": 0}
    )


@app.get("/search", response_class=HTMLResponse)
async def search_html(
    request: Request,
    q: str = Query(default=""),
    page: int = Query(default=1, ge=1),
    min_uptime: float = Query(default=0.0)
):
    """BÃºsqueda pÃºblica con interfaz."""
    if not q:
        return templates.TemplateResponse(
        request,
        "search.html",
        { "query": "", "results": [], "total": 0}
        )
    
    offset = (page - 1) * 20
    # Buscar un set amplio, ordenarlo por uptime y paginar encima
    # (ordenar después de paginar reordenaba solo el subconjunto de la página)
    meili_results = meili.search(query=q, limit=200, offset=0)
    hits = meili_results.get('hits', [])
    
    with get_db() as db:
        results = []
        for hit in hits:
            url = hit.get('url')
            db_site = db.query(OnionSite).filter(OnionSite.url == url).first()
            
            if db_site and db_site.uptime_ratio >= min_uptime:
                results.append({
                    'url': url,
                    'title': hit.get('title') or db_site.title,
                    'description': hit.get('description') or db_site.description,
                    'uptime_ratio': db_site.uptime_ratio,
                    'online': db_site.online,
                    'last_checked': db_site.last_checked
                })
        
        results.sort(key=lambda x: -x['uptime_ratio'])
        total = len(results)
        results = results[offset:offset + 20]
    
    return templates.TemplateResponse(
        request,
        "search.html",
        {
            "query": q,
            "results": results,
            "total": total,
            "page": page
        }
    )


@app.get("/api/search", response_model=SearchResponse)
async def search_api(
    q: str = Query(...),
    page: int = Query(default=1, ge=1),
    min_uptime: float = Query(default=0.0)
):
    """API de bÃºsqueda pÃºblica."""
    offset = (page - 1) * 20
    # Set amplio, orden global, luego paginación (igual que la vista HTML)
    meili_results = meili.search(query=q, limit=200, offset=0)
    hits = meili_results.get('hits', [])
    
    with get_db() as db:
        results = []
        for hit in hits:
            url = hit.get('url')
            db_site = db.query(OnionSite).filter(OnionSite.url == url).first()
            
            if db_site and db_site.uptime_ratio >= min_uptime:
                results.append(SearchResult(
                    url=url,
                    title=hit.get('title') or db_site.title,
                    description=hit.get('description'),
                    uptime_ratio=db_site.uptime_ratio,
                    avg_response_time=db_site.avg_response_time,
                    last_checked=db_site.last_checked or db_site.last_crawled,
                    online=db_site.online
                ))
        
        results.sort(key=lambda x: (-x.uptime_ratio, x.avg_response_time or 999))
        total = len(results)
        results = results[offset:offset + 20]
    
    return SearchResponse(query=q, results=results, total=total, page=page)


# ==================== ADMIN DASHBOARD ====================

@app.get("/admin/login", response_class=HTMLResponse)
async def admin_login(request: Request):
    """Login del admin dashboard."""
    return templates.TemplateResponse(
        request,
        "admin_login.html",
        { "error": None})


@app.post("/admin/login", response_class=RedirectResponse)
async def admin_login_post(request: Request, token: str = Form(...)):
    """Verificar login y redirigir al dashboard."""
    if _admin_token_configured() and hmac.compare_digest(token.encode(), ADMIN_TOKEN.encode()):
        response = RedirectResponse(url="/admin", status_code=302)
        response.set_cookie(
            key='admin_token', value=token, httponly=True,
            secure=os.getenv('SECURE_COOKIES', 'false').lower() == 'true',
            samesite='lax', max_age=3600
        )
        return response
    else:
        return templates.TemplateResponse(
        request,
        "admin_login.html",
        { "error": "Token invÃ¡lido"})


@app.get("/admin", response_class=HTMLResponse)
async def admin_dashboard(request: Request, _: bool = Depends(verify_admin)):
    """Dashboard principal con mÃ©tricas."""
    with get_db() as db:
        total = db.query(OnionSite).count()
        online = db.query(OnionSite).filter(OnionSite.online == True).count()
        offline = total - online
        
        sites_with_uptime = db.query(OnionSite).filter(OnionSite.uptime_ratio > 0).all()
        avg_uptime = sum(s.uptime_ratio for s in sites_with_uptime) / len(sites_with_uptime) if sites_with_uptime else 0.0
        
        last_crawl = db.query(OnionSite).order_by(desc(OnionSite.last_crawled)).first()
        last_check = db.query(OnionSite).order_by(desc(OnionSite.last_checked)).first()
        
        blocked = db.query(OnionSite).filter(OnionSite.is_blocked == True).count()
        
        try:
            meili_stats = meili.get_stats()
            indexed = getattr(meili_stats, 'number_of_documents', 0)
        except:
            indexed = 0
    
    stats = {
        'total_sites': total,
        'online_sites': online,
        'offline_sites': offline,
        'avg_uptime': round(avg_uptime * 100, 1),
        'indexed_documents': indexed,
        'last_crawl': last_crawl.last_crawled if last_crawl else None,
        'last_health_check': last_check.last_checked if last_check else None,
        'blocked_sites': blocked
    }
    
    return templates.TemplateResponse(
        request,
        "admin_dashboard.html",
        { "stats": stats}
    )


@app.get("/admin/sites", response_class=HTMLResponse)
async def admin_sites(
    request: Request,
    _: bool = Depends(verify_admin),
    page: int = Query(default=1),
    search: str = Query(default=""),
    status: str = Query(default="all")
):
    """Lista de sitios indexados."""
    with get_db() as db:
        query = db.query(OnionSite)
        
        if search:
            query = query.filter(
                or_(
                    OnionSite.title.ilike(f"%{search}%"),
                    OnionSite.url.ilike(f"%{search}%")
                )
            )
        
        if status == 'online':
            query = query.filter(OnionSite.online == True)
        elif status == 'offline':
            query = query.filter(OnionSite.online == False)
        
        sites = query.order_by(desc(OnionSite.last_crawled)).offset((page - 1) * 50).limit(50).all()
        total = query.count()
    
    return templates.TemplateResponse(
        request,
        "admin_sites.html",
        {
            "sites": sites,
            "page": page,
            "total": total,
            "search": search,
            "status": status
        }
    )


@app.get("/admin/blocklist", response_class=HTMLResponse)
async def admin_blocklist(request: Request, _: bool = Depends(verify_admin)):
    """GestiÃ³n de blocklist."""
    with get_db() as db:
        blocked = db.query(Blocklist).order_by(desc(Blocklist.added_at)).all()
    
    return templates.TemplateResponse(
        request,
        "admin_blocklist.html",
        { "blocked": blocked}
    )


@app.post("/admin/blocklist/add", response_class=RedirectResponse)
async def admin_blocklist_add(
    request: Request,
    _: bool = Depends(verify_admin),
    url: str = Form(...),
    reason: str = Form(default="Manual block")
):
    """Agregar URL a blocklist."""
    with get_db() as db:
        existing = db.query(Blocklist).filter(Blocklist.url == url).first()
        if not existing:
            block = Blocklist(url=url, reason=reason)
            db.add(block)
            db.commit()
    
    return RedirectResponse(url="/admin/blocklist", status_code=302)


@app.post("/admin/blocklist/remove/{block_id}", response_class=RedirectResponse)
async def admin_blocklist_remove(
    block_id: int,
    _: bool = Depends(verify_admin)
):
    """Eliminar de blocklist."""
    with get_db() as db:
        block = db.query(Blocklist).filter(Blocklist.id == block_id).first()
        if block:
            db.delete(block)
            db.commit()
    
    return RedirectResponse(url="/admin/blocklist", status_code=302)


@app.get("/admin/reports", response_class=HTMLResponse)
async def admin_reports(request: Request, _: bool = Depends(verify_admin)):
    """Reportes de usuarios (placeholder)."""
    return templates.TemplateResponse(
        request,
        "admin_reports.html",
        { "reports": []}
    )


@app.get("/admin/actions", response_class=HTMLResponse)
async def admin_actions(request: Request, _: bool = Depends(verify_admin)):
    """Acciones rÃ¡pidas: forzar crawl, health check."""
    return templates.TemplateResponse(
        request,
        "admin_actions.html",
        { "message": None}
    )


@app.post("/admin/actions/force-crawl", response_class=RedirectResponse)
async def admin_force_crawl(request: Request, _: bool = Depends(verify_admin)):
    """Forzar nuevo crawl (placeholder - implementar con cola de tareas)."""
    # TODO: Implementar con Redis queue o similar
    message = "Crawl iniciado (implementar cola de tareas)"
    return RedirectResponse(url="/admin/actions?msg=" + message, status_code=302)


@app.post("/admin/actions/force-health-check", response_class=RedirectResponse)
async def admin_force_health_check(request: Request, _: bool = Depends(verify_admin)):
    """Forzar health check inmediato."""
    # TODO: Implementar
    message = "Health check forzado iniciado"
    return RedirectResponse(url="/admin/actions?msg=" + message, status_code=302)


# ==================== API ADMIN ====================

@app.get("/api/admin/stats", response_model=DashboardStats)
async def api_admin_stats(_: bool = Depends(verify_admin)):
    """API con estadÃ¬sticas completas."""
    with get_db() as db:
        total = db.query(OnionSite).count()
        online = db.query(OnionSite).filter(OnionSite.online == True).count()
        
        sites_with_uptime = db.query(OnionSite).filter(OnionSite.uptime_ratio > 0).all()
        avg_uptime = sum(s.uptime_ratio for s in sites_with_uptime) / len(sites_with_uptime) if sites_with_uptime else 0.0
        
        last_crawl = db.query(OnionSite).order_by(desc(OnionSite.last_crawled)).first()
        last_check = db.query(OnionSite).order_by(desc(OnionSite.last_checked)).first()
        
        blocked = db.query(OnionSite).filter(OnionSite.is_blocked == True).count()
        
        try:
            meili_stats = meili.get_stats()
            indexed = getattr(meili_stats, 'number_of_documents', 0)
        except:
            indexed = 0
    
    return DashboardStats(
        total_sites=total,
        online_sites=online,
        offline_sites=total - online,
        avg_uptime=round(avg_uptime * 100, 1),
        indexed_documents=indexed,
        last_crawl=last_crawl.last_crawled if last_crawl else None,
        last_health_check=last_check.last_checked if last_check else None,
        blocked_sites=blocked,
        recent_reports=0
    )


# Health check
@app.get("/health")
async def backend_health():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}
