import { pinyin } from 'pinyin-pro';

// ============================================================
// 频道 API
// ============================================================

const CHANNELS_API = 'https://laobaiepg.laobaitv.net/channels.json';
const LOGO_BASE = 'https://logo.laobaitv.net/';

// 缓存频道数据 (Worker 实例级别)
let cachedChannels = null;
let cachedAliasIndex = null;
let cacheTime = 0;
const CACHE_TTL = 3600 * 1000; // 1 小时

/**
 * 获取频道列表，带内存缓存
 * 优先通过 Service Binding 内部调用 EPG Worker（零延迟），fallback 到 HTTP fetch
 */
async function getChannels(env) {
  const now = Date.now();
  if (cachedChannels && (now - cacheTime) < CACHE_TTL) {
    return { channels: cachedChannels, aliasIndex: cachedAliasIndex };
  }

  let channels;
  if (env?.EPG_WORKER) {
    // Service Binding：内部调用，零延迟、不走公网
    const resp = await env.EPG_WORKER.fetch('https://laobaiepg.laobaitv.net/channels.json');
    if (!resp.ok) throw new Error(`EPG Service Binding 调用失败: ${resp.status}`);
    channels = await resp.json();
  } else {
    // Fallback：外部 HTTP fetch
    const resp = await fetch(CHANNELS_API, {
      headers: { 'User-Agent': 'iptv-editor/1.0' },
    });
    if (!resp.ok) throw new Error(`获取频道列表失败: ${resp.status}`);
    channels = await resp.json();
  }

  const aliasIndex = buildAliasIndex(channels);
  cachedChannels = channels;
  cachedAliasIndex = aliasIndex;
  cacheTime = now;
  return { channels, aliasIndex };
}

// ============================================================
// 繁简转换（频道名常见字）
// ============================================================

const T2S = {
  '臺':'台','衛':'卫','視':'视','電':'电','頻':'频','導':'导','錄':'录',
  '華':'华','國':'国','際':'际','經':'经','濟':'济','財':'财','軍':'军',
  '農':'农','業':'业','紀':'纪','實':'实','藝':'艺','樂':'乐','體':'体',
  '動':'动','畫':'画','聯':'联','網':'网','訊':'讯','報':'报','綜':'综',
  '節':'节','預':'预','劇':'剧','戲':'戏','場':'场','園':'园',
  '廣':'广','傳':'传','東':'东','車':'车','計':'计','學':'学',
  '達':'达','環':'环','勢':'势','點':'点','線':'线','調':'调','長':'长',
  '開':'开','關':'关','門':'门','間':'间','運':'运','聞':'闻',
  '與':'与','歡':'欢','風':'风','雲':'云','會':'会','寶':'宝',
  '歷':'历','書':'书','來':'来','類':'类','無':'无','衝':'冲',
  '現':'现','裡':'里','區':'区','鳳':'凤','黃':'黄','個':'个',
  '飛':'飞','夢':'梦','覺':'觉','優':'优','馬':'马','時':'时',
  '遊':'游','戰':'战','複':'复','號':'号','機':'机','愛':'爱','輪':'轮',
  '陽':'阳','萬':'万','連':'连','從':'从','獎':'奖','費':'费',
  '禮':'礼','識':'识','寫':'写','應':'应','對':'对',
  '轉':'转','據':'据','離':'离','資':'资','產':'产','務':'务',
  '員':'员','師':'师','鄉':'乡','專':'专','壽':'寿',
  '語':'语','說':'说','課':'课','論':'论','議':'议','護':'护',
  '賽':'赛','質':'质','響':'响','頭':'头','題':'题','養':'养',
  '齊':'齐','龍':'龙',
};

function t2s(str) {
  if (!str) return '';
  let result = '';
  for (const ch of str) {
    result += T2S[ch] || ch;
  }
  return result;
}

// ============================================================
// 画质标识处理
// ============================================================

// [^\w] 不匹配中文，改用 [\s\-_]* 只去掉分隔符，不误吞汉字
const QUALITY_SUFFIXES = /[\s\-_]*(4k|8k|hd|uhd|高清|标清|超清|蓝光|hdr|\[hdr\])$/gi;

/**
 * 去除画质标识后缀
 */
function stripQuality(name) {
  if (!name) return '';
  return name.replace(QUALITY_SUFFIXES, '').trim();
}

