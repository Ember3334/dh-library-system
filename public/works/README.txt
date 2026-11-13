数文拾光 · 摘星辰作品目录说明
================================

这里是「放作品」的地方。你把 HTML 文件丢进来，平台启动时会自动扫描上架，
不用在后台手动填路径。

两种放法都可以
--------------
【A. 单文件作品】直接放一个 .html
    public/works/我的作品.html
    → 自动识别为一件作品（期数默认第 1 期、代号默认取自文件名）

【B. 目录型作品】推荐，适合带图片/数据/多文件的
    public/works/03-天狼星-我的作品/
        index.html        ← 必须叫 index.html
        work.json         ← 可选，写期数、代号、简介、成员
        assets/           ← 图片、数据等随便放

work.json 可选字段
------------------
{
  "code": "天狼星",              // 星辰代号
  "issue_no": 3,                 // 第 N 期
  "title": "作品标题",
  "summary": "一两句简介",
  "members": "张三,李四",
  "tags": "贵州,民俗,可视化",
  "cover": "/works/03-天狼星-我的作品/assets/cover.jpg",
  "published_at": "2026-11-20",
  "mode": "embed",               // embed=页面内沙箱运行；window=只允许新窗口打开
  "sort": 10,
  "visible": 1
}

不写 work.json 也能跑
--------------------
平台会自动从 HTML 的 <title> 和 <meta name="description"> 里提标题与简介；
目录名按「序号-代号-标题」写（如 03-天狼星-我的作品）时，期数和代号也能自动认出来。

注意事项
--------
1. 单文件作品请确保不依赖本地绝对路径；需要 ES Module / localStorage / 下载文件的，
   把 work.json 里 mode 设为 "window"，阅读页会引导用「新窗口打开」获得完整能力。
2. 目录名以 . 或 _ 开头、以及 README 开头的会被忽略。
3. 删掉某件作品的文件后，平台下次扫描只会把它标记为「缺失并隐藏」，不会物理删除记录
   （防止误删你手工写过的简介）。确需彻底清掉，用：node scripts/scan-works.js --prune
4. 扫描时机：启动时自动扫 + 管理端「重新扫描」按钮 + 命令行 node scripts/scan-works.js
