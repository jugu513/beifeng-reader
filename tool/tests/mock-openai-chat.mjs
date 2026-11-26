/* 本地 mock 的 OpenAI 兼容 /chat/completions（零依赖，SSE）：
   先发 reasoning_content（模拟深度思考），再发 content，最后 [DONE]。
   只为验 AI 中心的流式渲染、推理折叠、动作栏与发送/停止同键，不联网。 */
import http from 'node:http';

const PORT = Number(process.argv[2] || 8899);
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'Authorization, api-key, Content-Type, Accept',
  'access-control-max-age': '600',
};

const REASON = ['先看问题问的是什么。', '这本书里相关的是第三章的冲突。', '把结论压成三句。'];
const ANSWER = ['这一章的核心冲突是**信任**：', '主角必须先承认自己判断错了，', '才可能接受对方的帮助。'];

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, CORS)); res.end('{"ok":true}'); return; }
  if (req.method !== 'POST' || !/\/chat\/completions$/.test(req.url || '')) {
    res.writeHead(404, CORS); res.end('mock-chat: 只实现 POST /v1/chat/completions'); return;
  }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) {}
    /* model 名含 -500 就回 500：网关的熔断、重试与降级要一个「确定会失败」的端点，
       401/404 都被判成配置问题不计失败，用它测不出熔断。 */
    if (/-500/.test(String(body.model || ''))) {
      res.writeHead(500, Object.assign({ 'content-type': 'application/json' }, CORS));
      res.end(JSON.stringify({ error: { message: 'mock 故意返回 500' } }));
      return;
    }
    if (!body.stream) {
      res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, CORS));
      res.end(JSON.stringify({ id: 'mock', model: 'mock-chat', choices: [{ message: { role: 'assistant', content: ANSWER.join('') } }], usage: { total_tokens: 12 } }));
      return;
    }
    res.writeHead(200, Object.assign({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }, CORS));
    const send = (obj) => { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) {} };
    let i = 0;
    const tick = setInterval(() => {
      if (i < REASON.length) { send({ choices: [{ delta: { reasoning_content: REASON[i] } }] }); i++; return; }
      const k = i - REASON.length;
      if (k < ANSWER.length) { send({ choices: [{ delta: { content: ANSWER[k] } }] }); i++; return; }
      clearInterval(tick);
      send({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 42 } });
      try { res.write('data: [DONE]\n\n'); res.end(); } catch (e) {}
    }, 120);
    /* 注意挂 res 的 close，不是 req 的：req 在请求体读完就 close，
       挂错了会把定时器立刻清掉——表现是"连上了但一个字节都不发"。 */
    res.on('close', () => clearInterval(tick));
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log('mock-openai-chat: http://127.0.0.1:' + PORT + '/v1/chat/completions');
});