/**
 * 提取画质标识后缀
 */
function extractQuality(name) {
  if (!name) return '';
  const match = name.match(QUALITY_SUFFIXES);
  return match ? match[0].trim() : '';
}

// ============================================================
// 归一化
// ============================================================

/**
 * 归一化频道名
 * - 全角→半角
 * - 去空格
 * - 转小写
 * - 去画质后缀
 */
function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/[\s\-]/g, '')
    .replace(/(高清|标清|hd|4k|8k|uhd|超清|蓝光|hdr|\[hdr\])$/gi, '')
    .trim();
}

// ============================================================
// CCTV 正则
// ============================================================

const CCTV_REGEX = /^cctv[\-\s]*(\d{1,2}(?:\s*(?:plus|\+|k))?)/i;

function normalizeCCTV(name) {
  const cleaned = name.replace(/[\s\-]/g, '').toLowerCase();
  const m = cleaned.match(CCTV_REGEX);
  if (!m) return null;
  let num = m[1].replace(/\s+/g, '').toLowerCase();
  num = num.replace(/plus/i, '+');
  return 'CCTV' + num.toUpperCase();
}

// ============================================================
// 索引构建 & 频道查找
// ============================================================

function buildAliasIndex(channelList) {
  const index = new Map();
  for (const channel of channelList) {
    const names = [
      channel.id,
      channel.name,
      ...(channel.aliases || []),
    ].filter(Boolean);
    for (const name of names) {
      setIfAbsent(index, name, channel);
      setIfAbsent(index, name.toLowerCase(), channel);
      setIfAbsent(index, normalizeName(name), channel);
      const simplified = t2s(name);
      if (simplified !== name) {
        setIfAbsent(index, simplified, channel);
        setIfAbsent(index, normalizeName(simplified), channel);
      }
    }
  }
  return index;
}

function setIfAbsent(map, key, value) {
  if (key && !map.has(key)) map.set(key, value);
}

/**
 * 查找频道（匹配优先级）
 * 1. 精确匹配
 * 2. 归一化匹配
 * 3. 繁简转换匹配
 * 4. CCTV 正则匹配
 * 5. 去尾部字母数字匹配
 */
function findChannel(name, aliasIndex) {
  if (!name) return null;

  // 1. 精确匹配
  if (aliasIndex.has(name)) return aliasIndex.get(name);

  // 2. 归一化匹配
  const norm = normalizeName(name);
  if (norm && aliasIndex.has(norm)) return aliasIndex.get(norm);

  // 3. 繁→简转换后匹配
  const simplified = t2s(name);
  if (simplified !== name) {
    if (aliasIndex.has(simplified)) return aliasIndex.get(simplified);
    const normS = normalizeName(simplified);
    if (normS && aliasIndex.has(normS)) return aliasIndex.get(normS);
  }

  // 4. CCTV 正则匹配
  const cctvId = normalizeCCTV(name);
  if (cctvId && aliasIndex.has(cctvId)) return aliasIndex.get(cctvId);

  // 5. 去尾部字母/数字后匹配（模糊匹配）
  const stripped = norm.replace(/[a-z0-9]+$/, '').trim();
  if (stripped && stripped !== norm && aliasIndex.has(stripped)) return aliasIndex.get(stripped);

  return null;
}

// ============================================================
// 拼音转换
// ============================================================

/**
 * 将频道名转为全拼音小写 URL 路径
 * - 中文字符：全拼音（无声调、无空格）
 * - 非中文字符（字母、数字）：保留原样转小写
 * - 去掉连字符、空格等分隔符
 *
 * 示例：
 *   湖南卫视 → hunanweishi
 *   湖南卫视4K → hunanweishi4k
 *   CCTV-1 → cctv1
 *   CCTV5+ → cctv5+
 */
function toPinyinSlug(name) {
  if (!name) return '';

  // 逐字符处理：中文走拼音，非中文保持原样
  let result = '';
  for (const char of name) {
    if (/[\u4e00-\u9fff]/.test(char)) {
      // 中文字符：转全拼音
      const py = pinyin(char, { toneType: 'none', type: 'array' });
      result += py[0] || '';
    } else if (/[a-zA-Z0-9+]/.test(char)) {
      // 字母数字和+号保留
      result += char.toLowerCase();
    }
    // 其他字符（空格、连字符等）跳过
  }
  return result;
}

