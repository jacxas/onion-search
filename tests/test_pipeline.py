"""Pruebas del pipeline de rastreo y del barrido de salud (modo sim)."""
import os
import tempfile

os.environ.setdefault('DATABASE_URL', f'sqlite:///{tempfile.mkdtemp()}/pipeline.db')

import pytest  # noqa: E402

from crawler.parse import extract  # noqa: E402
from crawler.pipeline import CrawlPipeline, load_seeds  # noqa: E402
from crawler.transport import (  # noqa: E402
    SimTransport, content_fingerprint, node_url, normalize_url,
)
from db.database import get_db, init_db  # noqa: E402
from db.models import Blocklist, CrawlRun, OnionSite, SiteCheck  # noqa: E402
from db.seed import seed_demo_data  # noqa: E402
from health_checker.checker import run_health_sweep  # noqa: E402


@pytest.fixture(scope='module', autouse=True)
def prepared_db():
    init_db()
    seed_demo_data()
    yield


def test_url_helpers():
    assert normalize_url('abc.onion') == 'http://abc.onion/'
    assert normalize_url('HTTP://ABC.onion/x#frag') == 'http://abc.onion/x'
    assert node_url('http://abc.onion/ruta?q=1') == 'http://abc.onion'
    assert content_fingerprint('Hola  Mundo') == content_fingerprint('hola mundo')


def test_extract_links_and_metadata():
    html = """
    <html><head><title>Nodo de prueba</title>
    <meta name="description" content="Descripción de prueba"></head>
    <body><p>Texto del nodo</p>
    <a href="http://aaa.onion/">uno</a>
    <a href="/rel">relativo</a>
    <a href="mailto:x@y">mail</a>
    <a href="https://clearnet.example">externo</a>
    </body></html>
    """
    data = extract(html, 'http://bbb.onion/pagina')
    assert data['title'] == 'Nodo de prueba'
    assert data['description'] == 'Descripción de prueba'
    assert data['url'] == 'http://bbb.onion/pagina'
    assert 'http://aaa.onion/' in data['links']
    assert 'http://bbb.onion/rel' in data['links']
    assert all('.onion' in link for link in data['links'])


def test_sim_transport_is_deterministic():
    transport = SimTransport(latency=0)
    seeds = load_seeds()
    assert seeds, 'la semilla demo debería cargar semillas'
    first = transport.fetch(seeds[0])
    second = transport.fetch(seeds[0])
    assert (first.status_code, first.text) == (second.status_code, second.text)


def test_crawl_indexes_nodes_and_respects_blocklist():
    with get_db() as db:
        blocked_url = db.query(Blocklist).first().url
    before = None
    with get_db() as db:
        before = db.query(OnionSite).count()

    run_id = None
    with get_db() as db:
        run = CrawlRun(kind='crawl', mode='sim', trigger='test')
        db.add(run)
        db.flush()
        run_id = run.id

    pipeline = CrawlPipeline(transport=SimTransport(latency=0), run_id=run_id)
    result = pipeline.run(delay=0)

    assert result['ok'] is True
    assert result['pages_ok'] >= 5
    assert pipeline.blocked >= 1

    with get_db() as db:
        assert db.query(OnionSite).count() >= before
        sites = db.query(OnionSite).filter(OnionSite.url != blocked_url).all()
        crawled = [s for s in sites if s.last_crawled is not None]
        assert crawled, 'el rastreo debe escribir last_crawled'
        assert all(s.url.startswith('http://') for s in crawled)
        assert all(s.url.count('/') == 2 for s in crawled), 'una entrada por nodo'
        run = db.query(CrawlRun).filter(CrawlRun.id == run_id).first()
        assert run.status == 'ok'
        assert run.pages_ok == result['pages_ok']
        assert run.finished_at is not None


def test_health_sweep_records_history():
    with get_db() as db:
        before = db.query(SiteCheck).count()

    run_id = None
    with get_db() as db:
        run = CrawlRun(kind='health', mode='sim', trigger='test')
        db.add(run)
        db.flush()
        run_id = run.id

    summary = run_health_sweep(limit=12, run_id=run_id,
                               transport=SimTransport(latency=0))
    assert summary['checked'] > 0
    assert summary['online'] + summary['offline'] == summary['checked']

    with get_db() as db:
        assert db.query(SiteCheck).count() > before
        run = db.query(CrawlRun).filter(CrawlRun.id == run_id).first()
        assert run.status == 'ok'
        assert run.checked == summary['checked']
        for site in db.query(OnionSite).limit(5).all():
            assert 0.0 <= site.uptime_ratio <= 1.0
