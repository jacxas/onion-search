"""
MÃ³dulo para crear sesiones HTTP a travÃ©s de Tor SOCKS5.
"""
import os
import requests
from typing import Optional
from tenacity import retry, stop_after_attempt, wait_exponential


def create_tor_session(
    socks_host: str = None,
    socks_port: int = None,
    timeout: int = 30
) -> requests.Session:
    """
    Crear una sesiÃ³n requests configurada para usar Tor SOCKS5.
    """
    socks_host = socks_host or os.getenv('TOR_SOCKS_HOST', '127.0.0.1')
    socks_port = socks_port or os.getenv('TOR_SOCKS_PORT', '9050')
    
    session = requests.Session()
    proxy_url = f"socks5h://{socks_host}:{socks_port}"
    session.proxies = {
        'http': proxy_url,
        'https': proxy_url
    }
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (compatible; OnionSearchBot/1.0; +https://github.com/jacxas/onion-search)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'close',
    })
    return session


class TorCrawlerSession:
    """
    Wrapper para sesiÃ³n de crawling con retries automÃ¡ticos.
    """
    
    def __init__(
        self,
        socks_host: str = None,
        socks_port: int = None,
        timeout: int = 30,
        max_retries: int = 3
    ):
        self.session = create_tor_session(socks_host, socks_port, timeout)
        self.timeout = timeout
        self.max_retries = max_retries
    
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10)
    )
    def get(self, url: str, timeout: Optional[int] = None) -> requests.Response:
        """
        Hacer GET request con retries automÃ¡ticos.
        """
        return self.session.get(
            url,
            timeout=timeout or self.timeout,
            allow_redirects=False
        )
    
    def close(self):
        """Cerrar sesiÃ³n."""
        self.session.close()
