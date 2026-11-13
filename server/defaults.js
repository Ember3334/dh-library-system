'use strict';
// 站点文案默认值 + 管理端表单 schema（v2.1）
// 约定：settings 表只存「覆盖值」；这里给出全量默认值，前端/导出/快照都按 mergedSettings() 取。
// 改文案有三种方式：① 后台 #/manage → 站点设置；② 直接改本文件（改默认值）；③ 清 settings 表某 key 即回落默认。

const DEFAULTS = {
  // ---------- 站点身份 ----------
  'site.name': '数文拾光',
  'site.nameFull': '数文拾光 · 数字人文协会',
  'site.tagline': '宇宙 · 书库 · 摘星辰 · 资讯',
  'site.org': '贵州师范大学 数文拾光 · 数字人文协会',
  'site.description': '数文拾光 · 数字人文平台：学院真实馆藏、协会可视化实践成果与数字人文资讯。',
  'site.footer': '数文拾光 · 数字人文协会 · 贵州师范大学',
  'site.contact': '联系：数文拾光 · 数字人文协会',

  // ---------- 首页（宇宙） ----------
  'home.h1': '数文拾光',
  'home.h1Accent': '数字人文宇宙',
  'home.sub': '馆藏是星 · 作品是行星 · 资讯是星轨 —— 拖动旋转星系，点击星球进入版块',
  'home.searchPlaceholder': '搜索馆藏书名 / 作者 / 标签…',
  'home.galaxyTitle': '🌌 数字人文宇宙',
  'home.galaxySub': '书库旋臂 · 摘星辰行星 · 资讯星轨 · 点击星球直达',
  'home.portal1Title': '书库',
  'home.portal1Desc': '学院真实馆藏 · 检索与详情',
  'home.portal2Title': '摘星辰',
  'home.portal2Desc': '协会可视化作品 · 分期陈列',
  'home.portal3Title': '资讯 · 专业',
  'home.portal3Desc': '数字人文动态 · 工具与学习资源',

  // ---------- 书库 ----------
  'library.h1': '书库',
  'library.sub': '数字人文学院图书室真实馆藏 · 每本书都可查看详情与 AI 导读',
  'library.searchPlaceholder': '搜索书名 / 作者 / 标签 / 索书号…',

  // ---------- 摘星辰 ----------
  'works.h1': '摘星辰',
  'works.sub': '危楼高百尺，手可摘星辰 —— 数文拾光 · 数字人文协会周期性可视化实践计划，每期成果皆有一颗专属星辰',
  'works.emptyTitle': '第一期成果整理中，敬请期待 ✨',
  'works.emptyHint': '摘星辰计划：2026.10.26 — 12.12，每周一期',
  'works.sandboxHint': '作品以沙箱模式内嵌运行；若需保存进度、下载等完整功能，请点右上角「新窗口打开」',

  // ---------- 资讯 ----------
  'news.h1': '资讯 · 专业',
  'news.sub': '数字人文领域动态 · 前沿时事 · 实用工具 · 学习资源',
  'news.categories': '动态,时事,项目与赛事,工具,学习资源',
  'news.sourceHint': '每条资讯均标注来源，点击可跳转浏览器查看原文'
};

// 管理端「站点设置」表单结构：group 分组，type 决定控件
const SCHEMA = [
  {
    group: '站点身份',
    items: [
      { key: 'site.name', label: '站点简称', type: 'text', hint: '顶栏品牌名' },
      { key: 'site.nameFull', label: '完整名称', type: 'text' },
      { key: 'site.tagline', label: '顶栏副标', type: 'text', hint: '默认「宇宙 · 书库 · 摘星辰 · 资讯」' },
      { key: 'site.org', label: '组织署名', type: 'text' },
      { key: 'site.description', label: '站点简介', type: 'textarea', hint: '浏览器 meta description' },
      { key: 'site.footer', label: '页脚文字', type: 'text' },
      { key: 'site.contact', label: '联系方式', type: 'text' }
    ]
  },
  {
    group: '首页 · 数字人文宇宙',
    items: [
      { key: 'home.h1', label: '主标题', type: 'text' },
      { key: 'home.h1Accent', label: '主标题高亮词', type: 'text', hint: '后半句，会加渐变强调' },
      { key: 'home.sub', label: '副标题', type: 'textarea' },
      { key: 'home.searchPlaceholder', label: '检索框占位符', type: 'text' },
      { key: 'home.galaxyTitle', label: '星系区标题', type: 'text' },
      { key: 'home.galaxySub', label: '星系区副标', type: 'text' },
      { key: 'home.portal1Title', label: '板块卡 1 标题', type: 'text' },
      { key: 'home.portal1Desc', label: '板块卡 1 说明', type: 'text' },
      { key: 'home.portal2Title', label: '板块卡 2 标题', type: 'text' },
      { key: 'home.portal2Desc', label: '板块卡 2 说明', type: 'text' },
      { key: 'home.portal3Title', label: '板块卡 3 标题', type: 'text' },
      { key: 'home.portal3Desc', label: '板块卡 3 说明', type: 'text' }
    ]
  },
  {
    group: '书库',
    items: [
      { key: 'library.h1', label: '标题', type: 'text' },
      { key: 'library.sub', label: '副标题', type: 'textarea' },
      { key: 'library.searchPlaceholder', label: '检索框占位符', type: 'text' }
    ]
  },
  {
    group: '摘星辰',
    items: [
      { key: 'works.h1', label: '标题', type: 'text' },
      { key: 'works.sub', label: '副标题', type: 'textarea' },
      { key: 'works.emptyTitle', label: '空状态文案', type: 'text' },
      { key: 'works.emptyHint', label: '空状态补充', type: 'text' },
      { key: 'works.sandboxHint', label: '作品阅读页提示', type: 'textarea' }
    ]
  },
  {
    group: '资讯 · 专业',
    items: [
      { key: 'news.h1', label: '标题', type: 'text' },
      { key: 'news.sub', label: '副标题', type: 'textarea' },
      { key: 'news.categories', label: '分类（逗号分隔）', type: 'text', hint: '顺序即筛选条顺序，第一个为「全部」之后的首项' },
      { key: 'news.sourceHint', label: '来源提示语', type: 'text' }
    ]
  }
];

const KEYS = Object.keys(DEFAULTS);
const SCHEMA_KEYS = SCHEMA.reduce((a, g) => a.concat(g.items.map(i => i.key)), []);

module.exports = { DEFAULTS, SCHEMA, KEYS, SCHEMA_KEYS };
