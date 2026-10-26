"""
Semilla de demostración del índice de FARO.

Genera un conjunto determinista de servicios .onion con títulos, categorías,
uptime y espejos, para poder navegar el portal sin Tor ni rastreo real.
Las direcciones se derivan de forma determinista (base32 v3 válido) a partir
del slug: no corresponden a servicios reales.
"""
import hashlib
from datetime import datetime, timedelta

from db.database import get_db
from db.models import OnionSite, SiteReport, Blocklist, SiteCheck

BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

# slug, título, categoría, descripción
SEED_SITES = [
    ('faro-directorio', 'Faro · Directorio de nodos', 'Herramientas',
     'Índice curado de servicios onion activos, con estado de salud y espejos verificados. Punto de partida para explorar la red.'),
    ('plaza-foro', 'La Plaza · foro general', 'Foros',
     'Foro de discusión general sobre privacidad, criptografía aplicada y cultura de la red Tor. Registro abierto.'),
    ('biblioteca-sombra', 'Biblioteca Sombra', 'Biblioteca',
     'Archivo de textos sobre vigilancia, criptografía y libertad de expresión. Descargas en PDF y EPUB.'),
    ('mercado-verde', 'Mercado Verde', 'Mercados',
     'Mercado de semillas y plantas raras. Reputación pública, escrow y envíos discrecionales.'),
    ('correo-cifrado', 'Buzón Cifrado', 'Correo',
     'Servicio de correo descartable con cifrado PGP obligatorio. Sin registro ni logs de IP.'),
    ('noticias-trincheras', 'Noticias Trincheras', 'Noticias',
     'Boletín independiente con cobertura de filtraciones y casos de censura. Publicación semanal.'),
    ('paste-negro', 'Paste Negro', 'Herramientas',
     'Pegbin anónimo con caducidad de 24 h, sintaxis resaltada y subida de archivos hasta 5 MB.'),
    ('wiki-onion', 'Wiki Onion', 'Biblioteca',
     'Enciclopedia colaborativa de la red Tor: guías de hardening, mirrors y buenas prácticas de anonimato.'),
    ('chat-libre', 'Chat Libre', 'Servicios',
     'Sala de chat basada en XMPP con federación onion. Salas temáticas y puentes a IRC.'),
    ('vpn-gratis', 'Túnel Seguro', 'Seguridad',
     'Guía y cliente de túneles WireGuard para periodistas. Configuración lista para usar.'),
    ('archivo-muerto', 'Archivo Muerto', 'Biblioteca',
     'Colección de manuales técnicos descatalogados: radio, electrónica, imprenta y oficios.'),
    ('radio-fantasma', 'Radio Fantasma', 'Servicios',
     'Emisora de audio continuo por onion. Programación nocturna, sin publicidad ni rastreo.'),
    ('mapa-onion', 'Mapa Onion', 'Herramientas',
     'Visualización de la red con latencias agregadas y uptime por región. Datos abiertos en CSV.'),
    ('foro-seguridad', 'Foro de Seguridad', 'Foros',
     'Discusión técnica sobre exploits, hardening de servidores y respuesta a incidentes.'),
    ('tienda-libros', 'Tienda de Libros Raros', 'Mercados',
     'Libros antiguos escaneados y fanzines. Catálogo con búsqueda por época y temática.'),
    ('blog-vigia', 'Blog Vigía', 'Blog',
     'Notas de un administrador de sistemas sobre operar servicios ocultos a largo plazo.'),
    ('pad-clinica', 'Clínica Abierta', 'Servicios',
     'Consultas médicas a distancia con profesionales voluntarios. Turnos por formulario cifrado.'),
    ('glosario-tor', 'Glosario Tor', 'Biblioteca',
     'Definiciones claras sobre circuitos, guardas, bridges, servicios v3 y ataques de correlación.'),
    ('relay-list', 'Lista de Relays', 'Herramientas',
     'Estado en vivo de relays y bridges con uptime histórico descargable.'),
    ('contratapa', 'Contratapa', 'Noticias',
     'Revista de ensayo y cultura publicada en onion. Edición mensual, licencia libre.'),
    ('mercado-herramientas', 'Ferramenta', 'Mercados',
     'Herramientas manuales de segunda mano entre usuarios verificados. Envíos en la región.'),
    ('sos-soporte', 'SOS Soporte', 'Servicios',
     'Mesa de ayuda para personas con riesgo digital: asesoría, borrado seguro y refugio de datos.'),
    ('lab-cripto', 'Laboratorio Cripto', 'Seguridad',
     'Retos de criptografía aplicada y análisis de protocolos. CTF mensual con ranking.'),
    ('club-lectura', 'Club de Lectura', 'Foros',
     'Lecturas mensuales y discusión por capítulos. Archivo de reseñas desde 2019.'),
]

