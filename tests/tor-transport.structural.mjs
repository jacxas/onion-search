// FARO — test estructural de TorTransport sin Tor real.
// Mock SOCKS5h: valida handshake, DNS remoto, timeout, error SOCKS,
// retry/backoff, truncado maxBytes e integración con el crawler (health).
import net from "node:net";
import assert from "node:assert";

const { makeTorTransport } = await import("../.worker-build/src/lib/tor/transport.js");
const { healthSweep } = await import("../.worker-build/src/crawler/health.js");

const results = [];
function ok(name, cond, extra = "") {
  results.push([name, !!cond, extra]);
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
}

// ---------- Mock SOCKS5 ----------
function startMock(port, mode) {
  const seen = [];
  const server = net.createServer((socket) => {
    let phase = "greet";
    socket.on("data", (buf) => {
      if (phase === "greet") {
        assert.strictEqual(buf[0], 0x05, "debe ser SOCKS5");
        socket.write(Buffer.from([0x05, 0x00])); // sin autenticación
        phase = "req";
        return;
      }
      if (phase === "req") {
        // CONNECT: VER CMD RSV ATYP ADDR PORT
        assert.strictEqual(buf[1], 0x01, "debe ser CONNECT");
        const atyp = buf[3];
        let host, off;
        if (atyp === 0x03) {
          const len = buf[4];
          host = buf.slice(5, 5 + len).toString("utf8");
          off = 5 + len;
        } else if (atyp === 0x01) {
          host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
          off = 8;
        } else {
          host = "ipv6";
          off = 20;
        }
        const port = buf.readUInt16BE(off);
        seen.push({ atyp, host, port });
        if (mode === "serve" || mode === "bigbody") {
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0x1f, 0x90])); // success
          phase = "relay";
          setTimeout(() => {
            const body =
              mode === "bigbody"
                ? "x".repeat(600 * 1024)
                : "<html><head><title>Mock Onion</title></head><body><a href='http://abc.onion/'>l</a></body></html>";
            const head = `HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n`;
            if (mode !== "bigbody") { socket.write(head + body); return; }
            // cuerpo grande: chunks de 64KB respetando backpressure
            socket.write(head);
            const chunk = Buffer.from(body, "utf8");
            const writeChunk = (offset) => {
              const end = Math.min(offset + 64 * 1024, chunk.length);
              if (!socket.write(chunk.slice(offset, end))) { socket.once("drain", () => writeChunk(end)); return; }
              if (end < chunk.length) writeChunk(end); else socket.end();
            };
            writeChunk(0);
          }, 30);
        } else if (mode === "socks_error") {
          socket.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0])); // general failure
          socket.end();
        } else if (mode === "hang") {
          // silencio: provoca timeout del cliente
        }
      }
    });
    if (mode === "close_early") socket.destroy();
  });
  return new Promise((res) => server.listen(port, "127.0.0.1", () => res({ server, seen })));
}

const serve = await startMock(9151, "serve");
const hang = await startMock(9152, "hang");
const errP = await startMock(9153, "socks_error");
const big = await startMock(9154, "bigbody");

const ONION56 = "xm5cnymuzhtgyhlypp4atjbupx7gzmuxnayvfpvpbeyq5wn3lnfrd6dx";

// 1) handshake + HTTP vía proxy + DNS REMOTO (hostname viaja al proxy)
const t = makeTorTransport("socks5h://127.0.0.1:9151");
const r1 = await t.fetch(`http://${ONION56}.onion/`);
ok("handshake SOCKS5 + fetch HTTP 200", r1.ok && r1.status === 200 && r1.body.includes("Mock Onion"));
ok("resolución .onion delegada al proxy (socks5h)", serve.seen[0].atyp === 0x03 && serve.seen[0].host === `${ONION56}.onion`, `ATYP=domain host=${serve.seen[0].host}`);
ok("puerto destino correcto", serve.seen[0].port === 80);

// 2) timeout (AbortSignal) con proxy silencioso
const t2 = makeTorTransport("socks5h://127.0.0.1:9152");
const r2 = await t2.fetch(`http://${ONION56}.onion/`, { timeoutMs: 1500 });
ok("timeout con abort (proxy silencioso)", !r2.ok && r2.status === 0 && r2.error, `error=${r2.error} elapsed=${r2.elapsedMs}ms`);
ok("timeout respeta timeoutMs", r2.elapsedMs >= 1400 && r2.elapsedMs < 3000, `${r2.elapsedMs}ms`);

// 3) error SOCKS (reply general failure)
const t3 = makeTorTransport("socks5h://127.0.0.1:9153");
const r3 = await t3.fetch(`http://${ONION56}.onion/`);
ok("error de transporte SOCKS propagado", !r3.ok && r3.status === 0 && !!r3.error, `error=${r3.error}`);

// 4) retry/backoff desde el crawler (fetchWithRetry)
const { fetchWithRetry } = await import("../.worker-build/src/crawler/fetch.js");
const st = Date.now();
const fr = await fetchWithRetry(t2, `http://${ONION56}.onion/`, 1);
const dur = Date.now() - st;
ok("retry: fetchWithRetry hace 2 intentos (más retry interno de undici)", hang.seen.length >= 2 && hang.seen.length <= 4, `connects SOCKS=${hang.seen.length}`);
ok("backoff exponencial aplicado (2×timeout config + 4s)", fr.error && dur >= 23000 && dur <= 26000, `total=${dur}ms (esperado ~24s: 2×10s+4s)`);

// 5) truncado maxBytes
const t5 = makeTorTransport("socks5h://127.0.0.1:9154");
const r5 = await t5.fetch(`http://${ONION56}.onion/`, { maxBytes: 512 * 1024 });
console.log("DEBUG r5:", JSON.stringify({ok: r5.ok, status: r5.status, error: r5.error, len: r5.body?.length, elapsed: r5.elapsedMs}));
ok("maxBytes trunca cuerpo (512KB)", r5.ok && r5.body.length === 512 * 1024, `len=${r5.body?.length}`);

// 6) integración con el crawler: healthSweep con transporte mock
const { db } = await import("../.worker-build/src/db/index.js");
const d = db();
await d.execute(`INSERT INTO sites (domain, url, title, blocked) VALUES ('mocktarget.onion', 'http://mocktarget.onion/', 'Mock Target', false) ON CONFLICT (domain) DO NOTHING`);
const sweep = await healthSweep(t, { force: true, limit: 1 });
const rows = await d.execute(`SELECT hc.status_code, hc.online, hc.response_ms FROM health_checks hc JOIN sites s ON s.id = hc.site_id WHERE s.domain = 'mocktarget.onion' ORDER BY hc.checked_at DESC LIMIT 1`);
const hc = rows.rows?.[0];
ok("integración crawler: health check registrado vía transporte mock", sweep.checked >= 1 && hc?.online === true && hc?.status_code === 200, `status=${hc?.status_code}`);
await d.execute(`DELETE FROM health_checks WHERE site_id = (SELECT id FROM sites WHERE domain = 'mocktarget.onion'); DELETE FROM sites WHERE domain = 'mocktarget.onion';`);

// resumen
const fails = results.filter(([, c]) => !c);
console.log(`\n=== RESULTADO: ${results.length - fails.length}/${results.length} estructurales OK ===`);
serve.server.close(); hang.server.close(); errP.server.close(); big.server.close();
process.exit(fails.length ? 1 : 0);
