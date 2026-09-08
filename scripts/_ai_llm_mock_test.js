// 用本地 mock 的 OpenAI 兼容接口验证「LLM 工具增强」链路（不需要真实 Key）
// 运行：node scripts/_ai_llm_mock_test.js
const http = require('http');

// 1) 起一个假的 chat/completions 服务：第一轮返回工具 JSON，第二轮返回最终答案
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const payload = JSON.parse(body || '{}');
    const sys = (payload.messages[0] || {}).content || '';
    let content;
    if (sys.includes('工具调度器')) content = '{"tool":"search","args":{"keywords":"历史"}}';
    else content = '已为你检索到相关馆藏，推荐优先阅读《中国大历史 明史》。';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
  });
});

server.listen(3999, async () => {
  process.env.LLM_API_URL = 'http://127.0.0.1:3999/v1/chat/completions';
  process.env.LLM_API_KEY = 'mock-key';
  process.env.LLM_MODEL = 'mock-model';
  const ai = require('../server/ai');

  console.log('status:', JSON.stringify(ai.status()));
  const r = await ai.answer('帮我找几本历史的书', { uid: 1 });
  console.log('intent:', r.intent, '| mode:', r.mode, '| books:', (r.books || []).length);
  console.log('reply:', r.reply);

  // 异常兜底：指向不可达地址时必须回落到离线结果，不能报错
  process.env.LLM_API_URL = 'http://127.0.0.1:9/v1/chat/completions';
  const r2 = await ai.answer('馆藏有多少本书', { uid: 1 });
  console.log('fallback mode:', r2.mode, '| intent:', r2.intent);
  console.log('fallback reply:', String(r2.reply).split('\n')[0]);

  ai.resetSession(1);
  server.close();
});
