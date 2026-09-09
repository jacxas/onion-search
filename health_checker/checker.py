"""
Health checker asÃ¬ncrono para verificar uptime de sitios .onion.
"""
import os
import asyncio
import logging
from datetime import datetime, timedelta
from typing import List, Dict
import aiohttp
from aiohttp_socks import ProxyConnector

from db.database import get_db
from db.models import OnionSite
from sqlalchemy import or_, desc

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class HealthChecker:
    """Verificador de salud para sitios .onion."""
    
    def __init__(
        self,
        socks_host: str = None,
        socks_port: int = None,
        timeout: int = 15,
        check_interval: int = 3600,
        batch_size: int = 50
    ):
        self.socks_host = socks_host or os.getenv('TOR_SOCKS_HOST', '127.0.0.1')
        self.socks_port = int(socks_port or os.getenv('TOR_SOCKS_PORT', '9050'))
        self.timeout = timeout
        self.check_interval = check_interval
        self.batch_size = batch_size
        
        self.connector = ProxyConnector.from_url(
            f'socks5://{self.socks_host}:{self.socks_port}'
        )
    
    async def check_site(self, session: aiohttp.ClientSession, url: str) -> Dict:
        """Verificar salud de un sitio individual."""
        result = {
            'url': url,
            'status_code': 0,
            'online': False,
            'response_time': None,
            'checked_at': datetime.utcnow().isoformat(),
            'error': None
        }
        
        try:
            start = datetime.utcnow()
            async with session.get(url, timeout=self.timeout, allow_redirects=False) as resp:
                elapsed = (datetime.utcnow() - start).total_seconds()
                
                result['status_code'] = resp.status
                result['online'] = resp.status < 400
                result['response_time'] = round(elapsed, 2)
                
                logger.info(f"â£¿ {url[:50]}... | {resp.status} | {elapsed:.2f}s")
                
        except asyncio.TimeoutError:
            result['error'] = 'timeout'
            logger.warning(f"Timeout: {url[:50]}...")
            
        except Exception as e:
            result['error'] = str(e)
            logger.error(f"Error: {url[:50]}... | {str(e)}")
        
        return result
    
    async def check_batch(self, session: aiohttp.ClientSession, urls: List[str]) -> List[Dict]:
        """Verificar un lote de sitios concurrentemente."""
        tasks = [self.check_site(session, url) for url in urls]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        processed = []
        for r in results:
            if isinstance(r, Exception):
                logger.error(f"ExcepciÃ³n en batch: {str(r)}")
            else:
                processed.append(r)
        
        return processed
    
    def load_sites_to_check(self) -> List[str]:
        """Cargar sitios a verificar desde la DB."""
        try:
            with get_db() as db:
                cutoff = datetime.utcnow() - timedelta(seconds=self.check_interval)
                
                sites = db.query(OnionSite).filter(
                    or_(
                        OnionSite.last_checked == None,
                        OnionSite.last_checked < cutoff
                    ),
                    OnionSite.is_blocked == False
                ).order_by(
                    desc(OnionSite.last_checked).nullsfirst()
                ).limit(self.batch_size * 2).all()
                
                urls = [s.url for s in sites]
                logger.info(f"Cargados {len(urls)} sitios para verificar")
                return urls
                
        except Exception as e:
            logger.error(f"Error cargando sitios: {str(e)}")
            return []
    
    def save_results(self, results: List[Dict]):
        """Guardar resultados en la DB."""
        try:
            with get_db() as db:
                for r in results:
                    if r.get('error') and r['error'] == 'timeout':
                        continue
                    
                    site = db.query(OnionSite).filter(OnionSite.url == r['url']).first()
                    
                    if site:
                        site.update_uptime(
                            is_online=r['online'],
                            response_time=r['response_time']
                        )
                        site.status_code = r['status_code']
                        db.add(site)
                    else:
                        site = OnionSite(
                            url=r['url'],
                            title=r['url'],
                            content_hash='unknown',
                            online=r['online'],
                            status_code=r['status_code'],
                            response_time=r['response_time'],
                            last_checked=datetime.utcnow()
                        )
                        site.update_uptime(is_online=r['online'], response_time=r['response_time'])
                        db.add(site)
                
                db.commit()
                
                online_count = sum(1 for r in results if r.get('online'))
                logger.info(f"Resultados guardados: {len(results)} sitios, {online_count} online")
                
        except Exception as e:
            logger.error(f"Error guardando resultados: {str(e)}")
    
    async def run_cycle(self):
        """Ejecutar un ciclo completo de health checks."""
        logger.info("Iniciando ciclo de health checks...")
        
        urls = self.load_sites_to_check()
        if not urls:
            logger.info("No hay sitios para verificar")
            return
        
        logger.info(f"Verificando {len(urls)} sitios en batches de {self.batch_size}...")
        
        async with aiohttp.ClientSession(connector=self.connector) as session:
            for i in range(0, len(urls), self.batch_size):
                batch = urls[i:i + self.batch_size]
                batch_num = i // self.batch_size + 1
                logger.info(f"Batch {batch_num}: {len(batch)} sitios")
                
                results = await self.check_batch(session, batch)
                self.save_results(results)
                
                await asyncio.sleep(2)
        
        logger.info("Ciclo de health checks finalizado")
    
    async def run_continuous(self):
        """Ejecutar health checks continuamente."""
        logger.info(f"Iniciando health checker continuo (intervalo: {self.check_interval}s)")
        
        while True:
            try:
                await self.run_cycle()
            except KeyboardInterrupt:
                logger.info("Health checker detenido por usuario")
                break
            except Exception as e:
                logger.error(f"Error en ciclo: {str(e)}")
            
            logger.info(f"PrÃ³ximo ciclo en {self.check_interval}s")
            await asyncio.sleep(self.check_interval)
    
    def close(self):
        """Cerrar conector."""
        self.connector.close()


async def main():
    """Entry point para ejecutar el health checker."""
    checker = HealthChecker(
        timeout=int(os.getenv('HEALTH_CHECK_TIMEOUT', '15')),
        check_interval=int(os.getenv('HEALTH_CHECK_INTERVAL', '3600')),
        batch_size=50
    )
    
    try:
        await checker.run_continuous()
    except KeyboardInterrupt:
        logger.info("Health checker detenido por usuario")
    finally:
        checker.close()


if __name__ == '__main__':
    asyncio.run(main())
