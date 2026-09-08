// AI 馆员智能体离线能力冒烟测试
// 运行：node scripts/_ai_agent_test.js
const ai = require('../server/ai');

const CASES = [
  '你好',
  '你是谁？你能做什么',
  '推荐几本书',
  '推荐 3 本历史的书',
  '有没有 Python 入门的书',
  '介绍一下《乡土中国》',
  '《活着》在哪，能借吗',
  '跟《活着》类似的书',
  '鲁迅有什么书',
  '馆藏有多少本书？',
  '热门榜',
  '有哪些分类？',
  '历史有什么书？',
  '这本书口碑怎么样？',
  '我借了哪些书？',
  '借期是多久？',
  '逾期怎么办',
  '换一批',
  '第 2 本',
  'asdfghjkl莫名其妙的问题'
];

(async () => {
  console.log('状态：', JSON.stringify(ai.status()));
  console.log('='.repeat(60));
  for (const q of CASES) {
    const r = await ai.answer(q, { uid: 1 });
    console.log('\n【问】' + q);
    console.log('【意图】' + r.intent + '  【模式】' + r.mode + '  【书目】' + (r.books || []).length + ' 本');
    console.log('【答】' + String(r.reply).replace(/\n/g, '\n      '));
    if (r.chips && r.chips.length) console.log('【建议】' + r.chips.join(' | '));
  }
  console.log('\n' + '='.repeat(60));
  const b = ai.findBook('活着');
  if (b) {
    const d = await ai.digest(b, { uid: 1 });
    console.log('【导读】' + b.title + ' → ' + String(d.reply).replace(/\n/g, '\n      '));
  }
  ai.resetSession(1);
})();
