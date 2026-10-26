"""Pruebas de humo del portal FARO (sin Tor, sin Meilisearch)."""
import os
import tempfile

os.environ.setdefault('DATABASE_URL', f'sqlite:///{tempfile.mkdtemp()}/test.db')

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402
from backend.search import normalize_terms  # noqa: E402
from db.seed import onion_address  # noqa: E402

ADMIN_TOKEN = os.getenv('ADMIN_TOKEN', 'admin-secret-token')


def test_normalize_terms_drops_stopwords():
    assert normalize_terms('La biblioteca de la red') == ['biblioteca', 'red']
    assert normalize_terms('foro! seguro?') == ['foro', 'seguro']


def test_onion_address_is_valid_v3():
    address = onion_address('plaza-foro')
    assert address.endswith('.onion')
    assert len(address) == 62
    assert set(address[:-6]) <= set('abcdefghijklmnopqrstuvwxyz234567')
    assert onion_address('plaza-foro') == address


def test_public_pages_boot_and_seed():
    with TestClient(app) as client:
        home = client.get('/')
        assert home.status_code == 200
        assert 'FARO' in home.text

        stats = client.get('/api/stats').json()
        assert stats['sites'] > 10
        assert stats['online'] > 0

        search = client.get('/api/search', params={'q': 'biblioteca'})
        assert search.status_code == 200
        payload = search.json()
        assert payload['total'] >= 1
        assert all('.onion' in hit['domain'] for hit in payload['results'])

        assert client.get('/directorio').status_code == 200
        assert client.get('/estado').status_code == 200
        assert client.get('/api').status_code == 200

        domain = payload['results'][0]['domain']
        detail = client.get(f'/sitio/{domain}')
        assert detail.status_code == 200
        assert 'Historial de salud' in detail.text

        assert client.get('/sitio/desconocido.onion').status_code == 404


def test_report_and_admin_flow():
    with TestClient(app) as client:
        domain = client.get('/api/sites', params={'limit': 1}).json()['results'][0]['domain']
        posted = client.post(
            f'/sitio/{domain}/reportar',
            data={'reason': 'caido', 'details': 'prueba automatizada'},
            follow_redirects=False,
        )
        assert posted.status_code == 303

        assert client.get('/admin', follow_redirects=False).status_code in (302, 307)

        login = client.post(
            '/admin/login',
            data={'token': ADMIN_TOKEN, 'next': '/admin'},
            follow_redirects=False,
        )
        assert login.status_code == 303
        assert client.get('/admin').status_code == 200
        assert client.get('/admin/reports').status_code == 200
        assert client.get('/admin/sites').status_code == 200
        assert client.get('/admin/blocklist').status_code == 200
        assert client.get('/admin/actions').status_code == 200

        assert client.post(
            '/admin/actions/force-health-check', follow_redirects=False
        ).status_code == 303

        assert client.post(
            '/admin/blocklist/add',
            data={'url': 'no-es-onion', 'reason': 'x'},
            follow_redirects=False,
        ).status_code == 400
