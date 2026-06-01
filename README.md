# vx1

独立 xv1 彩票监控与预测面板。

## 内容

- `src/server.js`：采集、数据库、预测、API、页面服务
- `public/xv1-*.html`：xv1 独立页面
- `public/xv1-gpt55-bypass.html`：GPT5.5 旁路 v2 模块
- `public/xv1-gpt55-bypass-v3.html`：GPT5.5 旁路 v3 自适应权重模块
- `data/sequence-model.json`：主序列模型摘要
- `data/xv1-sequence-model.json`：xv1 独立模型摘要
- `data/datasets/xv1_timeseq_training_merged.*`：xv1 训练数据包
- `scripts/`、`systemd/`、`deploy/`：训练、服务和部署辅助文件

## 运行

```bash
npm install
PORT=3001 NODE_ENV=production node src/server.js
```

默认：

- 主站端口：`PORT` 环境变量
- xv1 域名逻辑：`xv1.7700.eu.org`
- 健康检查：`/health`
- API：`/api/summary`

## 旁路模型

- v2：`/gpt55-bypass`
- v3：`/gpt55-bypass-v3`

旁路模型为 shadow-only：只展示、只回测、不覆盖主模型输出。

## 注意

本仓库不包含运行态 SQLite 数据库文件、SSH 私钥、备份目录、个人记忆文件。
