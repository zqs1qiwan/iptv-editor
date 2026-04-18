import { pinyin } from 'pinyin-pro';

// ----------------------------------------------------
// 特殊规则 - 您可以方便地在此处增添新规则
// ----------------------------------------------------
/**
 * 特殊规则映射表。
 * 键 (key) 是您想要特殊处理的频道名称（或其一部分）。
 * 值 (value) 是您想指定的拼音缩写。
 * 规则会优先于自动拼音生成，并与剩余部分组合。
 */
const specialMappings = {
  '湖北': 'hub',
  '河北': 'heb',
  '海南': 'ly',
  '山西': 'shanx',
  '陕西': 'shannx',
  '湖南': 'hun',
  '河南': 'hen',
  // 在这里添加更多规则，例如:
  // 'CCTV-1': 'cctv1',
};


// ----------------------------------------------------
// 后端处理逻辑
// ----------------------------------------------------

/**
 * 处理 M3U 内容的核心函数
 * @param {string} content 原始 M3U 文件内容
 * @param {string} tvgIdOption tvg-id 的处理选项 ('clear', 'keep', 'from-name')
 * @returns {string} 处理后的 M3U 内容
 */
function processM3U(content, tvgIdOption = 'clear') {
  const lines = content.split(/\r?\n/);
  const newLines = [];

  for (const line of lines) {
    let processedLine = line;

    if (line.trim().startsWith('#EXTINF:')) {
      // 1. 提取频道名称 (后续 tvg-id 和 tvg-logo 都需要用)
      const nameMatch = line.match(/tvg-name="([^"]+)"/);
      const channelName = (nameMatch && nameMatch[1]) ? nameMatch[1] : '';

      // 2. 根据选项处理 tvg-id
      switch (tvgIdOption) {
        case 'clear':
          // 选项1: 清空 tvg-id
          processedLine = line.replace(/tvg-id="[^"]*"/g, 'tvg-id=""');
          break;
        case 'from-name':
          // 选项3: 继承频道名 tvg-name 作为 tvg-id
          if (channelName) {
            processedLine = line.replace(/tvg-id="[^"]*"/g, `tvg-id="${channelName}"`);
          } else {
            // 如果 tvg-name 也为空，则清空 tvg-id
            processedLine = line.replace(/tvg-id="[^"]*"/g, 'tvg-id=""');
          }
          break;
        case 'keep':
          // 选项2: 保留原有 tvg-id - 不做任何处理
          // processedLine 保持为原始 line
          break;
        default:
          // 默认情况，清空 tvg-id
          processedLine = line.replace(/tvg-id="[^"]*"/g, 'tvg-id=""');
      }

      // 3. 处理 tvg-logo (基于第1步提取的 channelName)
      if (channelName) {
        let pinyinInitials = '';
        let tempName = channelName;
        const replacements = {};

        // 3.1 查找并替换所有特殊词为占位符
        for (const [key, value] of Object.entries(specialMappings)) {
          if (tempName.includes(key)) {
            const placeholder = `__${value.toUpperCase()}__`;
            tempName = tempName.replace(new RegExp(key, 'g'), placeholder);
            replacements[placeholder] = value;
          }
        }
        
        // 3.2 对包含占位符的字符串进行拼音处理
        let processedPinyin = pinyin(tempName, { pattern: 'first', toneType: 'none' }).replace(/\s/g, '');

        // 3.3 将占位符替换回我们指定的特殊拼音
        for (const [placeholder, value] of Object.entries(replacements)) {
          processedPinyin = processedPinyin.replace(new RegExp(placeholder, 'g'), value);
        }
        pinyinInitials = processedPinyin;
        
        // 3.4 更新 tvg-logo
        if (pinyinInitials) {
          const newLogoUrl = `https://logo.laobaitv.net/${pinyinInitials}`;
          // 注意：这里是在已经处理过 tvg-id 的 processedLine 上继续操作
          processedLine = processedLine.replace(/tvg-logo="[^"]*"/g, `tvg-logo="${newLogoUrl}"`);
        }
      }
    }
    newLines.push(processedLine);
  }
  return newLines.join('\n');
}


// ----------------------------------------------------
// Worker 入口和前端界面
// ----------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'POST') {
      try {
        const m3uContent = await request.text();
        
        // 从请求头获取 tvg-id 处理选项，默认为 'clear'
        const tvgIdOption = request.headers.get('X-TvgId-Option') || 'clear';

        if (!m3uContent) {
          return new Response('M3U content is empty.', { status: 400 });
        }
        
        // 将选项传递给核心处理函数
        const processedContent = processM3U(m3uContent, tvgIdOption);
        
        return new Response(processedContent, {
          headers: {
            'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
            'Content-Disposition': 'attachment; filename="processed_playlist.m3u"',
          },
        });
      } catch (error) {
        console.error('Processing failed:', error);
        return new Response(`An error occurred: ${error.message}`, { status: 500 });
      }
    } else {
      // GET 请求，返回 HTML 界面
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
  },
};

