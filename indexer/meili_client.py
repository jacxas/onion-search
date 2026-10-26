"""
Cliente para indexar y buscar en Meilisearch.

El cliente es *perezoso*: si Meilisearch no está disponible (por ejemplo en
desarrollo o en un sandbox), FARO sigue funcionando y la búsqueda cae al
motor local sobre PostgreSQL/SQLite. Nunca bloquea el arranque del portal.
"""
import os
import logging
from typing import Dict, List, Optional

import meilisearch
from meilisearch import Client

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = float(os.getenv('MEILI_TIMEOUT', '2'))


class MeiliIndexer:
    """Cliente para indexar y buscar documentos en Meilisearch."""

    def __init__(
        self,
        url: str = None,
        master_key: str = None,
        index_name: str = 'onion_pages'
    ):
        self.url = url or os.getenv('MEILI_URL', 'http://localhost:7700')
        self.master_key = master_key or os.getenv('MEILI_MASTER_KEY', 'dev-master-key')
        self.index_name = index_name
        self._configured = False
        self._reachable: Optional[bool] = None

        try:
            self.client = Client(self.url, self.master_key, timeout=TIMEOUT_SECONDS)
            self.index = self.client.index(self.index_name)
        except Exception as exc:  # pragma: no cover - defensivo
            logger.warning('Meilisearch no inicializado: %s', exc)
            self.client = None
            self.index = None

    # ------------------------------------------------------------------
    # Disponibilidad
    # ------------------------------------------------------------------
    @property
    def available(self) -> bool:
        """Chequeo en vivo con respuesta cacheada (se reintenta cada llamada)."""
        if self.client is None:
            return False
        try:
            self.client.health()
            self._reachable = True
        except Exception:
            self._reachable = False
        return bool(self._reachable)

    def _configure_index(self):
        """Configurar settings del índice una sola vez y solo si está online."""
        if self._configured or not self.available:
            return
        settings = {
            'searchableAttributes': ['title', 'description', 'content'],
            'displayedAttributes': ['url', 'title', 'description', 'content_hash',
                                    'category', 'crawled_at'],
            'filterableAttributes': ['content_hash', 'category', 'crawled_at'],
            'sortableAttributes': ['crawled_at'],
            'rankingRules': ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
            'stopWords': ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
                          'el', 'la', 'los', 'las', 'un', 'una', 'y', 'o', 'pero', 'de',
                          'del', 'en', 'con', 'por', 'para'],
        }
        try:
            task = self.index.update_settings(settings)
            self.client.wait_for_task(task['taskUid'], timeout_in_ms=5000)
            self._configured = True
            logger.info("Índice '%s' configurado", self.index_name)
        except Exception as exc:
            logger.warning('No se pudo configurar el índice: %s', exc)

    # ------------------------------------------------------------------
    # Escritura
    # ------------------------------------------------------------------
    def add_or_update_documents(self, documents: List[Dict], primary_key: str = 'url'):
        """Agregar o actualizar documentos. Devuelve None si no hay Meili."""
        if not self.available:
            return None
        self._configure_index()
        try:
            task = self.index.update_documents(documents, primary_key)
            logger.info('Actualizados %s documentos. Task: %s', len(documents), task['taskUid'])
            return task
        except Exception as exc:
            logger.error('Error actualizando documentos: %s', exc)
            return None

    # ------------------------------------------------------------------
    # Lectura
    # ------------------------------------------------------------------
    def search(
        self,
        query: str,
        filters: str = None,
        limit: int = 20,
        offset: int = 0
    ) -> Dict:
        """Buscar en el índice. Devuelve {'hits': [], ...} si no está disponible."""
        if not self.available:
            return {'hits': [], 'query': query, 'estimatedTotalHits': 0, 'unavailable': True}

        self._configure_index()
        params = {'q': query, 'limit': limit, 'offset': offset}
        if filters:
            params['filter'] = filters

        try:
            return self.index.search(**params)
        except Exception as exc:
            logger.warning('Error buscando en Meilisearch: %s', exc)
            return {'hits': [], 'query': query, 'estimatedTotalHits': 0, 'unavailable': True}

    def get_stats(self) -> Dict:
        """Estadísticas del índice (vacío si Meili no está disponible)."""
        if not self.available:
            return {}
        try:
            return self.index.get_stats()
        except Exception as exc:
            logger.warning('Error obteniendo stats: %s', exc)
            return {}


def create_indexer() -> MeiliIndexer:
    """Factory para crear instancia de MeiliIndexer."""
    return MeiliIndexer()
