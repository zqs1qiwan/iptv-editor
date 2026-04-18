# iptv-editor

M3U 播放列表标准化工具。自动匹配频道名称，标准化 `tvg-id`、`tvg-name`、`tvg-logo` 属性。

## 功能

- **频道智能匹配**：根据 [LaobaiEPG](https://epg.laobaitv.net) 频道数据库自动匹配频道名
- **tvg-id 标准化**：使用标准频道名（去掉 4K/HD 等画质后缀）作为 tvg-id
- **tvg-name 标准化**：使用完整标准频道名（含画质后缀）作为 tvg-name
- **tvg-logo 标准化**：根据 tvg-name 的全拼音生成 logo URL（`https://logo.laobaitv.net/<拼音>`）
- **保留原始显示名**：输出 M3U 中频道显示名称（逗号后）保持原始不变

## 匹配算法

匹配时先去掉画质标识（4K/HD/超清等），再按以下优先级匹配：

1. **精确匹配** — 直接命中频道名、ID 或别名
2. **归一化匹配** — 去空格、统一大小写、全角转半角后比较
3. **繁简转换** — 繁体转简体后重新匹配
4. **CCTV 正则** — `CCTV-1`、`CCTV 1`、`cctv1综合` 等变体自动归一化
5. **模糊匹配** — 去掉尾部字母数字后匹配（如 `浙江卫视HD` → `浙江卫视`）

## 4K/HD 处理规则

| 输入频道名 | tvg-id | tvg-name | tvg-logo |
|-----------|--------|----------|----------|
| 湖南卫视 4K | 湖南卫视 | 湖南卫视4K | `logo.laobaitv.net/hunanweishi4k` |
| CCTV-1 | CCTV1 | CCTV1 | `logo.laobaitv.net/cctv1` |

## 拼音转换规则

- 中文字符 → 全拼音小写，无声调无空格
- 字母数字 → 原样保留（转小写）
- 连字符/空格 → 去除

示例：`湖南卫视` → `hunanweishi`，`CCTV-1` → `cctv1`，`湖南卫视4K` → `hunanweishi4k`

## 开发

```bash
npm install
npm run dev     # 本地开发
npm run deploy  # 部署到 Cloudflare Workers
```

## 技术栈

- Cloudflare Workers
- [pinyin-pro](https://github.com/zh-lx/pinyin-pro) — 拼音转换
- [LaobaiEPG API](https://api.laobaitv.net/channels.json) — 频道数据源
