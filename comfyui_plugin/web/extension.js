/* Pose Index ComfyUI picker. Images are loaded only for visible references. */
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_KINDS = {
  PoseIndexPose: ["pose"],
  PoseIndexCostume: ["costume"],
  PoseIndexPortrait: ["portrait"],
  PoseIndexRecipe: ["portrait", "costume", "pose"],
};
const LABELS = { pose: "姿势", costume: "服装", portrait: "人像" };
const CATALOG_KEYS = { pose: "poses", costume: "costumes", portrait: "portraits" };
const BATCH_SIZE = 36;
let catalogPromise;
let activeDialog;

const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href = new URL("./style.css", import.meta.url).href;
document.head.append(stylesheet);

function element(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function widget(node, name) {
  return node.widgets?.find((item) => item.name === name);
}

function setWidget(node, name, value) {
  const target = widget(node, name);
  if (!target) return;
  target.value = value;
  target.callback?.(value, app.canvas, node);
}

function safeURL(value, externalOnly = false) {
  try {
    let input = String(value || "");
    if (input.startsWith("/pose-index/") && typeof api.apiURL === "function") input = api.apiURL(input);
    const url = new URL(input, location.href);
    if (url.username || url.password) return "";
    if (url.protocol === "https:") return url.href;
    if (!externalOnly && url.origin === location.origin && url.protocol === "http:") return url.href;
  } catch {
    return "";
  }
  return "";
}

async function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = api.fetchApi("/pose-index/catalog").then(async (response) => {
      if (!response.ok) throw new Error(`图库索引读取失败（HTTP ${response.status}）`);
      const result = await response.json();
      for (const key of Object.values(CATALOG_KEYS)) {
        if (!Array.isArray(result[key])) throw new Error("图库索引格式不完整，请更新插件后重启 ComfyUI");
      }
      return result;
    }).catch((error) => {
      catalogPromise = null;
      throw error;
    });
  }
  return catalogPromise;
}

function option(value, label = value) {
  const item = element("option", "", label);
  item.value = value;
  return item;
}

function labeledControl(text, control) {
  const label = element("label", "pose-index-field");
  label.append(element("span", "", text), control);
  return label;
}

function checkedControl(text, checked) {
  const input = element("input");
  input.type = "checkbox";
  input.checked = checked;
  const label = element("label", "pose-index-check");
  label.append(input, document.createTextNode(text));
  return { input, label };
}

function textForSearch(record) {
  return [record.id, record.name, record.category, record.description, record.prompt,
    record.sourceLabel, record.hairLength, record.hairstyle, record.section,
    ...(Array.isArray(record.tags) ? record.tags : [])]
    .filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase();
}

function markNodeSelection(node, kinds, catalog) {
  const button = node.widgets?.find((item) => item.poseIndexPicker);
  if (!button) return;
  const selected = kinds.map((kind) => {
    const id = widget(node, `${kind}_id`)?.value;
    const record = catalog[CATALOG_KEYS[kind]].find((item) => item.id === id);
    return record ? `${LABELS[kind]} · ${record.name}` : `${LABELS[kind]}待选择`;
  });
  button.name = selected.join(" / ");
  node.setDirtyCanvas?.(true, true);
}

