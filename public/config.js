// 前端连接后端配置
// 本地开发：保持空字符串，系统会自动使用同域（localhost:3000）
// 远程部署：把后端平台给你的 https 域名填到 API_BASE，例如：
//   window.API_BASE = 'https://your-app.zeabur.app';
//   window.STATIC_BASE = 'https://your-app.zeabur.app';
//
// 说明：
// - API_BASE：所有 /api/... 接口的前缀
// - STATIC_BASE：封面 /covers/... 等静态资源的前缀，通常与 API_BASE 相同
// - 打开本地 HTML 文件使用时，必须填上远程后端域名，否则接口请求会失败
window.API_BASE = '';
window.STATIC_BASE = '';
