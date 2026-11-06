/* Browser-local character recipe and image generation workspace. */
(() => {
  'use strict';
  const root = document.getElementById('studioWorkspace');
  if (!root) return;
  const KEY = 'pose_studio_v1';
  const SLOT_LABEL = { portrait: '人像', costume: '服装', pose: '姿势' };
  const STYLES = [
    ['none', '跟随参考图', ''],
    ['photo', '写实人像写真', '写实人像摄影，自然肤质，真实布料质感。'],
    ['magazine', '日韩杂志画报', '日韩时尚杂志画报，柔和自然光，简洁构图。'],
    ['film', '复古胶片写真', '复古胶片摄影，细腻颗粒，低饱和色彩。'],
    ['game', '2.5D 游戏原画', '2.5D 游戏角色原画，细腻材质，清晰人物轮廓。'],
    ['anime', '日系二次元插画', '日系二次元插画，清晰线稿，精致赛璐璐上色。'],
    ['cinema', '日系动画电影', '日系动画电影画面，通透色彩，细腻光影。'],
    ['manga', '黑白漫画网点', '日式黑白漫画，精细线条与网点明暗。'],
    ['render', '3D 次世代角色', '3D 次世代游戏角色渲染，物理材质，精细建模。'],
    ['figure', '3D 潮玩手办', '3D 潮玩手办，精致涂装，棚拍产品质感。'],
    ['cyber', '赛博朋克霓虹', '赛博朋克风格，霓虹灯光，科技服装细节。'],
    ['sheet', '纯白角色设定', '角色设定集立绘，纯白背景，完整展示服装与身体轮廓。'],
  ];
  const PROVIDERS = {
    gemini: ['Google Gemini', 'https://generativelanguage.googleapis.com/v1beta', 'gemini-2.5-flash-image'],
    openai: ['OpenAI 图像兼容', 'https://api.openai.com/v1', 'gpt-image-1'],
    qwen: ['阿里云百炼 Qwen', 'https://dashscope.aliyuncs.com/api/v1', 'qwen-image-edit-plus'],
    doubao: ['火山方舟 Doubao', 'https://ark.cn-beijing.volces.com/api/v3', 'doubao-seedream-4-0-250828'],
    comfyui: ['本地 ComfyUI', 'http://127.0.0.1:8188', ''],
  };
  const ANGLE = {
    正面: 'front view, eye-level camera',
    俯视: 'slightly high-angle view, camera looking down',
    仰视: 'low-angle view, camera looking up',
    侧面: 'side profile view, eye-level camera',
    斜视: 'three-quarter front view, eye-level camera',
  };
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const q = (selector) => root.querySelector(selector);
  const json = (id) => {
    try {
      return JSON.parse(document.getElementById(id)?.textContent || '{}');
    } catch {
      return {};
    }
  };
  const data = json('referenceData');
  const prompts = json('promptData');
  const poses = json('poseData');
  const catalogs = {
    pose: Array.isArray(poses)
      ? poses.map((item) => ({
          ...item,
          kind: 'pose',
          prompt: [ANGLE[item.angle], prompts[item.pose]].filter(Boolean).join(', '),
          sourceLabel: 'ギア',
          sourceUrl: 'https://ai-pose-gallery.pages.dev/',
          depthFull: `https://ai-pose-depth-gallery.pages.dev/img/${encodeURIComponent(item.id)}.png`,
          nsfw: /性感|双人|sexy|pair/i.test(`${item.line} ${item.id}`),
        }))
      : [],
    costume: data.costumes || [],
    portrait: data.portraits || [],
  };
  const canonical = new Map(
    Object.values(catalogs)
      .flat()
      .map((item) => [item.id, item]),
  );
  let page = 'poses',
    recipe = {
      portrait: null,
      costume: null,
      pose: null,
      extras: [],
      style: 'none',
      prompt: '',
      useDepth: false,
    },
    history = [],
    results = [],
    busy = false,
    controller = null,
    status = '',
    statusError = false,
    provider = 'gemini',
    profiles = {},
    apiKey = '',
    workflow = null,
    pending = null,
    allowSensitive = false;
  let dbPromise;
  let recipeRevision = 0;
  let saveTimer;
  const cleanProfile = (raw = {}, name = provider) => ({
    baseUrl: String(raw.baseUrl || PROVIDERS[name][1]).slice(0, 2000),
    model: String(raw.model || PROVIDERS[name][2]).slice(0, 200),
    size: String(raw.size || '1024x1024'),
    quality: ['auto', 'low', 'medium', 'high'].includes(raw.quality) ? raw.quality : 'auto',
    background: ['auto', 'opaque', 'transparent'].includes(raw.background) ? raw.background : 'auto',
    aspectRatio: String(raw.aspectRatio || '1:1'),
    resolution: ['1K', '2K', '4K'].includes(raw.resolution) ? raw.resolution : '1K',
    width: Math.max(64, Math.min(8192, Number(raw.width) || 1024)),
    height: Math.max(64, Math.min(8192, Number(raw.height) || 1024)),
    seed: Math.max(0, Number(raw.seed) || 0),
    promptExtend: raw.promptExtend !== false,
    watermark: raw.watermark === true,
    overrideWorkflow: raw.overrideWorkflow === true,
  });
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    provider = PROVIDERS[saved.provider] ? saved.provider : 'gemini';
    for (const name of Object.keys(PROVIDERS)) profiles[name] = cleanProfile(saved.profiles?.[name], name);
  } catch {
    /* private/file storage may be unavailable */
  }
  const profile = () => {
    profiles[provider] = cleanProfile(profiles[provider], provider);
    return profiles[provider];
  };
  const saveSettings = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: 1, provider, profiles }));
    } catch {
      setStatus('接口设置保存失败，请检查浏览器存储空间。', true);
    }
  };
  function db() {
    if (!dbPromise)
      dbPromise = new Promise((resolve, reject) => {
        if (!indexedDB) return reject(new Error('浏览器未提供 IndexedDB。'));
        const request = indexedDB.open(KEY, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('state');
          request.result.createObjectStore('history', { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('无法打开工作台本地存储。'));
      });
    return dbPromise;
  }
  async function read(store, key) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const r = d.transaction(store).objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function write(store, key, value) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      value === undefined ? s.delete(key) : store === 'history' ? s.put(value) : s.put(value, key);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  }
  async function allHistory() {
    const d = await db();
    return new Promise((resolve, reject) => {
      const r = d.transaction('history').objectStore('history').getAll();
      r.onsuccess = () => resolve(r.result.sort((a, b) => b.createdAt - a.createdAt));
      r.onerror = () => reject(r.error);
    });
  }
  const safeImage = (value) => {
    if (typeof value !== 'string' || value.length > 45000000) return '';
    if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value)) return value;
    try {
      const u = new URL(value, location.href);
      if (u.username || u.password) return '';
      if (
        ['http:', 'https:'].includes(u.protocol) ||
        (u.protocol === 'file:' &&
          (value.startsWith('assets/') ||
            (location.protocol === 'file:' && u.href.startsWith(new URL('assets/', location.href).href))))
      )
        return u.href;
    } catch {}
    return '';
  };
  function cleanReference(raw, kind) {
    if (!raw || typeof raw !== 'object') return null;
    const known = canonical.get(raw.id);
    // Known pose IDs recover current-entry asset paths after a directory or host move.
    const item = known?.kind === kind ? { ...known, ...raw } : raw;
    if (kind === 'pose' && known?.kind === kind && !raw.custom) {
      item.full = known.full;
      item.normalFull = known.full;
      item.thumb = known.thumb;
      item.depthFull = known.depthFull;
    }
    const full = safeImage(item.full || item.dataUrl || item.url);
    if (!full) return null;
    const result = {
      id: String(item.id || `custom-${Date.now()}`).slice(0, 200),
      kind,
      name: String(item.name || '自定义参考').slice(0, 200),
      full: kind === 'pose' ? safeImage(item.normalFull) || full : full,
      thumb: safeImage(item.thumb) || full,
      prompt: String(item.prompt || '').slice(0, 20000),
      description: String(item.description || '').slice(0, 10000),
      sourceLabel: String(item.sourceLabel || '').slice(0, 100),
      sourceUrl: '',
      custom: !!item.custom,
    };
    try {
      const u = new URL(item.sourceUrl);
      if (['http:', 'https:'].includes(u.protocol)) result.sourceUrl = u.href;
    } catch {}
    if (kind === 'pose') {
      result.angle = String(item.angle || '');
      result.depthFull = safeImage(item.depthFull);
    }
    return result;
  }
  function cleanRecipe(raw = {}) {
    const result = {
      portrait: null,
      costume: null,
      pose: null,
      extras: [],
      style: STYLES.some((s) => s[0] === raw.style) ? raw.style : 'none',
      prompt: typeof raw.prompt === 'string' ? raw.prompt.slice(0, 30000) : '',
      useDepth: raw.useDepth === true,
    };
    Object.keys(SLOT_LABEL).forEach((slot) => (result[slot] = cleanReference(raw[slot], slot)));
    result.extras = Array.isArray(raw.extras)
      ? raw.extras
          .slice(0, 16)
          .map((item) => cleanReference(item, 'extra'))
          .filter(Boolean)
      : [];
    return result;
  }
  function setStatus(message, error = false) {
    status = String(message || '');
    statusError = error;
    const el = q('#studioStatus');
    if (el) {
      el.textContent = status;
      el.hidden = !status;
      el.classList.toggle('studio-error', error);
    }
  }
  function changed() {
    recipeRevision++;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(
      () =>
        write('state', 'recipe', recipe).catch(() =>
          setStatus('配方保存失败，可使用导出配方备份当前内容。', true),
        ),
      200,
    );
  }
  function promptFor() {
    const p = ['请结合提供的参考图，生成一个完整、协调的角色画面。'];
    if (recipe.portrait)
      p.push(`人像参考：${recipe.portrait.description || recipe.portrait.name}。保持脸型、发型与人物特征。`);
    if (recipe.costume)
      p.push(
        `服装参考：${recipe.costume.description || recipe.costume.name}。${recipe.costume.prompt ? '服装关键词：' + recipe.costume.prompt : ''}`,
      );
    if (recipe.pose)
      p.push(
        `姿势参考：${recipe.pose.name}${recipe.pose.angle ? '，' + recipe.pose.angle : ''}。${recipe.pose.prompt || ''}${recipe.useDepth ? ' 按深度参考保持空间结构。' : ''}`,
      );
    const style = STYLES.find((s) => s[0] === recipe.style)?.[2];
    if (style) p.push(style);
    if (recipe.extras.length) p.push(`另有 ${recipe.extras.length} 张附加参考图，请综合其视觉细节。`);
    return p.join('\n\n');
  }
  function rebuildPrompt() {
    recipe.prompt = promptFor();
    changed();
  }
  const nav = (next) =>
    document.dispatchEvent(new CustomEvent('pose-workspace-request', { detail: { page: next } }));
  function slotMarkup(slot) {
    const item = recipe[slot],
      image = slot === 'pose' && recipe.useDepth && item?.depthFull ? item.depthFull : item?.full;
    return `<section class="studio-slot" data-slot="${slot}">${item ? `<img class="studio-slot-image" src="${esc(image)}" alt="${esc(item.name)}">` : '<div class="studio-slot-empty">选择' + SLOT_LABEL[slot] + '参考</div>'}<h3 class="studio-slot-title">${SLOT_LABEL[slot]}</h3>
<p class="studio-caption">${esc(item?.name || '从图库选择，或上传自己的图片')}</p>
<div class="studio-slot-actions">
<button class="btn" data-random-slot="${slot}">随机</button>
<label class="btn">上传<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-upload-slot="${slot}" hidden>
</label>
<button class="text-btn" data-browse-slot="${slot}">去图库</button>${item ? `<button class="text-btn" data-remove-slot="${slot}">移除</button>` : ''}</div>${
      slot === 'pose' && item?.depthFull
        ? `<label class="studio-caption">
<input id="studioUseDepth" type="checkbox" ${recipe.useDepth ? 'checked' : ''}> 使用深度图</label>`
        : ''
    }</section>`;
  }
  function renderStudio() {
    root.innerHTML = `<header class="studio-header">
<div>
<p class="eyebrow">CHARACTER STUDIO</p>
<h1>角色合成台</h1>
<p class="studio-note">人像、服装与姿势组合成配方，可导出拼图或发送至配置的生图接口。</p>
</div>
<button class="btn" data-studio-settings>接口设置</button>
</header>
<div class="studio-layout">
<div class="studio-main">
<section class="studio-panel">
<div class="studio-actions">
<button id="studioRandomAll" class="btn">随机整套配方</button>
<label class="studio-caption">
<input id="studioAllowSensitive" type="checkbox" ${allowSensitive ? 'checked' : ''}> 随机包含成人向参考</label>
<button id="studioExportRecipe" class="btn">导出配方</button>
<label class="btn">导入配方<input id="studioImportRecipe" type="file" accept=".json,application/json" hidden>
</label>
</div>
<div id="studioSlots" class="studio-slots">${Object.keys(SLOT_LABEL).map(slotMarkup).join('')}</div>
</section>
<section class="studio-panel studio-drop" id="studioDropZone">
<h2>附加参考图</h2>
<p class="studio-note">拖入或粘贴图片，每张最多 20 MB，最多 16 张。</p>
<div class="studio-actions">
<label class="btn">添加图片<input id="studioExtrasInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
</label>
<input id="studioUrlInput" type="url" placeholder="https://图片地址" aria-label="附加参考图片地址">
<button id="studioAddUrl" class="btn">添加网址</button>
</div>
<div id="studioExtras" class="studio-attachments">${recipe.extras
      .map(
        (item, i) => `<article class="studio-attachment">
<img src="${esc(item.full)}" alt="${esc(item.name)}">
<p class="studio-caption">${esc(item.name)}</p>
<button class="text-btn" data-remove-extra="${i}">移除</button>
</article>`,
      )
      .join('')}</div>
</section>
<section class="studio-panel">
<div class="studio-form">
<label class="studio-field">画风<select id="studioStyle">${STYLES.map((s) => `<option value="${s[0]}" ${recipe.style === s[0] ? 'selected' : ''}>${s[1]}</option>`).join('')}</select>
</label>
<div class="studio-actions">
<button id="studioRebuildPrompt" class="btn">重新组装提示词</button>
<button id="studioCopyPrompt" class="btn">复制提示词</button>
</div>
<label class="studio-field studio-wide">生图提示词<textarea id="studioPrompt" class="studio-prompt" rows="10" maxlength="30000">${esc(recipe.prompt || promptFor())}</textarea>
</label>
</div>
</section>
<section class="studio-panel">
<h2>生成结果</h2>
<div id="studioResults" class="studio-results">${
      results.length
        ? results
            .map(
              (item, i) => `<article class="studio-result">
<img src="${esc(item.dataUrl || item.url)}" alt="生成结果 ${i + 1}">
<button class="btn" data-download-result="${i}">下载生成图</button>
</article>`,
            )
            .join('')
        : '<p class="studio-note">配置接口后，点击“开始生成”。</p>'
    }</div>
</section>
<section class="studio-panel">
<h2>生成历史</h2>
<p class="studio-note">最近 30 次记录保存在浏览器 IndexedDB。清理浏览器数据前，请下载需要保留的图片与配方。</p>
<div id="studioHistory" class="studio-history">${
      history.length
        ? history
            .map(
              (
                item,
              ) => `<article class="studio-history-card">${item.images?.[0] ? `<img src="${esc(item.images[0].dataUrl || item.images[0].url)}" alt="历史生成结果">` : ''}<p class="studio-caption">${new Date(item.createdAt).toLocaleString('zh-CN')} · ${esc(PROVIDERS[item.provider]?.[0] || item.provider)}</p>
<button class="btn" data-history-open="${esc(item.id)}">查看与下载</button> <button class="btn" data-history-reuse="${esc(item.id)}">复用配方</button> <button class="text-btn" data-history-delete="${esc(item.id)}">删除</button>
</article>`,
            )
            .join('')
        : '<p class="studio-note">生成后，图片和本次配方会保存在此浏览器。</p>'
    }</div>
</section>
</div>
<aside class="studio-side">
<section class="studio-panel">
<h2>输出</h2>
<p class="studio-note">当前接口 ${esc(PROVIDERS[provider][0])}</p>
<button id="studioCompose" class="btn">预览并导出参考拼图</button>
<p class="studio-note">拼图为 1800 × 1200 PNG，网络图片需允许跨域读取。</p>
<div class="studio-actions">
<button id="studioGenerate" class="btn primary" ${busy ? 'disabled' : ''}>开始生成</button>
<button id="studioStop" class="btn" ${busy ? '' : 'hidden'}>停止等待</button>
</div>${pending ? '<button id="studioResume" class="btn">继续追踪 ComfyUI 任务</button>' : ''}</section>
</aside>
</div>
<p id="studioStatus" class="studio-status ${statusError ? 'studio-error' : ''}" role="status" ${status ? '' : 'hidden'}>${esc(status)}</p>`;
  }
  function renderSettings() {
    const c = profile();
    root.innerHTML = `<header class="studio-header">
<div>
<p class="eyebrow">IMAGE GENERATION</p>
<h1>接口设置</h1>
<p class="studio-note">使用支持跨域访问的官方接口或自有兼容地址。</p>
</div>
<button class="btn" data-studio-back>返回合成台</button>
</header>
<section class="studio-panel studio-settings">
<div class="studio-form">
<label class="studio-field studio-wide">接口协议<select id="studioProvider">${Object.entries(PROVIDERS)
      .map(([id, v]) => `<option value="${id}" ${provider === id ? 'selected' : ''}>${v[0]}</option>`)
      .join('')}</select>
</label>
<label class="studio-field studio-wide">接口地址<input id="studioBaseUrl" type="url" value="${esc(c.baseUrl)}">
</label>
<label class="studio-field">API Key<input id="studioApiKey" type="password" value="${esc(apiKey)}" autocomplete="off">
</label>
<label class="studio-field">模型名称<input id="studioModel" value="${esc(c.model)}">
</label>
<p class="studio-note studio-wide">密钥仅保存在当前页面内存中，刷新后重新填写。云端模型在点击生成时验证。GitHub Pages 通过浏览器直连，接口需支持 CORS。</p>
<label class="studio-field">尺寸<input data-config="size" value="${esc(c.size)}">
</label>
<label class="studio-field">质量<select data-config="quality">${['auto', 'low', 'medium', 'high'].map((v) => `<option ${c.quality === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
</label>
<label class="studio-field">背景<select data-config="background">${['auto', 'opaque', 'transparent'].map((v) => `<option ${c.background === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
</label>
<label class="studio-field">宽高比<select data-config="aspectRatio">${['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'].map((v) => `<option ${c.aspectRatio === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
</label>
<label class="studio-field">分辨率<select data-config="resolution">${['1K', '2K', '4K'].map((v) => `<option ${c.resolution === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
</label>
<label class="studio-field">种子<input type="number" data-config="seed" value="${c.seed}">
</label>
</div>
<div class="studio-actions">
<button id="studioTestConnection" class="btn" ${provider === 'comfyui' ? '' : 'hidden'}>检测连接</button>
<button id="studioClearKey" class="text-btn">清空密钥</button>
</div>
<section class="studio-workflow" ${provider === 'comfyui' ? '' : 'hidden'}>
<h2>ComfyUI API 工作流</h2>
<label><input id="studioOverrideWorkflow" type="checkbox" ${c.overrideWorkflow ? 'checked' : ''}> 用界面尺寸与种子覆盖工作流</label>
<p class="studio-note">默认使用导入工作流中的尺寸和种子。占位符模板使用界面默认值。</p>
<p class="studio-note">附加参考图使用 {{extra_image_1}} 等占位符。通用模板的模型名需要按本机修改。本地服务需允许页面来源的 CORS，可使用本项目本地启动入口。</p>
<p class="studio-note">支持 {{prompt}}、{{seed}}、{{width}}、{{height}}、{{portrait_image}}、{{costume_image}}、{{pose_image}}、{{composite_image}} 占位符。</p>
<div class="studio-actions">
<label class="btn">导入 API 工作流<input id="studioWorkflowInput" type="file" accept=".json,application/json" hidden>
</label>
<button id="studioExportWorkflow" class="btn">导出当前工作流</button>
<button id="studioWorkflowTemplate" class="btn">下载通用模板</button>
</div>
</section>
</section>
<p id="studioStatus" class="studio-status ${statusError ? 'studio-error' : ''}" role="status" ${status ? '' : 'hidden'}>${esc(status)}</p>`;
  }
  function render() {
    root.hidden = !['studio', 'settings'].includes(page);
    if (!root.hidden) (page === 'settings' ? renderSettings : renderStudio)();
  }
  const blobUrl = (blob, name) => {
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const downloadJson = (value, name) =>
    blobUrl(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), name);
  function exportRecipe() {
    const copy = structuredClone(recipe);
    for (const item of [...Object.keys(SLOT_LABEL).map((slot) => copy[slot]), ...copy.extras].filter(
      Boolean,
    )) {
      if (item.thumb === item.full) delete item.thumb;
    }
    const content = JSON.stringify({ format: 'pose-studio-recipe', version: 1, recipe: copy }, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    if (blob.size > 100 * 1024 * 1024) {
      throw new Error('当前配方超过 100 MB 导入上限。请缩小上传图片或移除部分附件后再导出。');
    }
    blobUrl(blob, 'pose-studio-recipe.json');
  }
  const fileData = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('图片读取失败。'));
      r.readAsDataURL(file);
    });
  const loadImage = (src) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('图片解码失败，请检查网络、CORS 或格式。'));
      image.src = src;
    });
  async function fileReference(file, kind = 'extra') {
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type))
      throw new Error('请选择 PNG、JPEG、WebP 或 GIF 图片。');
    if (file.size > 20 * 1024 * 1024) throw new Error('图片超过 20 MB。');
    const value = await fileData(file);
    await loadImage(value);
    return {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      name: file.name || '自定义图片',
      full: value,
      thumb: value,
      custom: true,
    };
  }
  async function addFiles(files, slot = 'extra') {
    const list = [...files];
    if (slot === 'extra' && recipe.extras.length + list.length > 16) throw new Error('附加参考最多 16 张。');
    const loaded = [];
    for (const file of slot === 'extra' ? list : list.slice(0, 1))
      loaded.push(await fileReference(file, slot));
    if (slot === 'extra' && recipe.extras.length + loaded.length > 16)
      throw new Error('附加参考最多 16 张，请移除部分图片后重试。');
    if (slot === 'extra') recipe.extras.push(...loaded);
    else recipe[slot] = loaded[0];
    rebuildPrompt();
    render();
    setStatus(`已添加 ${loaded.length} 张参考图。`);
  }
  const getData = async (src, signal) => {
    if (signal?.aborted) throw new DOMException('已停止等待', 'AbortError');
    if (src.startsWith('data:image/')) return src;
    let response;
    try {
      const timeout = AbortSignal.timeout(45000);
      response = await fetch(src, {
        credentials: 'omit',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw new DOMException('已停止等待', 'AbortError');
      throw new Error(
        location.protocol === 'file:' && src.startsWith('file:')
          ? '本地图片拼图需通过打开图库.cmd启动本地服务，或把图片上传到工作台。'
          : '参考图读取失败，请检查网络与来源站跨域权限，或下载后上传。',
      );
    }
    if (!response.ok) throw new Error(`参考图读取失败，HTTP ${response.status}。`);
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error('参考地址返回的内容无法识别为图片。');
    if (blob.size > 20 * 1024 * 1024) throw new Error('参考图超过 20 MB。');
    return fileData(blob);
  };
  async function compose(snapshot = recipe, signal) {
    const slots = Object.keys(SLOT_LABEL).filter((slot) => snapshot[slot]);
    if (!slots.length) throw new Error('请先选择至少一张核心参考图。');
    const canvas = document.createElement('canvas');
    canvas.width = 1800;
    canvas.height = 1200;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 1800, 1200);
    const w = 1800 / slots.length;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i],
        item = snapshot[slot],
        src = slot === 'pose' && snapshot.useDepth && item.depthFull ? item.depthFull : item.full,
        img = await loadImage(await getData(src, signal)),
        scale = Math.min((w - 48) / img.naturalWidth, 1080 / img.naturalHeight),
        dw = img.naturalWidth * scale,
        dh = img.naturalHeight * scale;
      ctx.drawImage(img, i * w + (w - dw) / 2, 24 + (1080 - dh) / 2, dw, dh);
      ctx.fillStyle = '#24332b';
      ctx.font = '28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(SLOT_LABEL[slot], i * w + w / 2, 1150);
    }
    return canvas.toDataURL('image/png');
  }
  const imageInputs = async (snapshot, signal) => {
    const values = [];
    for (const slot of Object.keys(SLOT_LABEL))
      if (snapshot[slot])
        values.push({
          slot,
          name: snapshot[slot].name,
          dataUrl: await getData(
            slot === 'pose' && snapshot.useDepth && snapshot[slot].depthFull
              ? snapshot[slot].depthFull
              : snapshot[slot].full,
            signal,
          ),
        });
    for (const item of snapshot.extras)
      values.push({ slot: 'extra', name: item.name, dataUrl: await getData(item.full, signal) });
    return values;
  };
  async function downloadImage(item, name = 'generated-image.png') {
    const data = await getData(item.dataUrl || item.url),
      response = await fetch(data),
      blob = await response.blob();
    blobUrl(blob, name);
  }
  async function showComposite() {
    setStatus('正在读取参考图并生成拼图…');
    const output = await compose(structuredClone(recipe));
    if (page !== 'studio') {
      setStatus('参考拼图已准备完成，请回到合成台重新打开预览。');
      return;
    }
    document.getElementById('studioCompositeDialog')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'studioCompositeDialog';
    dialog.className = 'studio-dialog';
    dialog.setAttribute('aria-label', '三图参考拼图');
    dialog.innerHTML =
      '<div class="studio-actions"><h2>参考拼图</h2><button id="studioDownloadComposite" class="btn">下载 PNG</button><button id="studioCloseComposite" class="btn">关闭</button></div><img id="studioCompositeImage" alt="人像、服装与姿势参考拼图">';
    dialog.querySelector('img').src = output;
    dialog.querySelector('#studioCloseComposite').onclick = () => dialog.close();
    dialog.querySelector('#studioDownloadComposite').onclick = () =>
      downloadImage({ dataUrl: output }, 'pose-reference-composite.png').catch((error) =>
        setStatus(error.message, true),
      );
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
    setStatus('参考拼图已生成。');
  }

  async function generate(resume = false) {
    if (busy) return;
    if (!window.PoseGenerator) throw new Error('生图接口模块尚未加载，请重新打开页面。');
    const savedPending = resume ? structuredClone(pending) : null;
    const snapshot = structuredClone(savedPending?.recipe || recipe);
    const cfg = structuredClone(profile());
    if (resume) cfg.baseUrl = savedPending.baseUrl;
    const used = resume ? 'comfyui' : provider;
    const requestKey = apiKey;
    const requestWorkflow = structuredClone(workflow);
    const options = { ...cfg };
    if (used === 'comfyui' && !cfg.overrideWorkflow) {
      delete options.seed;
      delete options.width;
      delete options.height;
    }
    const prompt = savedPending?.prompt || snapshot.prompt || promptFor();
    controller = new AbortController();
    const signal = controller.signal;
    busy = true;
    render();
    setStatus(resume ? '正在恢复任务追踪…' : '正在准备参考图…');
    let promptId = savedPending?.promptId;
    let persistedPromptId = savedPending?.promptId;
    let pendingStorageWarning = '';
    try {
      const progress = (event) => {
        const message = event.message || event.status || '正在生成…';
        setStatus([message, pendingStorageWarning].filter(Boolean).join(' '), !!pendingStorageWarning);
        if (event.promptId && event.promptId !== persistedPromptId) {
          promptId = event.promptId;
          persistedPromptId = event.promptId;
          pending = { baseUrl: cfg.baseUrl, promptId, recipe: snapshot, prompt };
          return write('state', 'pending', pending).catch(() => {
            pendingStorageWarning = '本地恢复记录保存失败，请保留本页面或到 ComfyUI 查看任务。';
            setStatus('任务已提交。' + pendingStorageWarning, true);
          });
        }
      };
      let output;
      if (resume) {
        output = await PoseGenerator.resume({ baseUrl: cfg.baseUrl, promptId, signal, onProgress: progress });
      } else {
        const images = await imageInputs(snapshot, signal);
        if (used === 'comfyui' && Object.keys(SLOT_LABEL).some((slot) => snapshot[slot]))
          images.push({ slot: 'composite', name: '三图参考拼图', dataUrl: await compose(snapshot, signal) });
        if (signal.aborted) throw new DOMException('已停止等待', 'AbortError');
        output = await PoseGenerator.generate({
          provider: used,
          baseUrl: cfg.baseUrl,
          apiKey: requestKey,
          model: cfg.model,
          prompt,
          images,
          options,
          workflow: requestWorkflow,
          signal,
          onProgress: progress,
        });
      }
      results = [];
      let external = 0;
      for (const item of output.images || []) {
        if (item.dataUrl && safeImage(item.dataUrl))
          results.push({ dataUrl: item.dataUrl, name: item.name || '' });
        else if (safeImage(item.url)) {
          try {
            results.push({ dataUrl: await getData(item.url), name: item.name || '' });
          } catch {
            results.push({ url: item.url, name: item.name || '' });
            external++;
          }
        }
      }
      if (!results.length) throw new Error('接口响应没有可用图片。');
      const record = {
        id: `generation-${Date.now()}`,
        createdAt: Date.now(),
        provider: used,
        prompt,
        recipe: snapshot,
        images: results,
      };
      try {
        await write('history', record.id, record);
        history.unshift(record);
        while (history.length > 30) {
          const oldest = history.pop();
          await write('history', oldest.id, undefined);
        }
        setStatus(
          external
            ? '生成完成。部分图片仅保存了网址，网址可能过期，请及时下载。'
            : '生成完成，图片与配方已保存到本机历史。',
        );
      } catch {
        setStatus('生成完成，但历史保存失败。请立即下载生成图。', true);
      }
      if (used === 'comfyui' && pending?.promptId === promptId) {
        pending = null;
        await write('state', 'pending', null).catch(() => {});
      }
    } catch (error) {
      setStatus(
        error.name === 'AbortError'
          ? '已停止等待。服务端任务可能继续，ComfyUI 任务可稍后继续追踪。'
          : String(error.message || '生成失败，请检查接口配置。'),
        error.name !== 'AbortError',
      );
    } finally {
      busy = false;
      controller = null;
      render();
    }
  }
  async function clicks(event) {
    const b = event.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-studio-settings')) {
      nav('settings');
      return;
    }
    if (b.hasAttribute('data-studio-back')) {
      nav('studio');
      return;
    }
    if (b.dataset.randomSlot) {
      const list = catalogs[b.dataset.randomSlot].filter((item) => allowSensitive || !item.nsfw);
      recipe[b.dataset.randomSlot] = cleanReference(
        list[Math.floor(Math.random() * list.length)],
        b.dataset.randomSlot,
      );
      rebuildPrompt();
      render();
      return;
    }
    if (b.dataset.removeSlot) {
      recipe[b.dataset.removeSlot] = null;
      rebuildPrompt();
      render();
      return;
    }
    if (b.dataset.browseSlot) {
      nav({ portrait: 'portraits', costume: 'costumes', pose: 'poses' }[b.dataset.browseSlot]);
      return;
    }
    if (b.dataset.removeExtra !== undefined) {
      recipe.extras.splice(Number(b.dataset.removeExtra), 1);
      rebuildPrompt();
      render();
      return;
    }
    if (b.dataset.downloadResult !== undefined) {
      await downloadImage(results[Number(b.dataset.downloadResult)]);
      return;
    }
    if (b.dataset.historyOpen) {
      const record = history.find((item) => item.id === b.dataset.historyOpen);
      if (record) {
        results = record.images;
        render();
        q('#studioResults')?.scrollIntoView({ block: 'center' });
      }
      return;
    }
    if (b.dataset.historyReuse) {
      const item = history.find((x) => x.id === b.dataset.historyReuse);
      if (item) {
        recipe = cleanRecipe(item.recipe);
        recipe.prompt = item.prompt;
        changed();
        render();
        setStatus('已复用这次生成的配方和提示词。');
      }
      return;
    }
    if (b.dataset.historyDelete) {
      await write('history', b.dataset.historyDelete, undefined);
      history = history.filter((x) => x.id !== b.dataset.historyDelete);
      render();
      return;
    }
    switch (b.id) {
      case 'studioRandomAll':
        Object.keys(SLOT_LABEL).forEach((slot) => {
          const list = catalogs[slot].filter((item) => allowSensitive || !item.nsfw);
          recipe[slot] = cleanReference(list[Math.floor(Math.random() * list.length)], slot);
        });
        rebuildPrompt();
        render();
        break;
      case 'studioRebuildPrompt':
        rebuildPrompt();
        render();
        setStatus('已重新组装提示词。');
        break;
      case 'studioCopyPrompt':
        await navigator.clipboard.writeText(recipe.prompt || promptFor());
        setStatus('提示词已复制。');
        break;
      case 'studioExportRecipe':
        exportRecipe();
        break;
      case 'studioCompose':
        await showComposite();
        break;
      case 'studioAddUrl': {
        const value = q('#studioUrlInput').value.trim();
        if (!/^https?:\/\//i.test(value) || !safeImage(value))
          throw new Error('请输入完整的 HTTP 或 HTTPS 图片网址。');
        if (recipe.extras.length >= 16) throw new Error('附加参考最多16张。');
        recipe.extras.push({
          id: `url-${Date.now()}`,
          kind: 'extra',
          name: '网址参考',
          full: safeImage(value),
          thumb: safeImage(value),
          custom: true,
        });
        rebuildPrompt();
        render();
        setStatus('已添加网址参考。拼图和生图需要此地址允许跨域读取。');
        break;
      }
      case 'studioGenerate':
        await generate();
        break;
      case 'studioResume':
        if (pending) await generate(true);
        break;
      case 'studioStop':
        controller?.abort();
        break;
      case 'studioSettings':
        nav('settings');
        break;
      case 'studioClearKey':
        apiKey = '';
        q('#studioApiKey').value = '';
        break;
      case 'studioTestConnection':
        b.disabled = true;
        try {
          const response = await PoseGenerator.testConnection({ provider, ...profile(), apiKey });
          setStatus(response?.message || '接口连接成功。');
        } finally {
          b.disabled = false;
        }
        break;
      case 'studioExportWorkflow':
        if (!workflow) throw new Error('请先导入 API 工作流。');
        downloadJson(workflow, 'pose-studio-workflow.api.json');
        break;
      case 'studioWorkflowTemplate':
        downloadJson(PoseGenerator.workflowTemplate(), 'pose-studio-template.api.json');
        break;
      case 'studioBack':
        nav('studio');
        break;
    }
  }
  root.addEventListener('click', (event) =>
    clicks(event).catch((error) => setStatus(error.message || String(error), true)),
  );
  root.addEventListener('input', (event) => {
    const f = event.target;
    if (f.id === 'studioPrompt') {
      recipe.prompt = f.value;
      changed();
    }
    if (f.id === 'studioApiKey') apiKey = f.value;
    if (f.id === 'studioBaseUrl') {
      profile().baseUrl = f.value;
      saveSettings();
    }
    if (f.id === 'studioModel') {
      profile().model = f.value;
      saveSettings();
    }
    if (f.dataset.config) {
      profile()[f.dataset.config] = f.type === 'number' ? Number(f.value) : f.value;
      if (f.dataset.config === 'size') {
        const size = f.value.match(/^(\d+)x(\d+)$/);
        if (size) {
          profiles[provider].width = Number(size[1]);
          profiles[provider].height = Number(size[2]);
        }
      }
      saveSettings();
    }
  });
  root.addEventListener('change', (event) => {
    (async () => {
      const f = event.target;
      if (f.dataset.uploadSlot) await addFiles(f.files, f.dataset.uploadSlot);
      if (f.id === 'studioExtrasInput') await addFiles(f.files);
      if (f.id === 'studioStyle') {
        recipe.style = f.value;
        rebuildPrompt();
        render();
      }
      if (f.id === 'studioAllowSensitive') allowSensitive = f.checked;
      if (f.id === 'studioUseDepth') {
        recipe.useDepth = f.checked;
        rebuildPrompt();
        render();
      }
      if (f.id === 'studioOverrideWorkflow') {
        profile().overrideWorkflow = f.checked;
        saveSettings();
      }
      if (f.id === 'studioProvider') {
        provider = f.value;
        apiKey = '';
        saveSettings();
        render();
      }
      if (f.id === 'studioImportRecipe' && f.files.length) {
        if (f.files[0].size > 100 * 1024 * 1024) throw new Error('配方文件超过100 MB。');
        const value = JSON.parse(await f.files[0].text());
        if (value.format !== 'pose-studio-recipe' || value.version !== 1) throw new Error('配方格式无效。');
        recipe = cleanRecipe(value.recipe);
        changed();
        render();
        setStatus('配方已导入。');
      }
      if (f.id === 'studioWorkflowInput' && f.files.length) {
        if (f.files[0].size > 5 * 1024 * 1024) throw new Error('工作流文件超过5 MB。');
        const parsed = JSON.parse(await f.files[0].text());
        PoseGenerator.validateWorkflow(parsed);
        workflow = parsed;
        await write('state', 'workflow', workflow);
        render();
        setStatus('工作流已载入。');
      }
    })().catch((error) => setStatus(error.message || String(error), true));
  });
  root.addEventListener('dragover', (event) => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
      q('#studioDropZone')?.classList.add('dragover');
    }
  });
  root.addEventListener('dragleave', () => q('#studioDropZone')?.classList.remove('dragover'));
  root.addEventListener('drop', (event) => {
    if (event.dataTransfer.files.length) {
      event.preventDefault();
      q('#studioDropZone')?.classList.remove('dragover');
      addFiles(event.dataTransfer.files).catch((error) => setStatus(error.message, true));
    }
  });
  document.addEventListener('paste', (event) => {
    if (page === 'studio' && event.clipboardData?.files.length) {
      event.preventDefault();
      addFiles(event.clipboardData.files).catch((error) => setStatus(error.message, true));
    }
  });
  document.addEventListener('pose-workspace-change', (event) => {
    page = event.detail?.page || 'poses';
    render();
  });
  document.addEventListener('pose-recipe-add', (event) => {
    const item = event.detail;
    if (!SLOT_LABEL[item?.kind]) return;
    const value = cleanReference(item, item.kind);
    if (!value) return;
    recipe[item.kind] = value;
    if (item.kind === 'pose') recipe.useDepth = item.useDepth === true;
    rebuildPrompt();
    setStatus(`已将“${value.name}”加入${SLOT_LABEL[item.kind]}槽位。`);
    nav('studio');
    render();
  });
  window.PoseStudio = Object.freeze({ getRecipe: () => structuredClone(recipe) });
  (async () => {
    const initial = recipeRevision;
    try {
      const [savedRecipe, savedWorkflow, savedPending, savedHistory] = await Promise.all([
        read('state', 'recipe'),
        read('state', 'workflow'),
        read('state', 'pending'),
        allHistory(),
      ]);
      if (recipeRevision === initial && savedRecipe) recipe = cleanRecipe(savedRecipe);
      workflow = savedWorkflow || null;
      pending = savedPending || null;
      history = savedHistory.slice(0, 30);
      for (const obsolete of savedHistory.slice(30)) await write('history', obsolete.id, undefined);
    } catch {
      setStatus('浏览器本地存储暂不可用，请导出配方保存当前内容。', true);
    }
    render();
  })();
})();