// ============================================================
// M3U 解析 & 处理
// ============================================================

/**
 * 解析 M3U 文件为结构化数据
 */
// 互联网直播分节标记（这些分节内的频道不做标准化）
const SKIP_SECTION_START = /^#{4,}\s*互联网直播频道\s*#{4,}/;
const SKIP_SECTION_END   = /^#{4,}\s*互联网直播频道end\s*#{4,}/i;

function parseM3U(content) {
  const lines = content.split(/\r?\n/);
  const entries = [];
  let header = '';
  let currentInfo = null;
  let inSkipSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (i === 0 && line.startsWith('#EXTM3U')) {
      header = line;
      continue;
    }

    // 检测分节边界
    if (SKIP_SECTION_START.test(line)) {
      inSkipSection = true;
      entries.push({ comment: line });
      currentInfo = null;
      continue;
    }
    if (SKIP_SECTION_END.test(line)) {
      inSkipSection = false;
      entries.push({ comment: line });
      currentInfo = null;
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      currentInfo = line;
    } else if (currentInfo && line.trim() && !line.startsWith('#')) {
      entries.push({ info: currentInfo, url: line, skipSection: inSkipSection });
      currentInfo = null;
    } else if (line.startsWith('##') || line.startsWith('#') && !line.startsWith('#EXTINF')) {
      // 注释行或分组标记，保留
      entries.push({ comment: line });
      currentInfo = null;
    }
  }

  return { header, entries };
}

/**
 * 从 #EXTINF 行提取频道显示名（逗号后的部分）
 */
function extractDisplayName(infoLine) {
  const match = infoLine.match(/,(.+)$/);
  return match ? match[1].trim() : '';
}

/**
 * 从 #EXTINF 行提取 tvg-name 属性
 */
function extractTvgName(infoLine) {
  const match = infoLine.match(/tvg-name="([^"]*)"/);
  return match ? match[1] : '';
}

/**
 * 更新 #EXTINF 行的属性
 */
function updateInfoLine(infoLine, updates) {
  let result = infoLine;
  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`${key}="[^"]*"`);
    if (regex.test(result)) {
      result = result.replace(regex, `${key}="${value}"`);
    } else {
      // 属性不存在，在 #EXTINF:-1 后插入
      result = result.replace(/(#EXTINF:[^,]*?)(\s)/, `$1 ${key}="${value}"$2`);
      // 如果上面没匹配到（没有空格的情况），在逗号前插入
      if (!result.includes(`${key}="`)) {
        result = result.replace(/,/, ` ${key}="${value}",`);
      }
    }
  }
  return result;
}

/**
 * 重建 #EXTINF 行，保证属性顺序：tvg-id → tvg-name → tvg-logo → group-title
 */
function rebuildInfoLine(tvgId, tvgName, tvgLogo, groupTitle, displayName) {
  return `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${tvgName}" tvg-logo="${tvgLogo}" group-title="${groupTitle}",${displayName}`;
}

/**
 * Logo URL 生成：去空格后直接拼中文路径（logo 服务支持中文 URL）
 */
function buildLogoUrl(name) {
  return LOGO_BASE + name.replace(/\s+/g, '');
}

/**
 * 根据 EPG 频道的 group/region 决定标准化后的 group-title
 * 规则：
 *   央视       → 央视频道
 *   卫视       → 卫视频道
 *   地方台+region → 北京频道/上海频道/山东频道 等
 *   地方台无region → 地方频道
 *   港澳台     → 港澳台
 *   其他       → 其他频道
 */
function resolveGroupTitle(channel) {
  const g = channel.group || '';
  if (g === '央视') return '央视频道';
  if (g === '卫视') return '卫视频道';
  if (g === '地方台') return channel.region || '地方频道';
  if (g === '港澳台') return '港澳台';
  if (g === '卫星') return '其他频道';
  if (g === '少儿') return '其他频道';
  if (g === '数字付费') return '其他频道';
  if (g === '海外') return '其他频道';
  if (g === '海外体育') return '其他频道';
  return '其他频道';
}

/**
 * 处理 M3U 文件
 * 返回处理后的内容和统计信息
 */
