/* Additional reference catalogues. Images load only when a catalogue is opened. */
(() => {
  'use strict';

  const root = document.getElementById('referenceWorkspace');
  const dataElement = document.getElementById('referenceData');
  if (!root || !dataElement) return;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
  const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase();
  const safeUrl = value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch {
      return '';
    }
  };

  let catalogue;
  try {
    catalogue = JSON.parse(dataElement.textContent);
  } catch {
    catalogue = { costumes: [], portraits: [], sources: [] };
  }
  const datasets = {
    costumes: Array.isArray(catalogue.costumes) ? catalogue.costumes : [],
    portraits: Array.isArray(catalogue.portraits) ? catalogue.portraits : []
  };
  const sources = new Map((catalogue.sources || []).map(source => [source.id, source]));
  const searchText = new Map();
  const byId = new Map();
  for (const record of [...datasets.costumes, ...datasets.portraits]) {
    byId.set(record.id, record);
    searchText.set(record.id, normalize([
      record.id, record.name, record.category, record.sourceLabel, record.description,
      record.prompt, record.hairLength, record.hairstyle, record.section, ...(record.tags || [])
    ].join(' ')));
  }

  const freshState = () => ({ query: '', source: '', category: '', tag: '', hairLength: '', hairstyle: '', safe: true, shown: 48 });
  const states = { costumes: freshState(), portraits: freshState() };
  let page = '';
  let matches = [];
  let activeRecord = null;
  let activeView = 0;
  let searchTimer;
  let previewTrigger = null;
  let downloadController = null;
  root.hidden = true;
  root.classList.add('reference-workspace');

  function status(message) {
    const target = root.querySelector('#referenceStatus');
    if (target) target.textContent = message;
  }

  function options(values, selected, allLabel) {
    const unique = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return `<option value="">${escapeHtml(allLabel)}</option>` + unique.map(value =>
      `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(value)}</option>`
    ).join('');
  }

  function refreshFilters() {
    const state = states[page];
    const visible = datasets[page].filter(record => !state.safe || !record.nsfw);
    const availableSources = [...new Map(visible.map(record => [record.source, record.sourceLabel])).entries()];
    if (state.source && !availableSources.some(([id]) => id === state.source)) state.source = '';
    root.querySelector('#referenceSource').innerHTML = '<option value="">全部来源</option>' + availableSources.map(([id, label]) =>
      `<option value="${escapeHtml(id)}"${state.source === id ? ' selected' : ''}>${escapeHtml(label)}</option>`
    ).join('');
    const candidates = visible.filter(record => !state.source || record.source === state.source);
    for (const [field, id, allLabel] of [
      ['category', 'referenceCategory', '全部分类'],
      ['tag', 'referenceTag', '全部标签'],
      ['hairLength', 'referenceHairLength', '全部发长'],
      ['hairstyle', 'referenceHairstyle', '全部发型']
    ]) {
      const select = root.querySelector('#' + id);
      if (!select) continue;
      const values = candidates.flatMap(record => field === 'tag' ? record.tags || [] : [record[field]]).filter(Boolean);
      if (state[field] && !values.includes(state[field])) state[field] = '';
      select.innerHTML = options(values, state[field], allLabel);
    }
  }

  function card(record) {
    const thumbnail = safeUrl(record.thumb);
    const source = safeUrl(record.sourceUrl);
    return `<article class="reference-card" data-reference-id="${escapeHtml(record.id)}">
      <button type="button" class="reference-image" data-reference-preview="${escapeHtml(record.id)}" aria-label="预览${escapeHtml(record.name)}">
        ${thumbnail ? `<img src="${escapeHtml(thumbnail)}" alt="${escapeHtml(record.name)}" loading="lazy" decoding="async">` : ''}
        <span class="reference-image-error"${thumbnail ? ' hidden' : ''}>图片暂时无法加载</span>
      </button>
      <div class="reference-card-body">
        <span class="reference-source">${escapeHtml(record.sourceLabel)}</span>
        <button type="button" class="reference-title" data-reference-preview="${escapeHtml(record.id)}">${escapeHtml(record.name)}</button>
        <p class="reference-card-detail">${escapeHtml(record.category)}${record.views?.length > 1 ? ` · ${record.views.length} 个视角` : ''}</p>
        <div class="reference-card-actions"><button type="button" class="btn" data-reference-add="${escapeHtml(record.id)}">加入配方</button>${source ? `<a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer" aria-label="查看${escapeHtml(record.name)}的素材来源">来源 ↗</a>` : ''}</div>
      </div>
    </article>`;
  }

  function draw(recompute = true) {
    const state = states[page];
    if (recompute) {
      const tokens = normalize(state.query).trim().split(/\s+/).filter(Boolean);
      matches = datasets[page].filter(record =>
        (!state.safe || !record.nsfw) &&
        (!state.source || record.source === state.source) &&
        (!state.category || record.category === state.category) &&
        (!state.tag || (record.tags || []).includes(state.tag)) &&
        (!state.hairLength || record.hairLength === state.hairLength) &&
        (!state.hairstyle || record.hairstyle === state.hairstyle) &&
        tokens.every(token => searchText.get(record.id).includes(token))
      );
    }
    const grid = root.querySelector('#referenceGrid');
    const previousCount = recompute ? 0 : grid.querySelectorAll('.reference-card').length;
    const shown = matches.slice(previousCount, state.shown);
    if (recompute) grid.innerHTML = '';
    if (matches.length) {
      grid.insertAdjacentHTML('beforeend', shown.map(card).join(''));
    } else {
      grid.innerHTML = '<div class="reference-empty"><h2>没有匹配的参考素材</h2><p>调整关键词或筛选条件后再试。</p><button type="button" class="btn" data-reference-reset>重置筛选</button></div>';
    }
    root.querySelector('#referenceCount').textContent = `${matches.length.toLocaleString()} 条结果`;
    root.querySelector('#referenceShown').textContent = `已显示 ${Math.min(state.shown, matches.length).toLocaleString()} 条`;
    root.querySelector('#referenceMore').hidden = state.shown >= matches.length;
    const filteredSources = [...new Set(matches.map(record => record.source))];
    root.querySelector('#referenceSourceNotes').innerHTML = filteredSources.map(id => {
      const source = sources.get(id);
      if (!source) return '';
      const url = safeUrl(source.url);
      return `<p><strong>${escapeHtml(source.name)}</strong> ${escapeHtml(source.note || source.license || '')}${url ? ` <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">查看来源说明 ↗</a>` : ''}</p>`;
    }).join('');
  }

  function openPage(nextPage, force = false) {
    if (!force && page === nextPage && !root.hidden) return;
    clearTimeout(searchTimer);
    root.querySelector('#referenceViewer')?.close();
    const supported = nextPage === 'costumes' || nextPage === 'portraits';
    root.hidden = !supported;
    if (!supported) {
      downloadController?.abort();
      return;
    }
    page = nextPage;
    const portrait = page === 'portraits';
    const state = states[page];
    root.innerHTML = `<header class="reference-header">
      <div><p class="eyebrow">${portrait ? 'PORTRAIT REFERENCE' : 'COSTUME REFERENCE'}</p><h1>${portrait ? '人像参考' : '服装参考'}</h1><p>${portrait ? '按发长、发型与分区挑选人物参考。' : '按来源、分类与细节标签挑选服装。'}</p></div>
      <div class="reference-total"><strong>${datasets[page].length.toLocaleString()}</strong><span>条参考素材</span></div>
    </header>
    <p class="reference-online-note">图片按需从来源站点加载，需要联网。<span>选好的素材可加入合成配方。</span></p>
    <section class="reference-controls" aria-label="${portrait ? '人像' : '服装'}搜索与筛选">
      <label class="reference-search"><span>搜索</span><input id="referenceSearch" type="search" value="${escapeHtml(state.query)}" maxlength="500" placeholder="${portrait ? '搜索发型、分区或编号' : '搜索服装、颜色、标签或编号'}" autocomplete="off"></label>
      <div class="reference-filters">
        <label>来源<select id="referenceSource" data-reference-filter="source"></select></label>
        <label>${portrait ? '分区' : '分类'}<select id="referenceCategory" data-reference-filter="category"></select></label>
        ${portrait ? '<label>发长<select id="referenceHairLength" data-reference-filter="hairLength"></select></label><label>发型<select id="referenceHairstyle" data-reference-filter="hairstyle"></select></label>' : '<label>细节标签<select id="referenceTag" data-reference-filter="tag"></select></label>'}
        <label class="reference-safe"><input id="referenceSafe" type="checkbox"${state.safe ? ' checked' : ''}>隐藏成人向</label>
        <button type="button" class="text-btn" data-reference-reset>重置筛选</button>
      </div>
    </section>
    <div class="reference-results"><b id="referenceCount" aria-live="polite"></b><span id="referenceShown"></span></div>
    <p id="referenceStatus" class="reference-status" role="status" aria-live="polite"></p>
    <section id="referenceGrid" class="reference-grid" aria-label="${portrait ? '人像' : '服装'}参考图片"></section>
    <div class="reference-load"><button type="button" id="referenceMore" class="btn">继续浏览</button></div>
    <details class="reference-sources"><summary>素材来源与使用说明</summary><div id="referenceSourceNotes"></div></details>
    <dialog id="referenceViewer" class="reference-viewer" aria-labelledby="referenceViewerTitle"></dialog>`;
    refreshFilters();
    draw();
  }

  function selectedRecord() {
    const view = activeRecord.views?.[activeView];
    return view ? { ...activeRecord, thumb: view.thumb, full: view.full, selectedView: view.label } : { ...activeRecord };
  }

  function addRecord(record) {
    const message = `已将“${record.name}”加入${record.kind === 'portrait' ? '人像' : '服装'}配方。`;
    status(message);
    const previewStatus = root.querySelector('#referencePreviewStatus');
    if (previewStatus) previewStatus.textContent = message;
    document.dispatchEvent(new CustomEvent('pose-recipe-add', { detail: { ...record } }));
  }

  function drawPreview() {
    const record = selectedRecord();
    const full = safeUrl(record.full);
    const source = safeUrl(record.sourceUrl);
    const sourceNote = sources.get(record.source);
    const dialog = root.querySelector('#referenceViewer');
    dialog.innerHTML = `<div class="reference-preview-layout">
      <div class="reference-preview-image">${full ? `<img src="${escapeHtml(full)}" alt="${escapeHtml(record.name + (record.selectedView ? ' ' + record.selectedView : ''))}">` : ''}<p class="reference-image-error"${full ? ' hidden' : ''}>图片暂时无法加载，可打开素材来源查看。</p></div>
      <section class="reference-preview-info">
        <div class="reference-preview-top"><span class="reference-source">${escapeHtml(record.id)}</span><button type="button" class="icon-btn" data-reference-close aria-label="关闭参考预览">×</button></div>
        <h2 id="referenceViewerTitle">${escapeHtml(record.name)}</h2><p>${escapeHtml(record.description || record.category)}</p>
        ${activeRecord.views?.length > 1 ? `<div class="reference-views" aria-label="素材视角">${activeRecord.views.map((view, index) => `<button type="button" class="btn${index === activeView ? ' primary' : ''}" data-reference-view="${index}" aria-pressed="${index === activeView}">${escapeHtml(view.label)}</button>`).join('')}</div>` : ''}
        <div class="reference-tags">${(record.tags || []).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
        <label class="reference-prompt-label">参考提示词<textarea id="referencePrompt" rows="5" readonly>${escapeHtml(record.prompt || record.description || record.name)}</textarea></label>
        <div class="reference-preview-actions"><button type="button" class="btn primary" data-reference-use>加入配方</button><button type="button" class="btn" data-reference-copy>复制提示词</button><button type="button" class="btn" data-reference-download${full ? '' : ' disabled'}>保存原图</button>${full ? `<a class="btn" href="${escapeHtml(full)}" target="_blank" rel="noopener noreferrer">打开原图 ↗</a>` : ''}</div>
        <p id="referencePreviewStatus" class="reference-status" role="status" aria-live="polite"></p>
        <div class="reference-attribution"><strong>${escapeHtml(record.sourceLabel)}</strong><p>${escapeHtml(sourceNote?.note || sourceNote?.license || '使用素材前请查看来源站点的授权说明。')}</p>${source ? `<a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">查看素材来源 ↗</a>` : ''}</div>
      </section>
    </div>`;
  }

  function preview(id, trigger) {
    activeRecord = byId.get(id);
    if (!activeRecord) return;
    activeView = 0;
    previewTrigger = trigger;
    drawPreview();
    const dialog = root.querySelector('#referenceViewer');
    dialog.showModal();
    dialog.addEventListener('close', () => {
      downloadController?.abort();
      if (!root.hidden && previewTrigger?.isConnected) previewTrigger.focus();
    }, { once: true });
  }

  async function copyPrompt() {
    const input = root.querySelector('#referencePrompt');
    const message = root.querySelector('#referencePreviewStatus');
    const text = input.value;
    try {
      await navigator.clipboard.writeText(text);
      if (message.isConnected) message.textContent = '已复制提示词。';
    } catch {
      if (!input.isConnected || root.hidden) return;
      input.focus();
      input.select();
      const copied = document.execCommand('copy');
      message.textContent = copied ? '已复制提示词。' : '请复制已选中的提示词。';
    }
  }

  async function downloadImage(button) {
    const record = selectedRecord();
    const url = safeUrl(record.full);
    if (!url) return;
    downloadController?.abort();
    const controller = new AbortController();
    downloadController = controller;
    const message = root.querySelector('#referencePreviewStatus');
    button.disabled = true;
    message.textContent = '正在读取原图…';
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
      if (!response.ok) throw new Error('Image response failed');
      const blob = await response.blob();
      if (!blob.size || !blob.type.startsWith('image/')) throw new Error('Image response was invalid');
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const extension = new URL(url).pathname.match(/\.(png|jpe?g|webp)$/i)?.[1] || 'png';
      anchor.href = objectUrl;
      anchor.download = `${record.id}${record.selectedView ? '_' + record.selectedView : ''}.${extension}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
      message.textContent = '原图已交给浏览器下载。';
    } catch {
      message.textContent = '原图读取失败，可能由网络或来源站跨域限制引起。请点击“打开原图”后保存。';
    } finally {
      clearTimeout(timer);
      button.disabled = false;
      if (downloadController === controller) downloadController = null;
    }
  }

  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !root.contains(button)) return;
    if (button.hasAttribute('data-reference-preview')) preview(button.dataset.referencePreview, button);
    if (button.hasAttribute('data-reference-add')) {
      const record = byId.get(button.dataset.referenceAdd);
      if (record) addRecord(record);
    }
    if (button.hasAttribute('data-reference-close')) root.querySelector('#referenceViewer').close();
    if (button.hasAttribute('data-reference-use')) addRecord(selectedRecord());
    if (button.hasAttribute('data-reference-copy')) void copyPrompt();
    if (button.hasAttribute('data-reference-download')) void downloadImage(button);
    if (button.hasAttribute('data-reference-view')) {
      downloadController?.abort();
      activeView = Number(button.dataset.referenceView);
      drawPreview();
      root.querySelector(`[data-reference-view="${activeView}"]`)?.focus();
    }
    if (button.hasAttribute('data-reference-reset')) {
      const safe = states[page].safe;
      states[page] = { ...freshState(), safe };
      openPage(page, true);
      root.querySelector('#referenceSearch').focus();
    }
    if (button.id === 'referenceMore') {
      states[page].shown += 48;
      draw(false);
    }
  });

  root.addEventListener('input', event => {
    if (event.target.id !== 'referenceSearch' || event.isComposing) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      states[page].query = event.target.value;
      states[page].shown = 48;
      draw();
    }, 140);
  });
  root.addEventListener('compositionend', event => {
    if (event.target.id === 'referenceSearch') event.target.dispatchEvent(new Event('input', { bubbles: true }));
  });
  root.addEventListener('change', event => {
    const field = event.target.dataset.referenceFilter;
    if (!field && event.target.id !== 'referenceSafe') return;
    if (field) states[page][field] = event.target.value;
    else states[page].safe = event.target.checked;
    states[page].shown = 48;
    refreshFilters();
    draw();
  });
  root.addEventListener('error', event => {
    if (!(event.target instanceof HTMLImageElement)) return;
    event.target.hidden = true;
    const error = event.target.parentElement.querySelector('.reference-image-error');
    if (error) error.hidden = false;
    event.target.parentElement.classList.add('reference-image-failed');
  }, true);
  root.addEventListener('load', event => {
    if (event.target instanceof HTMLImageElement) event.target.parentElement.classList.add('reference-image-loaded');
  }, true);
  document.addEventListener('pose-workspace-change', event => openPage(event.detail?.page));
})();
