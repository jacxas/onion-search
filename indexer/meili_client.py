"""
Cliente para indexar y buscar en Meilisearch.
"""
import os
import logging
from typing import List, Dict, Optional
from meilisearch import Client

logger = logging.getLogger(__name__)


class MeiliIndexer:
    """
    Cliente para indexar documentos en Meilisearch.
    """
    
    def __init__(
        self,
        url: str = None,
        master_key: str = None,
        index_name: str = 'onion_pages'
    ):
        self.url = url or os.getenv('MEILI_URL', 'http://localhost:7700')
        self.master_key = master_key or os.getenv('MEILI_MASTER_KEY', 'dev-master-key')
        self.index_name = index_name
        
        self.client = Client(self.url, self.master_key)
        self.index = self.client.index(self.index_name)
        
        self._configure_index()
    
    def _configure_index(self):
        """Configurar settings del Ã­ndice."""
        settings = {
            'searchableAttributes': ['title', 'description', 'content'],
            'displayedAttributes': ['url', 'title', 'description', 'content_hash', 'crawled_at'],
            'filterableAttributes': ['content_hash', 'crawled_at'],
            'sortableAttributes': ['crawled_at'],
            'rankingRules': ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
            'stopWords': ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
                         'el', 'la', 'los', 'las', 'un', 'una', 'y', 'o', 'pero', 'de', 'del', 'en', 'con', 'por', 'para']
        }
        
        try:
            task = self.index.update_settings(settings)
            self.client.wait_for_task(task.task_uid)
            logger.info(f"Ãndice '{self.index_name}' configurado")
        except Exception as e:
            logger.error(f"Error configurando Ã­ndice: {str(e)}")
    
    def add_or_update_documents(self, documents: List[Dict], primary_key: str = 'url'):
        """Agregar o actualizar documentos."""
        try:
            task = self.index.update_documents(documents, primary_key)
            logger.info(f"Actualizados {len(documents)} documentos. Task: {task.task_uid}")
            return task
        except Exception as e:
            logger.error(f"Error actualizando documentos: {str(e)}")
            raise
    
    def search(
        self,
        query: str,
        filters: Optional[str] = None,
        limit: int = 20,
        offset: int = 0
    ) -> Dict:
        """Buscar en el Ã­ndice."""
        params: Dict = {'limit': limit, 'offset': offset}
        
        if filters:
            params['filter'] = filters
        
        try:
            results = self.index.search(query, params)
            return results
        except Exception as e:
            logger.error(f"Error buscando: {str(e)}")
            return {'hits': [], 'query': query, 'total': 0}
    
    def get_stats(self) -> Dict:
        """Obtener estadÃ¬sticas del Ã­ndice."""
        try:
            stats = self.index.get_stats()
            return stats
        except Exception as e:
            logger.error(f"Error obteniendo stats: {str(e)}")
            return {}


def create_indexer() -> MeiliIndexer:
    """Factory para crear instancia de MeiliIndexer."""
    return MeiliIndexer()
