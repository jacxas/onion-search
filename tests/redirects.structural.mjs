// FARO — tests de regresión de redirects seguros (REL-01).
// Mock SOCKS5h con backend HTTP guionizado por path. Cada salto 3xx debe
// revalidarse con normalizeOnionUrl: solo .onion; clearnet/IPs privadas se
// rechazan ANTES de pedirse al proxy (visible en seenConnects).
import net from "node:net";
import assert from "node:assert";

const { makeTorTransport } = await import("../.worker-build/src/lib/tor/transport.js");

// path → [código, Location?]
const ROUTES = {
  "/r/200": ["200"],
  "/r/301": ["301", "http://abcdefghijklmnop.onion/r/200"],
  "/r/302rel": ["302", "/r/200"],
  "/r/chain1": ["302", "/r/chain2"],
  "/r/chain2": ["301", "http://mnopqrstuvwxyzab.onion/r/200"],
  "/r/clearnet": ["301", "http://example.com/"],
  "/r/private": ["302", "http://127.0.0.1:8080/admin"],
  "/rfc1918-x": ["302", "http://192.168.1.10:9000/x"],
  "/r/loopA": ["302", "/r/loopB"],
  "/r/loopB": ["302", "/r/loopA"],
  "/r/self": ["301", "/r/self"],
  "/r/shortonion": ["301", "http://abc.onion/"],
  "/r/hangfirst": ["302", "/r/hang"],
  "/r/hang": ["hang"],
  "/r/hop1": ["302", "/r/hop2"], "/r/hop2": ["302", "/r/hop3"],
  "/r/hop3": ["302", "/r/hop4"], "/r/hop4": ["302", "/r/hop5"],
  "/r/hop5": ["302", "/r/hop6"], "/r/hop6": ["302", "/r/hop7"],
  "/r/hop7": ["302", "/r/200"],
};

const seenConnects = [];
const results = [];
function ok(name, cond, extra = "") {
  results.push([name, !!cond]);
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
}

function startMockSocks(port) {
  const server = net.createServer((socket) => {
    let phase = "greet";
    let httpBuf = "";
    socket.on("data", (buf) => {
      if (phase === "greet") { socket.write(Buffer.from([5, 0])); phase = "req"; return; }
      if (phase === "req") {
        const atyp = buf[3]; let host; let off;
        if (atyp === 0x03) { const len = buf[4]; host = buf.slice(5, 5 + len).toString(); off = 5 + len; }
        else { host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`; off = 8; }
        seenConnects.push(host);
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0x1f, 0x90]));
        phase = "relay";
        return;
      }
      if (phase === "relay") {
        httpBuf += buf.toString();
        if (!httpBuf.includes("\r\n")) return;
        const path = (httpBuf.split("\r\n")[0].split(" ")[1] || "/");
        const r = ROUTES[path];
        if (!r) { socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"); return; }
        if (r[0] === "hang") return; // colgar (timeout)
        const [code, loc] = r;
        const body = code === "200" ? "<html><body>final OK</body></html>" : "";
        let head = `HTTP/1.1 ${code} ${code === "200" ? "OK" : "Moved"}\r\n`;
        if (loc) head += `Location: ${loc}\r\n`;
        head += `Content-Type: text/html\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n`;
        socket.end(head + body);
      }
    });
  });
  return new Promise((res) => server.listen(port, "127.0.0.1", () => res(server)));
}

const server = await startMockSocks(9153);
const t = makeTorTransport("socks5h://127.0.0.1:9153");
const H = "abcdefghijklmnop.onion";

// 1. 301 con Location absoluta → sigue y resuelve 200
let r = await t.fetch(`http://${H}/r/301`);
ok("301 Location absoluta → 200 final", r.ok && r.status === 200 && r.body?.includes("final OK"), `url=${r.url}`);

// 2. 302 con Location relativa → resuelve contra el host actual
r = await t.fetch(`http://${H}/r/302rel`);
ok("302 Location relativa → 200 final", r.ok && r.url === `http://${H}/r/200`, `url=${r.url}`);

// 3. cadena 302→301 (varios redirects) → 200
r = await t.fetch(`http://${H}/r/chain1`);
ok("cadena de redirects (2 saltos) → 200 final", r.ok && r.url === "http://mnopqrstuvwxyzab.onion/r/200", `url=${r.url}`);

// 4. redirect hacia clearnet → RECHAZADO antes de conectar
const before = seenConnects.length;
r = await t.fetch(`http://${H}/r/clearnet`);
ok("301 → example.com RECHAZADO", !r.ok && (r.error ?? "").startsWith("redirect_rechazado") && r.status === 301, `error=${r.error}`);
ok("… example.com nunca llegó al proxy SOCKS", !seenConnects.slice(before).includes("example.com"));

// 5. redirect hacia 127.0.0.1 (loopback) → RECHAZADO
r = await t.fetch(`http://${H}/r/private`);
ok("302 → 127.0.0.1:8080 RECHAZADO", !r.ok && (r.error ?? "").startsWith("redirect_rechazado"), `error=${r.error}`);

// 6. redirect hacia RFC1918 (192.168.x.x) → RECHAZADO
r = await t.fetch(`http://${H}/rfc1918-x`);
ok("302 → 192.168.1.10 RECHAZADO", !r.ok && (r.error ?? "").startsWith("redirect_rechazado"), `error=${r.error}`);

// 7. loop A→B→A → detectado
r = await t.fetch(`http://${H}/r/loopA`);
ok("redirect loop detectado", !r.ok && r.error === "redirect_loop", `error=${r.error}`);

// 7b. self-redirect inmediato
r = await t.fetch(`http://${H}/r/self`);
ok("self-redirect detectado", !r.ok && r.error === "redirect_loop", `error=${r.error}`);

// 8. Location a .onion inválido (host corto) → rechazado
r = await t.fetch(`http://${H}/r/shortonion`);
ok("301 → .onion inválido RECHAZADO", !r.ok && (r.error ?? "").startsWith("redirect_rechazado:"), `error=${r.error}`);

// 9. más de 5 saltos → redirect_max_hops
r = await t.fetch(`http://${H}/r/hop1`);
ok("cadena de 7 redirects → max_hops", !r.ok && r.error === "redirect_max_hops", `error=${r.error}`);

// 10. timeout preservado por salto (hop que cuelga)
const t0 = Date.now();
r = await t.fetch(`http://${H}/r/hangfirst`, { timeoutMs: 400 });
ok("timeout por salto", !r.ok && r.status === 0 && r.error !== null && Date.now() - t0 < 1500, `error=${r.error} elapsed=${Date.now() - t0}ms`);

// global: el proxy solo recibió CONNECTs a hosts .onion
ok("todos los CONNECTs del proxy fueron a hosts .onion", seenConnects.every((h) => h.endsWith(".onion")), seenConnects.slice(0, 3).join(","));

server.close();
const passed = results.filter(([, c]) => c).length;
console.log(`\n=== RESULTADO: ${passed}/${results.length} redirect tests OK ===`);
process.exit(passed === results.length ? 0 : 1);
