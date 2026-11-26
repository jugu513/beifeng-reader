/* 本地 mock 的 Edge 语音 WebSocket 服务端（零依赖，只做协议内自洽验证）
   用法：node tool/tests/mock-edge-wss.mjs [端口，默认 8810]
   页面侧把 WebSocket 改写指向它，即可验连接身份化关闭、请求串行、reqId 过滤、取消、截断判定。
   场景由 SSML 里的标记选择：SC:normal / SC:late / SC:trunc / SC:zero / SC:slow。
   GET /stats 返回 { conns, ssml, log }，供断言用。 */
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.argv[2] || 8810);
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const STALE_RID = '11111111-1111-4111-8111-111111111111';
const stats = { conns: 0, ssml: 0, log: [], vers: [] };

const acceptKey = (k) => crypto.createHash('sha1').update(k + GUID).digest('base64');

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, payload]);
}

function readFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); off = 10; }
  const maskLen = masked ? 4 : 0;
  if (buf.length < off + maskLen + len) return null;
  const mask = masked ? buf.subarray(off, off + 4) : null;
  off += maskLen;
  const payload = Buffer.from(buf.subarray(off, off + len));
  if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  return { opcode, payload, size: off + len };
}

function audioFrame(rid, count, unit) {
  const payload = Buffer.alloc(count * (unit || 100), 0x41);
  const hdr = Buffer.from('Path:audio\r\nX-RequestId:' + rid + '\r\nContent-Type:audio/mpeg\r\n\r\n', 'utf8');
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(hdr.length, 0);
  return encodeFrame(0x2, Buffer.concat([lenBuf, hdr, payload]));
}
const endFrame = (rid) => encodeFrame(0x1, Buffer.from('X-RequestId:' + rid + '\r\nPath:turn.end\r\n\r\n', 'utf8'));

const server = http.createServer((req, res) => {
  if (req.url === '/stats') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(stats));
    return;
  }
  if (req.url === '/reset') { stats.log.length = 0; stats.ssml = 0; stats.conns = 0; stats.vers.length = 0; res.writeHead(200).end('ok'); return; }
  res.writeHead(404).end('mock-edge: only /stats and /reset');
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  stats.conns += 1;
  /* 记下握手带过来的版本号：验证「UA 推导 vs 内置常量」走的是哪条路 */
  try {
    const v = new URL(req.url, 'http://127.0.0.1').searchParams.get('Sec-MS-GEC-Version');
    stats.vers.push(v || '(缺省)');
  } catch (e) { stats.vers.push('(解析失败)'); }
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + acceptKey(key) + '\r\n\r\n');
  let acc = Buffer.alloc(0);
  const send = (buf) => { try { socket.write(buf); } catch (e) {} };

  socket.on('data', (chunk) => {
    acc = Buffer.concat([acc, chunk]);
    for (;;) {
      const f = readFrame(acc);
      if (!f) break;
      acc = acc.subarray(f.size);
      if (f.opcode === 8) { socket.end(); return; }
      const text = f.payload.toString('utf8');
      if (text.indexOf('Path:speech.config') === 0) {
        send(encodeFrame(0x1, Buffer.from('X-RequestId:config\r\nPath:turn.start\r\nContent-Type:application/json; charset=utf-8\r\n\r\n{}', 'utf8')));
        continue;
      }
      if (text.indexOf('Path:ssml') !== 0) continue;
      const rm = /X-RequestId:([0-9a-fA-F-]+)/.exec(text);
      if (!rm) continue;
      const rid = rm[1];
      const sm = /SC:([a-z]+)/.exec(text);
      const sc = sm ? sm[1] : 'normal';
      stats.ssml += 1;
      stats.log.push({ rid, sc, t: Date.now() });
      if (sc === 'zero') { send(endFrame(rid)); continue; }
      if (sc === 'meta') {
        /* 真实服务端形态：词/句边界是**文本帧**（不是二进制），头部带 X-RequestId 与
           Path:audio.metadata，载荷 JSON 的 Offset/Duration 单位 100ns。 */
        send(audioFrame(rid, 3));
        send(encodeFrame(0x1, Buffer.from('X-RequestId:' + rid + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:audio.metadata\r\n\r\n' +
          JSON.stringify({ Metadata: [{ Type: 'SentenceBoundary', Data: { Offset: 1000000, Duration: 15375000, text: { Text: '测试句子。' } } }, { Type: 'WordBoundary', Data: { Offset: 1000000, Duration: 5000000, text: { Text: '测试' } } }] }), 'utf8')));
        send(endFrame(rid));
        continue;
      }
      if (sc === 'slow') {
        setTimeout(() => send(audioFrame(rid, 3)), 1500);
        setTimeout(() => send(endFrame(rid)), 1700);
        continue;
      }
      if (sc === 'trunc') {
        send(audioFrame(rid, 2));
        setTimeout(() => { try { socket.destroy(); } catch (e) {} }, 120);
        continue;
      }
      if (sc === 'late') {
        /* 上一句的迟到帧：reqId 对不上，必须被丢弃，否则拼进这一句的音频里 */
        send(audioFrame(STALE_RID, 1, 7));
        send(audioFrame(rid, 3));
        send(endFrame(rid));
        continue;
      }
      send(audioFrame(rid, 3));
      send(endFrame(rid));
    }
  });
  socket.on('error', () => {});
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('mock-edge-wss 已启动：ws://127.0.0.1:' + PORT + '  （/stats /reset）');
});
