# iptv-editor (pinyin-worker)

M3U/M3U8 播放列表编辑工具 — 基于 Cloudflare Workers，自动为 IPTV 频道生成拼音 Logo URL 并管理 tvg-id。

## 功能

- **tvg-logo 标准化**：根据频道名自动生成拼音缩写，替换为 `https://logo.laobaitv.net/{拼音}` 格式
- **tvg-id 管理**：三种模式 — 清空 / 保留原有 / 继承频道名 (tvg-name)
- **特殊拼音规则**：支持自定义映射（如 湖北→hub、河北→heb、山西→shanx、陕西→shannx 等消歧义）
- **Web UI**：拖拽上传 M3U 文件，选择处理选项，在线下载处理结果

## 技术架构

```
Cloudflare Worker (JavaScript + pinyin-pro)
├── GET  /     → HTML 上传界面
└── POST /     → 处理 M3U 内容，返回处理后的文件
                 ├── Header: X-TvgId-Option (clear|keep|from-name)
                 └── Body: 原始 M3U 文本
```

### 依赖

| 包名 | 用途 |
|------|------|
| `pinyin-pro` | 中文转拼音首字母 |

### 绑定资源

无外部绑定（纯计算型 Worker）。

## 部署

```bash
npm install
wrangler deploy
```

## 配置

- `wrangler.jsonc` 中 Worker 名称为 `iptv-editor`
- 特殊拼音映射在 `src/index.js` 顶部的 `specialMappings` 对象中维护

## 处理逻辑

1. 遍历 M3U 的 `#EXTINF` 行
2. 提取 `tvg-name` 属性值
3. 按选项处理 `tvg-id`（清空/保留/继承）
4. 对频道名进行拼音转换：特殊规则优先 → 占位符替换 → pinyin-pro 取首字母 → 还原占位符
5. 生成新的 `tvg-logo` URL
