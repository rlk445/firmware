/* Servidor do VR Stream (sem dependências, só Node.js).
   - serve o jogo em http://localhost:8080
   - faz a "sinalização" entre a página do jogo (PC) e o app do celular (WebSocket em /ws)
   - abre o Chrome/Edge do PC já no modo certo */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), cp = require('child_process');
const ROOT = __dirname, PORT = +process.env.PORT || 8080, GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', webmanifest: 'application/manifest+json',
  wasm: 'application/wasm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', ico: 'image/x-icon', txt: 'text/plain; charset=utf-8',
  tflite: 'application/octet-stream', binarypb: 'application/octet-stream', data: 'application/octet-stream', mp3: 'audio/mpeg', wav: 'audio/wav', woff2: 'font/woff2' };
const EXTRA = process.argv.slice(2).filter(a => /^[a-z]+=[\w.]+$/i.test(a)).map(a => '&' + a).join('');      // ex.: node server.js h=540 fps=60 mbps=10
const GAME_URL = 'http://localhost:' + PORT + '/index.html?host=1' + EXTRA;
const stamp = () => new Date().toLocaleTimeString();
const log = m => console.log('[' + stamp() + '] ' + m);

const VIRTUAL = /vethernet|virtualbox|vmware|vmnet|hyper-v|wsl|docker|vbox|loopback|tailscale|zerotier|hamachi|npcap|bluetooth|tap-|tun|vpn|host-only/i;
function lanList() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal && !/^169\.254\./.test(i.address)) {
    const virt = VIRTUAL.test(name) || /^192\.168\.(56|99|137|232)\./.test(i.address) || /^172\.(1[6-9]|2\d|3[01])\./.test(i.address) && /^172\.(17|18|19|2\d|3[01])\.0\.1$/.test(i.address);
    const sc = (virt ? 10 : 0) + (/^192\.168\./.test(i.address) ? 0 : /^10\./.test(i.address) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(i.address) ? 2 : 3) + (/wi-?fi|wlan|wireless|sem fio|ethernet/i.test(name) ? -1 : 0);
    out.push({ ip: i.address, name, virt, sc });
  }
  return out.sort((a, b) => a.sc - b.sc);
}
const lanIps = () => lanList().map(x => x.ip);

// ---------- arquivos estáticos ----------
const BLOCK = /^\/(server\.js|iniciar\.|ios\/|\.github\/|node_modules\/)/;
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end('400'); }
  if (p === '/info') {
    const ra = (req.socket.remoteAddress || '').replace('::ffff:', ''); if (ra !== '127.0.0.1' && ra !== '::1') log('[CELULAR] alcançou o servidor (' + ra + ') — rede e firewall OK');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' }); return res.end(JSON.stringify({ ips: lanIps(), port: PORT }));
  }
  if (p === '/controle' || p === '/controle/') p = '/pad/index.html';
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep) || BLOCK.test(p)) { res.writeHead(403); return res.end('403'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    res.end(data);
  });
});

