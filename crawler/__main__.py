"""`python -m crawler` — rastreo único de las semillas activas."""
import logging

from crawler.pipeline import run_crawl

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO,
                        format='%(asctime)s  %(levelname)-7s %(message)s')
    print(run_crawl(trigger='cli'))
