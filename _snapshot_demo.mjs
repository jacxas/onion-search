// Renderiza FARO (127.0.0.1:3007, modo sim) a demo/ — versión Node, sin dependencias.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:3007';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.join(ROOT, 'demo');

const BANNER = '<div class="demo-flag" style="border-top:1px solid rgba(255,196,92,.18)"><div class="wrap"><span class="badge pending">demo estática</span><span>Snapshot sin servidor de la interfaz de FARO: la búsqueda, los filtros y la paginación se resuelven en tu navegador con datos sintéticos. El portal completo (rastreo Tor, centro de mando, API en vivo) corre en Docker o Fly.io — <a href="https://github.com/jacxas/onion-search">código en GitHub</a>.</span></div></div>';
const SCRIPT_TAG = '<script src="/static/demo.js" defer></script>';

const AZAR = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="4;url=/directorio">
<title>FARO · nodo al azar</title>
<link rel="stylesheet" href="/static/css/faro.css">
</head><body><main class="wrap" style="padding-top:90px">
<div class="empty"><h3>Buscando un nodo encendido…</h3>
<p>Si no te lleva solo, abrí el <a href="/directorio">directorio</a>.</p></div>
</main><script>
(function(){
  fetch('/static/sites.json').then(function(r){return r.json()}).then(function(list){
    var up = list.filter(function(s){return s.online});
    if (up.length) { location.replace('/sitio/' + up[Math.floor(Math.random()*up.length)].domain + '/'); }
    else { location.replace('/directorio/'); }
  }).catch(function(){ location.replace('/directorio/'); });
})();
</script></body></html>`;

async function get(path) {
  const r = await fetch(BASE + path, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(path + ' -> ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

function write(rel, data) {
  const full = path.join(DEMO, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
}

async function main() {
  // esperar servidor
  for (let i = 0; i < 60; i++) {
    try { await get('/health'); break; } catch { await new Promise(r => setTimeout(r, 1500)); }
  }
  console.log('· servidor arriba');

  // índice de nodos
  const sites = JSON.parse((await get('/api/sites?limit=100')).toString('utf8')).results;
  write('static/sites.json', JSON.stringify(sites, null, 1));
  console.log('·', sites.length, 'nodos a static/sites.json');

  const pages = [
    ['/', 'index.html'],
    ['/search', 'search/index.html'],
    ['/directorio', 'directorio/index.html'],
    ['/estado', 'estado/index.html'],
    ['/api', 'api/index.html'],
    ...sites.map(s => ['/sitio/' + s.domain, 'sitio/' + s.domain + '/index.html']),
  ];
  for (const [p, rel] of pages) {
    let html = (await get(p)).toString('utf8');
    html = html.replace('<body>', '<body>' + BANNER, 1);
    html = html.replace('</body>', SCRIPT_TAG + '</body>', 1);
    write(rel, html);
  }
  console.log('·', pages.length, 'páginas HTML renderizadas');

  write('azar/index.html', AZAR);
  write('api/stats.json', await get('/api/stats'));
  write('api/status.json', await get('/api/status'));
  write('api/search.json', await get('/api/search?q=biblioteca'));
  write('health.json', await get('/health'));
  console.log('· JSON de API capturados');

  let total = 0;
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f); else total++;
  });
  walk(DEMO);
  console.log('LISTO: demo/ con', total, 'archivos');
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