// ---------- WebSocket mínimo (RFC 6455: texto, ping/pong, close) ----------
function frame(op, payload) {
  const n = payload.length; let h;
  if (n < 126) h = Buffer.from([0x80 | op, n]);
  else if (n < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(n, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([h, payload]);
}
const peers = { host: null, phone: null, pad: null };            // host = página do jogo no PC, phone = app do celular
const other = r => (r === 'host' ? 'phone' : 'host');      // o controle (pad) só conversa com o jogo (host)
const sendTo = (c, text) => { if (c && !c.socket.destroyed) try { c.socket.write(frame(1, Buffer.from(text))); } catch (e) {} };
const NAME = { host: 'PC] página do jogo', phone: 'CELULAR] app', pad: 'CONTROLE] celular-controle' };

server.on('upgrade', (req, socket) => {
  const u = new URL(req.url, 'http://x'), role = u.searchParams.get('role');
  if (u.pathname !== '/ws' || !(role === 'host' || role === 'phone' || role === 'pad') || !req.headers['sec-websocket-key']) { socket.destroy(); return; }
  const acc = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  socket.setNoDelay(true);
  const c = { socket, role, buf: Buffer.alloc(0), frags: [] };
  const old = peers[role]; peers[role] = c; if (old && old !== c) { try { old.socket.destroy(); } catch (e) {} }
  log('[' + NAME[role] + ' conectou');
  sendTo(c, JSON.stringify({ t: 'peer', role: other(role), on: !!peers[other(role)] }));
  sendTo(peers[other(role)], JSON.stringify({ t: 'peer', role, on: true }));
  const gone = () => { if (c.dead) return; c.dead = true; if (peers[role] === c) { peers[role] = null; log('[' + NAME[role] + ' saiu'); sendTo(peers[other(role)], JSON.stringify({ t: 'peer', role, on: false })); } };
  socket.on('close', gone); socket.on('error', gone); socket.on('end', gone);
  socket.on('data', d => {
    c.buf = Buffer.concat([c.buf, d]);
    for (;;) {
      const b = c.buf; if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 15, masked = !!(b[1] & 0x80); let len = b[1] & 127, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > 4e6) { socket.destroy(); return; }
      if (b.length < off + (masked ? 4 : 0) + len) return;
      let payload = b.subarray(off + (masked ? 4 : 0), off + (masked ? 4 : 0) + len);
      if (masked) { const m = b.subarray(off, off + 4), o = Buffer.alloc(len); for (let i = 0; i < len; i++) o[i] = payload[i] ^ m[i & 3]; payload = o; }
      c.buf = b.subarray(off + (masked ? 4 : 0) + len);
      if (op === 8) { try { socket.write(frame(8, Buffer.alloc(0))); } catch (e) {} socket.end(); return; }
      if (op === 9) { socket.write(frame(10, payload)); continue; }
      if (op === 10) continue;
      if (op === 0 || op === 1) {
        c.frags.push(payload); if (!fin) continue;
        const text = Buffer.concat(c.frags).toString('utf8'); c.frags = [];
        sendTo(peers[other(role)], text);
      }
    }
  });
});

// ---------- abrir o navegador ----------
function findBrowser() {
  const env = process.env, cand = [];
  if (process.platform === 'win32') {
    for (const b of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]) if (b) {
      cand.push(path.join(b, 'Google/Chrome/Application/chrome.exe'), path.join(b, 'Microsoft/Edge/Application/msedge.exe'));
    }
  } else if (process.platform === 'darwin') cand.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  else cand.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  return cand.find(f => fs.existsSync(f));
}
function openBrowser(url) {
  const exe = findBrowser();
  if (!exe) { console.log('\n  Não achei o Chrome nem o Edge. Abra você mesmo (de preferência no Chrome): ' + url + '\n'); return; }
  const args = ['--app=' + url, '--user-data-dir=' + path.join(os.homedir(), '.vr-stream-perfil'), '--window-size=1000,600', '--no-first-run', '--no-default-browser-check',
    '--disable-features=WebRtcHideLocalIpsWithMdns,CalculateNativeWinOcclusion', '--autoplay-policy=no-user-gesture-required',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
  try { cp.spawn(exe, args, { detached: true, stdio: 'ignore' }).unref(); } catch (e) { console.log('Não consegui abrir o navegador: ' + e.message + '\nAbra: ' + url); }
}

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.log('\n  A porta ' + PORT + ' já está em uso. Feche a outra janela preta do servidor (ou o programa que usa essa porta) e tente de novo.\n');
  else console.log('Erro do servidor: ' + e.message);
  process.exit(1);
});
server.listen(PORT, '0.0.0.0', () => {
  const list = lanList(), line = '='.repeat(60), good = list.filter(x => !x.virt), main = (good[0] || list[0]);
  console.log('\n' + line + '\n  VR STREAM — servidor ligado (deixe esta janela aberta)\n' + line);
  console.log('\n  No app do celular, digite este IP do PC:\n');
  if (main) console.log('      >>>  ' + main.ip + '  <<<      (' + main.name + ')');
  else console.log('      (nenhuma rede encontrada — conecte o PC ao Wi-Fi)');
  const others = list.filter(x => x !== main);
  if (others.length) { console.log('\n  Outros (só use se o de cima não funcionar):'); others.forEach(x => console.log('      ' + x.ip + '   (' + x.name + (x.virt ? ', rede virtual' : '') + ')')); }
  if (main) console.log('\n  TESTE RÁPIDO: no Safari do iPhone abra  http://' + main.ip + ':' + PORT + '/info\n  Se aparecer um texto, a rede está certa. Se não abrir, é Firewall ou Wi-Fi diferente.');
  if (main) console.log('\n  CONTROLE (2o celular, ex.: Galaxy A14): abra no Chrome dele  http://' + main.ip + ':' + PORT + '/controle');
  console.log('\n  O jogo abre sozinho no Chrome/Edge. Se não abrir, use:\n      ' + GAME_URL + '\n\n' + line + '\n');
  if (!process.argv.includes('--no-open')) openBrowser(GAME_URL);
});
