# 幸运飞艇实时监控

本项目包含：
- 单一 SQLite 数据库：`data/lottery.db`
- 守护抓取：每 10 秒同步一次
- 自动去重：按期号 `roundno` 唯一
- 自动回测：新期开奖到达后，自动评估上期开奖结果预测
- 多模型融合预测：频率 / 近因 / 缺口 / 转移 四路融合
- 实时面板：`http://127.0.0.1:3000`
- 模块列表页：`http://127.0.0.1:3000/modules`
- 独立实时监控页：`http://127.0.0.1:3000/monitor`
- 监控页细分：同步 / 训练权重 / 预测 / 回测 / 提示
- 开机自启：`systemd/xingchen-lottery.service`

## 启动

```bash
node src/server.js
```

## 训练融合模型（可选）

先用现有历史数据生成一个可选的训练权重文件，然后服务会在下一次构建预测时优先读取它：

```bash
node scripts/train-fusion-model.js
```

默认会生成：`data/sequence-model.json`

如果该文件不存在，服务会自动回退到当前的规则融合逻辑，不影响现有运行中的服务。

页面里会明确显示：
- 训练来源：API 历史优先，失败时回退本地库
- 为什么启用/回退：训练模型状态和说明会同步显示在首页与模块页

> 说明：当前版本是“**训练的转移/先验模型 + 现有趋势融合**”的组合。
> 后续如果你要更强的模型，可以再把它升级成 LightGBM / XGBoost 的多分类训练器。

## 安装为开机服务

```bash
sudo ./scripts/install-service.sh
```

## 数据源

- 当前开奖接口：`https://yun.citi668.com/ui-04/index.aspx/Chawinning_Two`
- 历史列表接口：`https://yun.citi668.com/ui-04/detail.aspx/GetWinningnohistoryList`

## Domain / HTTPS

- Domain: `https://xinyun.7700.eu.org`
- HTTP -> HTTPS redirect: enabled via nginx
- Certificate: Let's Encrypt, auto-renew enabled
- Reverse proxy config: `deploy/nginx-xinyunfei.conf`
- One-click HTTPS helper: `deploy/enable-https.sh`

## UI Pages

- Home dashboard: `https://xinyun.7700.eu.org/`
- Module list: `https://xinyun.7700.eu.org/modules`
- Model progress is shown on the dashboard.

## Layout notes

- Top3 cards are shown left/right as current issue and next issue.
- The `冠亚和 / 龙虎` block is rendered as a horizontal banner layout for easier scanning.
- Model progress has its own dedicated card on the dashboard.

## Layout notes

- Top3 is shown side-by-side: current issue on the left, next issue on the right.
- `冠亚和 / 龙虎` is placed below Top3 in a banner-style layout.
- `最近 30 开奖内容` is moved ahead of the trend block for faster scanning.
- `最近 30 期走势` is kept compact to reduce page height.
## HTTPS / deployment

- Nginx reverse proxy: `80/443 -> 127.0.0.1:3000`
- TLS certificate: Let's Encrypt via certbot
- Public URL: `https://xinyun.7700.eu.org/`
- UFW allows `80/tcp`, `443/tcp`, `22/tcp`