// ----------------------------------------------------
// 前端 HTML 界面
// ----------------------------------------------------

const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>laobaitv iptv m3u editor</title>
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
      line-height: 1.6; 
      /* 需求4: 更改为柔和护眼的背景色 */
      background-color: #F4F8F7; 
      color: #333; 
      display: flex; 
      justify-content: center; 
      align-items: center; 
      min-height: 100vh; 
      margin: 0; 
    }
    .container { 
      background: #fff; 
      padding: 2rem 3rem; 
      border-radius: 12px; 
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.1); 
      max-width: 600px; 
      width: 90%; 
      text-align: center; 
    }
    /* 需求1: 更改标题 */
    h1 { color: #1a2b4d; }
    p { color: #5a6b8c; }
    
    /* 需求3: 新增 tvg-id 选项样式 */
    .options { 
      margin: 1.5rem 0; 
      padding: 1rem;
      border: 1px solid #e0e6ed;
      border-radius: 8px;
      text-align: left; 
      background-color: #fdfdfd;
    }
    .options p { 
      margin-top: 0;
      margin-bottom: 0.8rem; 
      font-weight: bold;
      color: #333;
    }
    .options label { 
      display: block; 
      margin-bottom: 0.5rem; 
      cursor: pointer; 
      font-weight: normal;
      color: #333;
    }
    .options input { 
      margin-right: 0.5rem; 
      vertical-align: middle;
    }

    .upload-box { 
      border: 2px dashed #d0d9e6; 
      padding: 2rem; 
      border-radius: 8px; 
      margin: 2rem 0; 
      cursor: pointer; 
      transition: background-color 0.3s, border-color 0.3s; 
    }
    .upload-box:hover { background-color: #f9fafb; border-color: #4a90e2; }
    #fileName { margin-top: 1rem; color: #4a90e2; font-weight: bold; }
    input[type="file"] { display: none; }
    button { background-color: #4a90e2; color: white; border: none; padding: 0.8rem 1.5rem; border-radius: 8px; font-size: 1rem; font-weight: bold; cursor: pointer; transition: background-color 0.3s; }
    button:disabled { background-color: #a0b3c4; cursor: not-allowed; }
    #downloadLink { display: none; margin-top: 1.5rem; text-decoration: none; font-weight: bold; color: #28a745; }
  </style>
</head>
<body>
  <div class="container">
    <h1>laobaitv iptv m3u editor</h1>
    <p>本工具自动处理 M3U/M3U8 播放列表，标准化 tvg-logo 并提供灵活的 tvg-id 管理选项。</p>

    <div class="options">
      <p>tvg-id 处理选项:</p>
      <label>
        <input type="radio" name="tvgIdOption" value="clear" checked>
        清空 tvg-id (默认)
      </label>
      <label>
        <input type="radio" name="tvgIdOption" value="keep">
        保留原有 tvg-id
      </label>
      <label>
        <input type="radio" name="tvgIdOption" value="from-name">
        继承频道名 (tvg-name)
      </label>
    </div>

    <div class="upload-box" id="uploadBox">
      <p>点击此处选择文件</p>
      <div id="fileName"></div>
    </div>
    <input type="file" id="m3uFile" accept=".m3u,.m3u8" />
    <button id="processButton" disabled>处理文件</button>
    <a id="downloadLink">下载处理好的文件</a>
  </div>

  <script>
    const uploadBox = document.getElementById('uploadBox');
    const fileInput = document.getElementById('m3uFile');
    const fileNameDisplay = document.getElementById('fileName');
    const processButton = document.getElementById('processButton');
    const downloadLink = document.getElementById('downloadLink');
    let m3uContent = '';

    uploadBox.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (file) {
        fileNameDisplay.textContent = file.name;
        processButton.disabled = false;
        downloadLink.style.display = 'none';
        const reader = new FileReader();
        reader.onload = (e) => { m3uContent = e.target.result; };
        reader.readAsText(file);
      }
    });

    processButton.addEventListener('click', async () => {
      if (!m3uContent) { alert('请先选择一个文件。'); return; }

      // 需求3: 获取选中的 tvg-id 选项
      const selectedTvgIdOption = document.querySelector('input[name="tvgIdOption"]:checked').value;

      processButton.textContent = '处理中...';
      processButton.disabled = true;

      try {
        const response = await fetch(window.location.href, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            // 需求3: 将选项作为请求头发给后端
            'X-TvgId-Option': selectedTvgIdOption
          },
          body: m3uContent
        });

        if (!response.ok) {
          throw new Error('服务器处理失败: ' + await response.text());
        }
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        downloadLink.href = url;
        downloadLink.download = 'processed_' + (fileInput.files[0].name || 'playlist.m3u');
        downloadLink.style.display = 'block';

      } catch (error) {
        alert('发生错误: ' + error.message);
      } finally {
        processButton.textContent = '处理文件';
        processButton.disabled = false;
      }
    });
  </script>
</body>
</html>
`;