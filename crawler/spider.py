"""
Crawler principal para sitios .onion con indexaciÃ³n en Meilisearch y PostgreSQL.
"""
import os
import time
import logging
from datetime import datetime
from typing import Set, List, Optional
from urllib.parse import urlparse
import hashlib

from bs4 import BeautifulSoup
from tor_session import TorCrawlerSession
from meili_client import create_indexer
from database import get_db, init_db
from models import OnionSite, Blocklist

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class OnionSpider:
    """
    Crawler para sitios .onion con deduplicaciÃ³n, extracciÃ³n de contenido
    e indexaciÃ³n en Meilisearch + PostgreSQL.
    """
    
    def __init__(
        self,
        socks_host: str = None,
        socks_port: int = None,
        timeout: int = 30,
        max_pages: int = 1000,
        concurrency: int = 2,
        batch_size: int = 50
    ):
        self.socks_host = socks_host or os.getenv('TOR_SOCKS_HOST', '127.0.0.1')
        self.socks_port = int(socks_port or os.getenv('TOR_SOCKS_PORT', '9050'))
        self.timeout = timeout
        self.max_pages = max_pages
        self.concurrency = concurrency
        self.batch_size = batch_size
        
        self.session = TorCrawlerSession(
            socks_host=self.socks_host,
            socks_port=self.socks_port,
            timeout=self.timeout
        )
        
        self.indexer = create_indexer()
        
        self.visited: Set[str] = set()
        self.queue: List[str] = []
        self.pages_crawled = 0
        
        self.blocklist_urls: Set[str] = set()
        self.blocklist_hashes: Set[str] = set()
        self._load_blocklist()
        
        self._load_seed_list()
        
        init_db()
    
    def _load_blocklist(self):
        """Cargar blocklist desde archivo."""
        try:
            with open('blocklist.txt', 'r') as f:
                for line in f:
                    url = line.strip()
                    if url and not url.startswith('#'):
                        self.blocklist_urls.add(url)
            logger.info(f"Blocklist cargada: {len(self.blocklist_urls)} URLs")
        except FileNotFoundError:
            logger.warning("blocklist.txt no encontrado")
    
    def _load_seed_list(self, filepath: str = 'seed_list.txt'):
        """Cargar URLs iniciales desde archivo."""
        try:
            with open(filepath, 'r') as f:
                for line in f:
                    url = line.strip()
                    if url and url.endswith('.onion') and not url.startswith('#'):
                        self.queue.append(url)
                        logger.info(f"Seed loaded: {url[:50]}...")
        except FileNotFoundError:
            logger.warning("seed_list.txt no encontrado")
    
    def is_onion_url(self, url: str) -> bool:
        """Verificar si es URL .onion vÃ¡lida."""
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url)
            return parsed.netloc.endswith('.onion')
        except:
            return False
    
    def is_blocked(self, url: str, content_hash: str) -> bool:
        """Verificar si URL o hash estÃ¡ en blocklist."""
        return url in self.blocklist_urls or content_hash in self.blocklist_hashes
    
    def extract_links(self, html: str, base_url: str) -> List[str]:
        """Extraer todos los enlaces .onion de una pÃ¡gina."""
        soup = BeautifulSoup(html, 'lxml')
        links = []
        
        for a in soup.find_all('a', href=True):
            href = a['href'].strip()
            
            if href.startswith(('javascript:', 'mailto:', '#', 'data:')):
                continue
            
            if not href.startswith('http'):
                from urllib.parse import urljoin
                href = urljoin(base_url, href)
            
            if self.is_onion_url(href):
                links.append(href)
        
        return links
    
    def extract_content(self, html: str, url: str) -> dict:
        """Extraer tÃ¬tulo, texto y metadata de una pÃ¡gina."""
        soup = BeautifulSoup(html, 'lxml')
        
        title = ''
        if soup.title:
            title = soup.title.get_text(strip=True)
        
        description = ''
        meta_desc = soup.find('meta', attrs={'name': 'description'})
        if meta_desc and meta_desc.get('content'):
            description = meta_desc['content'].strip()
        
        for tag in soup(['script', 'style', 'noscript']):
            tag.decompose()
        
        text = soup.get_text(separator=' ', strip=True)
        if len(text) > 10000:
            text = text[:10000]
        
        content_hash = hashlib.sha256(text.encode()).hexdigest()
        
        return {
            'url': url,
            'title': title or url,
            'description': description,
            'content': text,
            'content_hash': content_hash,
            'crawled_at': datetime.utcnow().isoformat()
        }
    
    def save_to_db(self, data: dict) -> Optional[OnionSite]:
        """Guardar datos en PostgreSQL."""
        try:
            with get_db() as db:
                existing = db.query(OnionSite).filter(OnionSite.url == data['url']).first()
                
                if existing:
                    existing.title = data['title']
                    existing.description = data['description']
                    existing.content = data['content']
                    existing.content_hash = data['content_hash']
                    existing.last_crawled = datetime.utcnow()
                    site = existing
                else:
                    site = OnionSite(
                        url=data['url'],
                        title=data['title'],
                        description=data['description'],
                        content=data['content'],
                        content_hash=data['content_hash'],
                        first_crawled=datetime.utcnow(),
                        last_crawled=datetime.utcnow()
                    )
                    db.add(site)
                
                db.commit()
                logger.debug(f"DB: {data['url'][:50]}...")
                return site
                
        except Exception as e:
            logger.error(f"Error guardando en DB: {str(e)}")
            return None
    
    def index_in_meilisearch(self, data: dict):
        """Indexar documento en Meilisearch."""
        try:
            document = {
                'url': data['url'],
                'title': data['title'],
                'description': data['description'],
                'content': data['content'],
                'content_hash': data['content_hash'],
                'crawled_at': datetime.utcnow().timestamp()
            }
            
            self.indexer.add_or_update_documents([document])
            
        except Exception as e:
            logger.error(f"Error indexando en Meilisearch: {str(e)}")
    
    def crawl_page(self, url: str) -> Optional[dict]:
        """Crawlear una pÃ¡gina individual."""
        if url in self.visited:
            logger.debug(f"Ya visitado: {url[:50]}...")
            return None
        
        if not self.is_onion_url(url):
            logger.warning(f"URL no es .onion: {url}")
            return None
        
        try:
            logger.info(f"Crawling: {url[:60]}...")
            response = self.session.get(url)
            
            if response.status_code >= 400:
                logger.warning(f"HTTP {response.status_code} para {url}")
                return None
            
            html = response.text
            data = self.extract_content(html, url)
            
            if self.is_blocked(url, data['content_hash']):
                logger.warning(f"Bloqueado por blocklist: {url[:50]}...")
                self.visited.add(url)
                return None
            
            new_links = self.extract_links(html, url)
            for link in new_links:
                if link not in self.visited and link not in self.queue:
                    self.queue.append(link)
            
            self.visited.add(url)
            self.pages_crawled += 1
            
            logger.info(f"Ã©xito: {url[:50]}... (links: {len(new_links)})")
            return data
            
        except Exception as e:
            logger.error(f"Error crawling {url}: {str(e)}")
            self.visited.add(url)
            return None
    
    def process_batch(self, batch: List[dict]):
        """Procesar un batch de resultados."""
        if not batch:
            return
        
        logger.info(f"Procesando batch de {len(batch)} pÃ¡ginas...")
        
        for data in batch:
            self.save_to_db(data)
        
        try:
            documents = []
            for data in batch:
                documents.append({
                    'url': data['url'],
                    'title': data['title'],
                    'description': data['description'],
                    'content': data['content'],
                    'content_hash': data['content_hash'],
                    'crawled_at': datetime.utcnow().timestamp()
                })
            
            self.indexer.add_or_update_documents(documents)
            logger.info(f"Batch indexado: {len(batch)} documentos")
            
        except Exception as e:
            logger.error(f"Error indexando batch: {str(e)}")
    
    def run(self):
        """Ejecutar el crawler."""
        logger.info(f"Iniciando crawler. Seed URLs: {len(self.queue)}")
        logger.info(f"Config: timeout={self.timeout}s, max_pages={self.max_pages}, batch_size={self.batch_size}")
        
        start_time = time.time()
        batch_buffer = []
        
        while self.queue and self.pages_crawled < self.max_pages:
            url = self.queue.pop(0)
            result = self.crawl_page(url)
            
            if result:
                batch_buffer.append(result)
                
                if len(batch_buffer) >= self.batch_size:
                    self.process_batch(batch_buffer)
                    batch_buffer = []
            
            time.sleep(1)
        
        if batch_buffer:
            self.process_batch(batch_buffer)
        
        elapsed = time.time() - start_time
        logger.info(f"Crawler finalizado. PÃ¡ginas: {self.pages_crawled}, Tiempo: {elapsed:.1f}s")
        
        try:
            stats = self.indexer.get_stats()
            logger.info(f"Meilisearch stats: {stats}")
        except:
            pass
        
        self.session.close()


def main():
    """Entry point para ejecutar el crawler."""
    spider = OnionSpider(
        timeout=int(os.getenv('CRAWLER_TIMEOUT', '30')),
        max_pages=int(os.getenv('CRAWLER_MAX_PAGES', '1000')),
        concurrency=int(os.getenv('CRAWLER_CONCURRENCY', '2')),
        batch_size=50
    )
    spider.run()


if __name__ == '__main__':
    main()