function processM3U(content, aliasIndex) {
  const { header, entries } = parseM3U(content);
  let matched = 0;
  let unmatched = 0;
  const unmatchedList = [];
  const processedEntries = [];

  for (const entry of entries) {
    if (entry.comment !== undefined) {
      processedEntries.push(entry);
      continue;
    }

    // 互联网直播分节内的内容不做标准化，原样保留
    if (entry.skipSection) {
      processedEntries.push(entry);
      continue;
    }

    const displayName = extractDisplayName(entry.info);
    const tvgName = extractTvgName(entry.info);
    // 用显示名或 tvg-name 进行匹配（优先显示名，通常更准确）
    const nameToMatch = displayName || tvgName;

    // 先去掉画质标识再匹配
    const baseName = stripQuality(nameToMatch);
    const qualitySuffix = extractQuality(nameToMatch);

    // 尝试匹配
    const channel = findChannel(baseName, aliasIndex) || findChannel(nameToMatch, aliasIndex);

    if (channel) {
      matched++;
      // 构建标准化的 tvg-name
      // 特判：channel.name 本身已含画质标识（如 CCTV-4K 超高清），不再附加 suffix
      const nameAlreadyHasQuality = qualitySuffix &&
        new RegExp(qualitySuffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(channel.name);
      const standardName = (qualitySuffix && !nameAlreadyHasQuality)
        ? channel.name + qualitySuffix
        : channel.name;
      // tvg-id 用 EPG 标准 id
      const tvgId = channel.id;
      // logo：始终用 standardName 构建，保留 4K 等画质后缀信息
      // 不使用 channel.logo_url（只有基础名，会导致4K logo退化）
      // logo 服务有变体回退：有4K专属logo用4K，没有自动回退基础版
      const logoSlug = /^cctv/i.test(channel.id) ? channel.id : standardName;
      const logo = buildLogoUrl(logoSlug);
      // 标准化 group-title：取第一级，按 EPG group+region 重写
      const groupTitle = resolveGroupTitle(channel);

      // 重建整行，保证属性顺序 tvg-id → tvg-name → tvg-logo → group-title
      const newInfo = rebuildInfoLine(tvgId, standardName, logo, groupTitle, standardName);
      processedEntries.push({ ...entry, info: newInfo });
    } else {
      unmatched++;
      unmatchedList.push(nameToMatch);
      // 匹配失败也做标准化：用显示名（去画质后缀）构建规范属性
      const unmatchedName = baseName; // 去画质后缀的显示名
      const unmatchedLogo = buildLogoUrl(unmatchedName);
      // group-title：保留原有 group-title 第一级（分号前），不做 EPG 重写
      const origGroupMatch = entry.info.match(/group-title="([^"]*)"/);
      const origGroup = origGroupMatch ? origGroupMatch[1].split(';')[0].trim() : '';
      const newInfo = rebuildInfoLine(unmatchedName, unmatchedName, unmatchedLogo, origGroup, displayName);
      processedEntries.push({ ...entry, info: newInfo });
    }
  }

  // 重建 M3U
  let output = header ? header + '\n' : '#EXTM3U\n';
  for (const entry of processedEntries) {
    if (entry.comment !== undefined) {
      output += entry.comment + '\n';
    } else {
      output += entry.info + '\n' + entry.url + '\n';
    }
  }

  return {
    content: output.trimEnd() + '\n',
    stats: { total: matched + unmatched, matched, unmatched, unmatchedList },
  };
}

// ============================================================
// Worker 入口
// ============================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // POST /api/process - 处理 M3U
    if (request.method === 'POST' && url.pathname === '/api/process') {
      try {
        const body = await request.json();
        const m3uContent = body.content;
        if (!m3uContent || !m3uContent.trim()) {
          return Response.json({ error: 'M3U 内容为空' }, { status: 400, headers: corsHeaders });
        }

        const { aliasIndex } = await getChannels(env);
        const result = processM3U(m3uContent, aliasIndex);

        return Response.json({
          content: result.content,
          stats: result.stats,
        }, { headers: corsHeaders });
      } catch (err) {
        console.error('处理失败:', err);
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // GET / - 前端页面
    return new Response(HTML, {
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
    });
  },
};

