/* 本地 mock 的 OpenAI 兼容 /models 接口（零依赖），只为验「拉取模型」这条链路：
   路径 /v1/models 返回一个模型数组，/nope/models 返回 404，鉴权头缺失返回 401。
   用法：node tool/tests/mock-openai-models.mjs [端口，默认 8899] */
import http from 'node:http';

const PORT = Number(process.argv[2] || 8899);
const MODELS = {
  data: [
    { id: 'mock-chat-large', object: 'model' },
    { id: 'mock-chat-small', object: 'model' },
    { id: 'mock-embed', object: 'model' },
  ],
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Authorization, api-key, Content-Type, Accept',
  'access-control-max-age': '600',
};

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  const url = (req.url || '/').split('?')[0];
  const auth = req.headers.authorization || req.headers['api-key'] || '';
  if (!auth) { res.writeHead(401, Object.assign({ 'content-type': 'application/json' }, CORS)); res.end(JSON.stringify({ error: 'missing key' })); return; }
  if (url === '/v1/models' || url === '/models') {
    res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, CORS));
    res.end(JSON.stringify(MODELS));
    return;
  }
  res.writeHead(404, Object.assign({ 'content-type': 'application/json' }, CORS));
  res.end(JSON.stringify({ error: 'no such route: ' + url }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('mock-openai-models: http://127.0.0.1:' + PORT + '/v1/models');
});
