# iptv-editor

M3U 播放列表标准化工具。自动匹配频道名称，统一规范 `tvg-id`、`tvg-name`、`tvg-logo`、`group-title` 属性。

## 功能

- **频道智能匹配**：通过 [LaobaiEPG](https://laobaiepg.laobaitv.net) 频道数据库自动匹配频道名（Service Binding 内部调用，零延迟）
- **tvg-id 标准化**：使用 EPG 标准频道 ID（去掉连字符/空格，不含画质后缀）
- **tvg-name 标准化**：使用 EPG 标准频道名 + 可选画质后缀（如 `湖南卫视4K`）
- **tvg-logo 标准化**：`https://logo.laobaitv.net/<频道名去空格连字符>`，4K 频道使用含画质后缀的路径（如 `湖南卫视4K`），由 logo 服务自动回退
- **group-title 规范化**：按 EPG 分类重写（央视频道/卫视频道/北京频道/地方频道等）
- **未匹配频道也标准化**：找不到对应 EPG 条目的频道，tvg-id/logo 同样去掉连字符和空格，group-title 保留原始分类
- **互联网直播保护**：`######互联网直播频道######` 分节内的频道不做任何修改

## 匹配算法

匹配时先去掉画质标识（4K/HD/超清等），再按以下优先级匹配：

1. **精确匹配** — 直接命中频道名、ID 或别名
2. **归一化匹配** — 去空格、统一大小写、全角转半角后比较
3. **繁简转换** — 繁体转简体后重新匹配
4. **CCTV 正则** — `CCTV-1`、`CCTV 1`、`cctv1综合` 等变体自动归一化
5. **模糊匹配** — 去掉尾部字母数字后匹配（如 `浙江卫视HD` → `浙江卫视`）

## 属性规范

输出 EXTINF 属性顺序固定：`tvg-id → tvg-name → tvg-logo → group-title`

| 输入频道名 | tvg-id | tvg-name | tvg-logo |
|-----------|--------|----------|----------|
| `湖南卫视 4K` | `hunanweishi` | `湖南卫视4K` | `logo.laobaitv.net/湖南卫视4K` |
| `CCTV-1` | `CCTV1` | `CCTV1` | `logo.laobaitv.net/CCTV1` |
| `CCTV4K超高清` | `CCTV4K` | `CCTV-4K 超高清` | `logo.laobaitv.net/CCTV4K` |
| `CCTV-风云音乐`（未匹配）| `CCTV风云音乐` | `CCTV-风云音乐` | `logo.laobaitv.net/CCTV风云音乐` |

**logo URL 规则：**
- 去掉所有连字符（`-`）和空格
- CCTV 系列使用 `channel.id`（如 `CCTV1`、`CCTV4K`、`CCTV5+`）
- 有专属 4K logo（如 `湖南卫视4K.png`）则精确匹配，没有则由 logo 服务自动回退到普通版

## 使用

**在线工具（推荐）：** https://m3u-editor.laobaitv.net/

**API 调用：**

```bash
curl -s -X POST https://m3u-editor.laobaitv.net/process \
  -H "Content-Type: text/plain" \
  -H "Origin: https://m3u-editor.laobaitv.net" \
  --data-binary @your.m3u \
  -o output.m3u
```

## 开发

```bash
npm install
npm run dev     # 本地开发
npm run deploy  # 部署到 Cloudflare Workers
```

## 技术栈

- Cloudflare Workers + Service Binding（内部调用 LaobaiEPG Worker）
- [pinyin-pro](https://github.com/zh-lx/pinyin-pro) — 拼音转换（用于频道匹配归一化）
- [LaobaiEPG](https://laobaiepg.laobaitv.net) — 频道数据源