// ============================================================
// 前端 HTML
// ============================================================

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>M3U 播放列表标准化工具</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
    background: #f0f2f5;
    color: #1a1a2e;
    min-height: 100vh;
    padding: 2rem 1rem;
  }
  .container {
    max-width: 800px;
    margin: 0 auto;
  }
  h1 {
    text-align: center;
    font-size: 1.8rem;
    margin-bottom: 0.5rem;
    color: #1a1a2e;
  }
  .subtitle {
    text-align: center;
    color: #666;
    margin-bottom: 2rem;
    font-size: 0.95rem;
  }
  .card {
    background: #fff;
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
    box-shadow: 0 2px 12px rgba(0,0,0,0.06);
  }
  .card h2 {
    font-size: 1.1rem;
    margin-bottom: 1rem;
    color: #333;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  /* 上传区域 */
  .upload-area {
    border: 2px dashed #d0d5dd;
    border-radius: 8px;
    padding: 2rem;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    margin-bottom: 1rem;
  }
  .upload-area:hover, .upload-area.dragover {
    border-color: #4a90e2;
    background: #f8faff;
  }
  .upload-area .icon { font-size: 2rem; margin-bottom: 0.5rem; }
  .upload-area p { color: #666; font-size: 0.9rem; }
  .upload-area .filename { color: #4a90e2; font-weight: 600; margin-top: 0.5rem; }
  input[type="file"] { display: none; }
  /* 文本框 */
  .paste-area {
    width: 100%;
    min-height: 150px;
    border: 1px solid #d0d5dd;
    border-radius: 8px;
    padding: 0.75rem;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 0.85rem;
    resize: vertical;
    outline: none;
    transition: border-color 0.2s;
  }
  .paste-area:focus { border-color: #4a90e2; }
  .or-divider {
    text-align: center;
    color: #999;
    margin: 1rem 0;
    font-size: 0.85rem;
  }
  /* 按钮 */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.7rem 1.5rem;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-primary {
    background: #4a90e2;
    color: #fff;
    width: 100%;
    justify-content: center;
  }
  .btn-primary:hover { background: #357abd; }
  .btn-primary:disabled { background: #a0b3c4; cursor: not-allowed; }
  .btn-success {
    background: #28a745;
    color: #fff;
    width: 100%;
    justify-content: center;
    margin-top: 1rem;
  }
  .btn-success:hover { background: #218838; }
  /* 统计 */
  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .stat-item {
    text-align: center;
    padding: 1rem;
    border-radius: 8px;
    background: #f8f9fa;
  }
  .stat-item .number {
    font-size: 2rem;
    font-weight: 700;
    line-height: 1.2;
  }
  .stat-item .label {
    font-size: 0.85rem;
    color: #666;
    margin-top: 0.25rem;
  }
  .stat-item.success .number { color: #28a745; }
  .stat-item.fail .number { color: #dc3545; }
  .stat-item.total .number { color: #4a90e2; }
  /* 未匹配列表 */
  .unmatched-list {
    margin-top: 1rem;
    max-height: 200px;
    overflow-y: auto;
    border: 1px solid #e9ecef;
    border-radius: 8px;
    padding: 0.75rem;
    font-size: 0.85rem;
  }
  .unmatched-list h3 {
    font-size: 0.9rem;
    color: #dc3545;
    margin-bottom: 0.5rem;
  }
  .unmatched-list ul { list-style: none; }
  .unmatched-list li {
    padding: 0.25rem 0;
    color: #666;
    border-bottom: 1px solid #f0f0f0;
  }
  .unmatched-list li:last-child { border-bottom: none; }
  /* 隐藏 */
  .hidden { display: none; }
  /* 加载 */
  .spinner {
    display: inline-block;
    width: 1.2rem;
    height: 1.2rem;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  /* footer */
  .footer {
    text-align: center;
    margin-top: 2rem;
    color: #999;
    font-size: 0.8rem;
  }
  .footer a { color: #4a90e2; text-decoration: none; }
</style>
</head>
<body>
<div class="container">
  <h1>📺 M3U 播放列表标准化</h1>
  <p class="subtitle">自动匹配频道名称，标准化 tvg-id / tvg-name / tvg-logo</p>

  <!-- 输入 -->
  <div class="card">
    <h2>📂 上传或粘贴 M3U 文件</h2>
    <div class="upload-area" id="uploadArea">
      <div class="icon">📁</div>
      <p>点击选择文件或拖拽 M3U/M3U8 文件到此处</p>
      <div class="filename hidden" id="fileName"></div>
    </div>
    <input type="file" id="fileInput" accept=".m3u,.m3u8,.txt">
    <div class="or-divider">—— 或直接粘贴内容 ——</div>
    <textarea class="paste-area" id="pasteArea" placeholder="#EXTM3U&#10;#EXTINF:-1 tvg-name=&quot;CCTV-1&quot;,CCTV-1综合&#10;http://example.com/stream1&#10;..."></textarea>
  </div>

  <!-- 处理按钮 -->
  <button class="btn btn-primary" id="processBtn" disabled>
    🚀 开始标准化处理
  </button>

  <!-- 结果 -->
  <div class="card hidden" id="resultCard">
    <h2>📊 处理结果</h2>
    <div class="stats">
      <div class="stat-item total">
        <div class="number" id="statTotal">0</div>
        <div class="label">总频道数</div>
      </div>
      <div class="stat-item success">
        <div class="number" id="statMatched">0</div>
        <div class="label">匹配成功</div>
      </div>
      <div class="stat-item fail">
        <div class="number" id="statUnmatched">0</div>
        <div class="label">未匹配</div>
      </div>
    </div>
    <div class="unmatched-list hidden" id="unmatchedSection">
      <h3>⚠️ 未匹配的频道（保留原始信息）</h3>
      <ul id="unmatchedList"></ul>
    </div>
    <button class="btn btn-success" id="downloadBtn">
      ⬇️ 下载处理后的 M3U 文件
    </button>
  </div>

  <div class="footer">
    <p>数据来源：<a href="https://epg.laobaitv.net" target="_blank">LaobaiEPG</a> · 
    Logo：<a href="https://logo.laobaitv.net" target="_blank">logo.laobaitv.net</a></p>
  </div>
</div>

<script>
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const fileName = document.getElementById('fileName');
const pasteArea = document.getElementById('pasteArea');
const processBtn = document.getElementById('processBtn');
const resultCard = document.getElementById('resultCard');
const downloadBtn = document.getElementById('downloadBtn');

let m3uContent = '';
let processedContent = '';

// 上传区域点击
uploadArea.addEventListener('click', () => fileInput.click());

// 拖拽
uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('dragover'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', e => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});

// 文件选择
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
});

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    m3uContent = e.target.result;
    pasteArea.value = m3uContent;
    fileName.textContent = file.name;
    fileName.classList.remove('hidden');
    updateBtn();
  };
  reader.readAsText(file);
}

// 粘贴输入
pasteArea.addEventListener('input', () => {
  m3uContent = pasteArea.value;
  updateBtn();
});

function updateBtn() {
  processBtn.disabled = !m3uContent.trim();
}

// 处理
processBtn.addEventListener('click', async () => {
  const content = pasteArea.value || m3uContent;
  if (!content.trim()) return;

  processBtn.disabled = true;
  processBtn.innerHTML = '<span class="spinner"></span> 处理中...';
  resultCard.classList.add('hidden');

  try {
    const resp = await fetch('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const data = await resp.json();

    if (data.error) throw new Error(data.error);

    processedContent = data.content;
    const stats = data.stats;

    document.getElementById('statTotal').textContent = stats.total;
    document.getElementById('statMatched').textContent = stats.matched;
    document.getElementById('statUnmatched').textContent = stats.unmatched;

    const unmatchedSection = document.getElementById('unmatchedSection');
    const unmatchedList = document.getElementById('unmatchedList');
    if (stats.unmatched > 0 && stats.unmatchedList.length > 0) {
      unmatchedList.innerHTML = stats.unmatchedList.map(n => '<li>' + escHtml(n) + '</li>').join('');
      unmatchedSection.classList.remove('hidden');
    } else {
      unmatchedSection.classList.add('hidden');
    }

    resultCard.classList.remove('hidden');
  } catch (err) {
    alert('处理失败: ' + err.message);
  } finally {
    processBtn.disabled = false;
    processBtn.innerHTML = '🚀 开始标准化处理';
  }
});

// 下载
downloadBtn.addEventListener('click', () => {
  if (!processedContent) return;
  const blob = new Blob([processedContent], { type: 'application/vnd.apple.mpegurl' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'normalized_playlist.m3u';
  a.click();
  URL.revokeObjectURL(url);
});

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
</script>
</body>
</html>`;