MIRROR_OF = {
    'plaza-foro': ['plaza-foro-espejo'],
    'mercado-verde': ['mercado-verde-2'],
    'wiki-onion': ['wiki-onion-espejo'],
}

DOWN_SITES = {'radio-fantasma', 'mercado-herramientas', 'contratapa', 'tienda-libros'}

DEMO_REPORTS = [
    ('plaza-foro-espejo', 'espejo_falso', 'El espejo pide una clave que el original nunca entrega.'),
    ('mercado-herramientas', 'caido', 'Timeout desde hace una semana.'),
    ('paste-negro', 'phishing', 'Copia del pastebin original con un formulario de login agregado.'),
]


def onion_address(slug: str) -> str:
    """Dirección v3 válida (56 chars base32) derivada del slug."""
    seed = hashlib.sha256(slug.encode()).digest() * 2
    return ''.join(BASE32[b % 32] for b in seed)[:56] + '.onion'


def _slugify(title: str) -> str:
    return title.lower().replace(' ', '-').replace('·', '')


def seed_demo_data(force: bool = False) -> int:
    """Carga los datos de demostración. Idempotente salvo `force=True`."""
    now = datetime.utcnow()
    created = 0

    with get_db() as db:
        existing_urls = {row[0] for row in db.query(OnionSite.url).all()}

        # Espejos que pertenecen a un sitio principal
        mirrors = {}
        for parent, aliases in MIRROR_OF.items():
            for alias in aliases:
                mirrors[alias] = parent

        entries = list(SEED_SITES)
        for alias, parent in mirrors.items():
            parent_entry = next(e for e in SEED_SITES if e[0] == parent)
            entries.append((alias, parent_entry[1], parent_entry[2], parent_entry[3]))

        for index, (slug, title, category, description) in enumerate(entries):
            host = onion_address(slug)
            url = f'http://{host}'
            if url in existing_urls and not force:
                continue

            down = slug in DOWN_SITES
            total_checks = 100
            uptime = 0.0 if down else round(0.62 + ((index * 37) % 38) / 100, 2)
            successful = int(total_checks * uptime)
            last_checked = now - timedelta(minutes=3 + (index * 7) % 55)
            is_mirror = slug in mirrors

            site = db.query(OnionSite).filter(OnionSite.url == url).first()
            if site is None:
                site = OnionSite(url=url, content_hash=hashlib.sha256(url.encode()).hexdigest())
                db.add(site)

            site.title = title + (' (espejo)' if is_mirror else '')
            site.description = description
            site.content = f'{title}. {description}'
            site.category = category
            site.language = 'es'
            site.is_mirror = is_mirror
            site.online = not down
            site.status_code = 0 if down else 200
            site.response_time = None if down else round(0.4 + (index % 9) * 0.35, 2)
            site.avg_response_time = site.response_time
            site.total_checks = total_checks
            site.successful_checks = successful
            site.uptime_ratio = uptime
            site.first_crawled = now - timedelta(days=90 - index)
            site.last_crawled = now - timedelta(hours=(index % 30) + 1)
            site.last_checked = last_checked
            site.last_online = None if down else last_checked
            created += 1

        db.flush()

        # Historial de salud: 30 chequeos por sitio, determinista.
        if db.query(SiteCheck).count() == 0:
            for index, (slug, *_rest) in enumerate(entries):
                site = db.query(OnionSite).filter(
                    OnionSite.url == f'http://{onion_address(slug)}'
                ).first()
                if site is None:
                    continue
                down = slug in DOWN_SITES
                for step in range(30):
                    failed = down or ((index * 13 + step * 7) % 23 == 0)
                    checked = last_checked - timedelta(hours=(29 - step) * 6)
                    db.add(SiteCheck(
                        site_id=site.id,
                        checked_at=checked,
                        online=not failed,
                        response_time=None if failed else round(
                            0.35 + ((index + step) % 11) * 0.28, 2),
                        status_code=0 if failed else 200,
                    ))

        if db.query(SiteReport).count() == 0:
            by_slug = {}
            for slug, *_ in entries:
                by_slug[slug] = f'http://{onion_address(slug)}'
            for i, (slug, reason, details) in enumerate(DEMO_REPORTS):
                db.add(SiteReport(
                    url=by_slug[slug],
                    reason=reason,
                    details=details,
                    status='pendiente',
                    created_at=now - timedelta(hours=6 + i * 13),
                ))

        if db.query(Blocklist).count() == 0:
            db.add(Blocklist(
                url=f'http://{onion_address("paste-negro")}',
                reason='Suplantación de identidad (phishing)',
            ))

    return created