async function openPicker(node, kinds) {
  activeDialog?.close();
  const previousFocus = document.activeElement;
  const dialog = element("dialog", "pose-index-picker");
  activeDialog = dialog;
  const layout = element("div", "pose-index-picker-layout");
  const header = element("header", "pose-index-picker-header");
  const heading = element("h2", "", "姿态索引 · 参考选图");
  heading.id = "pose-index-picker-title";
  dialog.setAttribute("aria-labelledby", heading.id);
  const close = element("button", "pose-index-close", "关闭");
  close.type = "button";
  close.onclick = () => dialog.close();
  header.append(heading, close);
  const content = element("div", "pose-index-picker-content");
  const loading = element("p", "pose-index-status", "正在读取图库索引…");
  loading.setAttribute("role", "status");
  content.append(loading);
  layout.append(header, content);
  dialog.append(layout);
  document.body.append(dialog);
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (activeDialog === dialog) activeDialog = null;
    previousFocus?.focus?.();
  }, { once: true });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.showModal();

  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (error) {
    if (!dialog.isConnected) return;
    loading.textContent = error.message || "图库索引读取失败，请检查插件是否加载成功";
    const retry = element("button", "pose-index-button", "重新读取");
    retry.onclick = () => openPicker(node, kinds);
    content.append(retry);
    return;
  }
  if (!dialog.isConnected) return;
  content.replaceChildren();
  markNodeSelection(node, kinds, catalog);

  let kind = kinds[0];
  let visibleCount = BATCH_SIZE;
  let filtered = [];
  const normalizedSearch = new Map();
  const tabs = element("nav", "pose-index-tabs");
  tabs.setAttribute("aria-label", "参考图库");
  const tabButtons = new Map();
  for (const entry of kinds) {
    const button = element("button", "pose-index-button", `${LABELS[entry]}库`);
    button.type = "button";
    button.onclick = () => switchKind(entry);
    tabButtons.set(entry, button);
    tabs.append(button);
  }
  const selections = element("div", "pose-index-selections");
  const instructions = element("p", "pose-index-notice", "姿势白模使用本地图片，新增图库与深度图按需连接素材来源。选择图片后，节点执行时读取该参考图。");
  const controls = element("div", "pose-index-controls");
  const search = element("input");
  search.type = "search";
  search.maxLength = 500;
  search.placeholder = "搜索名称、编号、服装细节或发型";
  search.setAttribute("aria-label", "搜索参考图");
  const category = element("select");
  const source = element("select");
  const sfw = checkedControl("安全模式", widget(node, "safe_mode")?.value !== false);
  const depth = checkedControl("深度图预览", Boolean(widget(node, "use_depth")?.value));
  controls.append(search, labeledControl("分类", category), labeledControl("来源", source), sfw.label, depth.label);
  const status = element("p", "pose-index-status");
  status.setAttribute("role", "status");
  const grid = element("div", "pose-index-grid");
  const more = element("button", "pose-index-button pose-index-more", "继续显示");
  more.type = "button";
  content.append(tabs, selections, instructions, controls, status, grid, more);

  function selectedSummary() {
    selections.replaceChildren();
    for (const selectionKind of kinds) {
      const id = widget(node, `${selectionKind}_id`)?.value;
      const record = catalog[CATALOG_KEYS[selectionKind]].find((item) => item.id === id);
      const summary = element("div", "pose-index-selection");
      if (record && (!sfw.input.checked || !record.nsfw)) {
        const image = element("img");
        const useDepth = selectionKind === "pose" && widget(node, "use_depth")?.value;
        const viewIndex = selectionKind === "costume" ? Number(widget(node, "costume_view")?.value || 0) : 0;
        const selectedView = record.views?.[viewIndex];
        const url = safeURL(useDepth ? record.depthThumb : selectedView?.thumb || record.thumb);
        if (url) image.src = url;
        image.alt = record.name || record.id;
        image.onerror = () => { image.hidden = true; };
        summary.append(image);
      }
      const selectionName = record?.nsfw && sfw.input.checked ? "已选图片由安全模式隐藏" : record?.name || "待选择";
      summary.append(element("span", "", `${LABELS[selectionKind]} · ${selectionName}`));
      selections.append(summary);
    }
  }

  function choose(record, viewIndex) {
    setWidget(node, `${kind}_id`, record.id);
    if (kind === "costume") setWidget(node, "costume_view", viewIndex);
    if (kind === "pose") setWidget(node, "use_depth", depth.input.checked);
    markNodeSelection(node, kinds, catalog);
    selectedSummary();
    if (kinds.length === 1) dialog.close();
    else {
      status.textContent = `已选${LABELS[kind]} · ${record.name}。可继续选择其他图库，完成后关闭选图器。`;
      renderCards();
    }
  }

  function card(record) {
    let viewIndex = 0;
    const article = element("article", "pose-index-card");
    const imageButton = element("button", "pose-index-image-button");
    imageButton.type = "button";
    imageButton.setAttribute("aria-label", `选择${record.name || record.id}`);
    const image = element("img");
    image.loading = "lazy";
    image.decoding = "async";
    image.alt = record.name || record.id;
    const imageError = element("span", "pose-index-image-error", "图片加载失败，可查看素材来源");
    imageError.hidden = true;
    image.onerror = () => { image.hidden = true; imageError.hidden = false; };
    image.onload = () => { image.hidden = false; imageError.hidden = true; };
    imageButton.append(image, imageError);
    imageButton.onclick = () => choose(record, viewIndex);
    const body = element("div", "pose-index-card-body");
    body.append(element("h3", "", record.name || record.id), element("p", "", `${record.id} · ${record.category || LABELS[kind]}`));

    function showImage() {
      const view = record.views?.[viewIndex];
      const url = safeURL(kind === "pose" && depth.input.checked ? record.depthThumb : view?.thumb || record.thumb);
      image.hidden = false;
      imageError.hidden = true;
      if (url) image.src = url;
      else { image.removeAttribute("src"); image.hidden = true; imageError.hidden = false; }
    }

    if (Array.isArray(record.views) && record.views.length > 1) {
      const views = element("select");
      views.setAttribute("aria-label", `${record.name}的视角`);
      record.views.forEach((view, index) => views.append(option(String(index), view.label || `视角 ${index + 1}`)));
      views.onchange = () => { viewIndex = Number(views.value); showImage(); };
      body.append(views);
    }
    const sourceURL = safeURL(record.sourceUrl, true);
    if (sourceURL) {
      const link = element("a", "pose-index-source", record.sourceLabel || "素材来源");
      link.href = sourceURL;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      body.append(link);
    }
    const selected = widget(node, `${kind}_id`)?.value === record.id;
    const chooseButton = element("button", "pose-index-button", selected ? "已选，重新应用" : "选择此图");
    chooseButton.type = "button";
    chooseButton.onclick = () => choose(record, viewIndex);
    body.append(chooseButton);
    article.classList.toggle("pose-index-card-selected", selected);
    article.append(imageButton, body);
    showImage();
    return article;
  }

  function renderCards() {
    grid.replaceChildren(...filtered.slice(0, visibleCount).map(card));
    more.hidden = visibleCount >= filtered.length;
  }

  function filterRecords() {
    const tokens = search.value.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    filtered = catalog[CATALOG_KEYS[kind]].filter((record) => {
      if (sfw.input.checked && record.nsfw) return false;
      if (category.value && record.category !== category.value) return false;
      if (source.value && record.source !== source.value) return false;
      if (!normalizedSearch.has(record)) normalizedSearch.set(record, textForSearch(record));
      return tokens.every((token) => normalizedSearch.get(record).includes(token));
    });
    visibleCount = BATCH_SIZE;
    status.textContent = filtered.length ? `${filtered.length.toLocaleString()} 条${LABELS[kind]}参考` : "没有匹配的参考图，请调整关键词或筛选条件";
    renderCards();
  }

  function switchKind(nextKind) {
    kind = nextKind;
    const records = catalog[CATALOG_KEYS[kind]];
    category.replaceChildren(option("", "全部分类"));
    const categories = [...new Set(records.map((record) => record.category).filter(Boolean))];
    categories.sort((a, b) => a.localeCompare(b, "zh-CN"));
    for (const value of categories) category.append(option(value));
    source.replaceChildren(option("", "全部来源"));
    const sources = new Map(records.filter((record) => record.source).map((record) => [record.source, record.sourceLabel || record.source]));
    for (const [value, label] of sources) source.append(option(value, label));
    source.closest("label").hidden = sources.size <= 1;
    depth.label.hidden = kind !== "pose";
    for (const [tabKind, button] of tabButtons) button.setAttribute("aria-pressed", String(tabKind === kind));
    filterRecords();
  }

  search.oninput = filterRecords;
  category.onchange = filterRecords;
  source.onchange = filterRecords;
  sfw.input.onchange = () => {
    setWidget(node, "safe_mode", sfw.input.checked);
    selectedSummary();
    filterRecords();
  };
  depth.input.onchange = renderCards;
  more.onclick = () => {
    const start = visibleCount;
    visibleCount += BATCH_SIZE;
    grid.append(...filtered.slice(start, visibleCount).map(card));
    more.hidden = visibleCount >= filtered.length;
    status.textContent = `${filtered.length.toLocaleString()} 条参考，已显示 ${Math.min(visibleCount, filtered.length)} 条`;
  };
  selectedSummary();
  switchKind(kind);
  search.focus();
}

app.registerExtension({
  name: "PoseIndex.ReferencePicker",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    const kinds = NODE_KINDS[nodeData.name];
    if (!kinds) return;
    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function (...args) {
      const result = originalCreated?.apply(this, args);
      const button = this.addWidget("button", "打开中文参考选图器", null, () => openPicker(this, kinds));
      button.poseIndexPicker = true;
      button.options = { ...button.options, serialize: false };
      return result;
    };
  },
});
