/* Browser-side image protocols. Requests start only through an explicit UI action. */
(() => {
  'use strict';

  const DEFAULTS = {
    gemini: 'https://generativelanguage.googleapis.com/v1beta',
    openai: 'https://api.openai.com/v1',
    qwen: 'https://dashscope.aliyuncs.com/api/v1',
    doubao: 'https://ark.cn-beijing.volces.com/api/v3',
    comfyui: 'http://127.0.0.1:8188'
  };
  const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

  function abortError() {
    return new DOMException('已停止等待，可在服务端查看已提交的任务。', 'AbortError');
  }

  function checkSignal(signal) {
    if (signal?.aborted) throw abortError();
  }

  function safeMessage(message, apiKey) {
    let text = String(message || '接口请求失败');
    if (apiKey) text = text.split(apiKey).join('[已隐藏密钥]');
    return text.replace(/(?:Bearer\s+)[^\s"'<>]+/gi, 'Bearer [已隐藏密钥]')
      .replace(/([?&](?:key|api_key|token)=)[^\s&"'<>]+/gi, '$1[已隐藏密钥]')
      .slice(0, 600);
  }

  function baseUrl(config) {
    const value = String(config.baseUrl || DEFAULTS[config.provider] || '').trim();
    let url;
    try { url = new URL(value); } catch { throw new Error('接口地址需要完整的 http 或 https URL。'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('接口地址仅支持 http 或 https，请在密钥输入框填写密钥。');
    }
    return url.href.replace(/\/+$/, '');
  }

  function endpoint(config, path, version = '') {
    let base = baseUrl(config);
    // Accept either an API root or the full endpoint copied from a provider.
    base = base.replace(/\/(?:images\/(?:generations|edits)|services\/aigc\/multimodal-generation\/generation|models\/[^/]+:generateContent)$/, '');
    if (version && !new RegExp('/' + version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$').test(base)) {
      // Custom gateways can already include their own versioned prefix.
      if (!/\/v\d+(?:beta)?$/.test(base)) base += '/' + version;
    }
    return base + '/' + path.replace(/^\//, '');
  }

  async function request(url, init = {}, context = {}) {
    checkSignal(context.signal);
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    context.signal?.addEventListener('abort', onAbort, {once: true});
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, context.timeoutMs || 180000);
    try {
      const response = await fetch(url, {...init, signal: controller.signal, credentials: 'omit'});
      if (!response.ok) {
        const text = await response.text();
        let detail = '';
        try {
          const body = JSON.parse(text);
          detail = body.error?.message || body.message || body.error || '';
        } catch { detail = text.replace(/<[^>]*>/g, ' ').trim(); }
        const error = new Error(`接口返回 HTTP ${response.status}。${safeMessage(typeof detail === 'string' ? detail : JSON.stringify(detail), context.apiKey)}`);
        error.httpStatus = response.status;
        throw error;
      }
      if (context.responseType === 'blob') return await response.blob();
      let data;
      try { data = await response.json(); } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new Error('接口返回了无法解析的 JSON，请核对协议类型和地址。');
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('接口 JSON 响应格式无效，请核对协议类型和地址。');
      return data;
    } catch (error) {
      if (context.signal?.aborted) throw abortError();
      if (timedOut) throw new Error('请求等待超时。请检查服务端任务状态后再决定是否重试。');
      if (error instanceof TypeError) {
        throw new Error('无法连接接口或读取参考图。请检查地址、网络、跨域许可及浏览器对 HTTPS 页面访问本地 HTTP 的限制。');
      }
      const sanitized = new Error(safeMessage(error.message, context.apiKey));
      if (error.httpStatus) sanitized.httpStatus = error.httpStatus;
      throw sanitized;
    } finally {
      clearTimeout(timer);
      context.signal?.removeEventListener('abort', onAbort);
    }
  }

  async function jsonRequest(url, body, config, method = 'POST') {
    const headers = {'Content-Type': 'application/json'};
    if (config.apiKey) headers.Authorization = 'Bearer ' + config.apiKey;
    return request(url, {method, headers, ...(body === undefined ? {} : {body: JSON.stringify(body)})}, config);
  }

  async function imageBlob(image, config) {
    const source = image.dataUrl || image.url;
    if (typeof source !== 'string' || !source) throw new Error('参考图缺少有效地址。');
    let url;
    try { url = new URL(source, globalThis.location?.href || 'http://localhost/'); } catch { throw new Error('参考图地址无效。'); }
    if (!['https:', 'http:', 'data:', 'blob:', 'file:'].includes(url.protocol)) throw new Error('参考图地址协议不受支持。');
    if (url.username || url.password || (url.protocol === 'data:' && !/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(source))) {
      throw new Error('请使用 PNG、JPEG、WebP 或 GIF 图片。');
    }
    const blob = await request(url.href, {}, {...config, timeoutMs: 45000, responseType: 'blob'});
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(blob.type)) throw new Error('参考图响应并非受支持的图片。请下载原图后通过本地文件上传。');
    if (!blob.size || blob.size > MAX_IMAGE_BYTES) throw new Error('每张参考图需要介于 1 字节与 25 MB 之间。');
    return blob;
  }

  async function blobDataUrl(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    }
    return 'data:' + blob.type + ';base64,' + btoa(binary);
  }

  async function imageDataUrl(image, config) {
    return blobDataUrl(await imageBlob(image, config));
  }

  function resultImages(images) {
    const valid = images.filter(image => {
      if (image.dataUrl) return /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(image.dataUrl);
      try {
        const url = new URL(image.url);
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
      } catch { return false; }
    });
    if (!valid.length) throw new Error('接口响应中没有可显示的图片。请检查模型是否支持图像输出。');
    return {images: valid};
  }

  function optionsFor(config) {
    return config.options && typeof config.options === 'object' ? config.options : {};
  }

  function responseList(value) {
    return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
  }

  async function generateGemini(config) {
    const parts = [{text: config.prompt}];
    for (const image of config.images) {
      const dataUrl = await imageDataUrl(image, config);
      const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
      parts.push({inlineData: {mimeType: match[1], data: match[2]}});
    }
    const options = optionsFor(config);
    const imageConfig = {};
    if (options.aspectRatio) imageConfig.aspectRatio = options.aspectRatio;
    if (options.resolution) imageConfig.imageSize = options.resolution;
    const body = {contents: [{role: 'user', parts}], generationConfig: {responseModalities: ['TEXT', 'IMAGE']}};
    if (Object.keys(imageConfig).length) body.generationConfig.imageConfig = imageConfig;
    const url = endpoint(config, 'models/' + encodeURIComponent(config.model.replace(/^models\//, '')) + ':generateContent', 'v1beta');
    const data = await request(url, {method: 'POST', headers: {'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey}, body: JSON.stringify(body)}, config);
    const images = [];
    for (const candidate of responseList(data.candidates)) {
      for (const part of responseList(candidate.content?.parts)) {
        const inline = part.inlineData || part.inline_data;
        if (inline?.data) images.push({dataUrl: `data:${inline.mimeType || inline.mime_type || 'image/png'};base64,${inline.data}`});
      }
    }
    return resultImages(images);
  }

  async function generateOpenAI(config) {
    const options = optionsFor(config);
    const body = {model: config.model, prompt: config.prompt, n: 1};
    for (const field of ['size', 'quality', 'background']) if (options[field]) body[field] = options[field];
    let data;
    if (config.images.length) {
      const form = new FormData();
      for (const [key, value] of Object.entries(body)) form.append(key, String(value));
      for (let i = 0; i < config.images.length; i++) {
        const blob = await imageBlob(config.images[i], config);
        form.append('image[]', blob, `reference-${i + 1}.${blob.type.split('/')[1]}`);
      }
      data = await request(endpoint(config, 'images/edits', 'v1'), {method: 'POST', headers: {Authorization: 'Bearer ' + config.apiKey}, body: form}, config);
    } else {
      data = await jsonRequest(endpoint(config, 'images/generations', 'v1'), body, config);
    }
    return resultImages(responseList(data.data).map(image => image.b64_json ? {dataUrl: 'data:image/png;base64,' + image.b64_json} : {url: image.url}));
  }

  async function generateQwen(config) {
    const content = [];
    for (const image of config.images) content.push({image: await imageDataUrl(image, config)});
    content.push({text: config.prompt});
    const options = optionsFor(config);
    const parameters = {n: 1};
    if (options.size && options.size !== 'auto') parameters.size = options.size.replace('x', '*');
    if (typeof options.promptExtend === 'boolean') parameters.prompt_extend = options.promptExtend;
    if (typeof options.watermark === 'boolean') parameters.watermark = options.watermark;
    if (Number.isSafeInteger(Number(options.seed)) && options.seed !== undefined && options.seed !== '') parameters.seed = Number(options.seed);
    const data = await jsonRequest(endpoint(config, 'services/aigc/multimodal-generation/generation', 'api/v1'), {
      model: config.model, input: {messages: [{role: 'user', content}]}, parameters
    }, config);
    const images = [];
    for (const choice of responseList(data.output?.choices)) {
      for (const part of responseList(choice.message?.content)) {
        if (typeof part.image === 'string') images.push(part.image.startsWith('data:') ? {dataUrl: part.image} : {url: part.image});
      }
    }
    return resultImages(images);
  }

  async function generateDoubao(config) {
    const options = optionsFor(config);
    const body = {model: config.model, prompt: config.prompt, response_format: 'b64_json', stream: false};
    if (options.size && options.size !== 'auto') body.size = options.size;
    else if (options.resolution) body.size = options.resolution;
    if (typeof options.watermark === 'boolean') body.watermark = options.watermark;
    if (Number.isSafeInteger(Number(options.seed)) && options.seed !== undefined && options.seed !== '') body.seed = Number(options.seed);
    if (config.images.length) {
      body.image = [];
      for (const image of config.images) body.image.push(await imageDataUrl(image, config));
    }
    const data = await jsonRequest(endpoint(config, 'images/generations', 'api/v3'), body, config);
    return resultImages(responseList(data.data).map(image => image.b64_json ? {dataUrl: 'data:image/png;base64,' + image.b64_json} : {url: image.url}));
  }

  function validateWorkflow(workflow) {
    let value = workflow;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { throw new Error('工作流 JSON 无法解析。'); }
    }
    if (value?.prompt && typeof value.prompt === 'object') value = value.prompt;
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.nodes || value.links) {
      throw new Error('请从 ComfyUI 导出 API 格式工作流 JSON。普通画布格式需要先转换为 API 格式。');
    }
    const entries = Object.entries(value);
    if (!entries.length || entries.length > 1000 || entries.some(([id, node]) => !id || !node || typeof node.class_type !== 'string' || !node.inputs || typeof node.inputs !== 'object' || Array.isArray(node.inputs))) {
      throw new Error('API 工作流需要由节点 ID、class_type 和 inputs 组成，最多支持 1000 个节点。');
    }
    return JSON.parse(JSON.stringify(value));
  }

  function workflowTemplate() {
    return {
      '1': {class_type: 'CheckpointLoaderSimple', inputs: {ckpt_name: 'YOUR_MODEL.safetensors'}},
      '2': {class_type: 'CLIPTextEncode', inputs: {text: '{{prompt}}', clip: ['1', 1]}, _meta: {title: 'Positive prompt'}},
      '3': {class_type: 'CLIPTextEncode', inputs: {text: '', clip: ['1', 1]}, _meta: {title: 'Negative prompt'}},
      '4': {class_type: 'LoadImage', inputs: {image: '{{composite_image}}'}, _meta: {title: 'Composite reference'}},
      '5': {class_type: 'ImageScale', inputs: {image: ['4', 0], upscale_method: 'lanczos', width: '{{width}}', height: '{{height}}', crop: 'disabled'}},
      '6': {class_type: 'VAEEncode', inputs: {pixels: ['5', 0], vae: ['1', 2]}},
      '7': {class_type: 'KSampler', inputs: {seed: '{{seed}}', steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 0.7, model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['6', 0]}},
      '8': {class_type: 'VAEDecode', inputs: {samples: ['7', 0], vae: ['1', 2]}},
      '9': {class_type: 'SaveImage', inputs: {images: ['8', 0], filename_prefix: 'PoseIndex'}}
    };
  }

  function replaceVariables(value, variables) {
    if (typeof value === 'string') {
      const full = /^\{\{\s*(\w+)\s*\}\}$/.exec(value);
      if (full && Object.hasOwn(variables, full[1])) return variables[full[1]];
      return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (token, key) => Object.hasOwn(variables, key) ? String(variables[key]) : token);
    }
    if (Array.isArray(value)) return value.map(item => replaceVariables(item, variables));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceVariables(item, variables)]));
    return value;
  }

  function integer(value, fallback, min, max) {
    const number = Number(value);
    return value !== undefined && value !== '' && Number.isSafeInteger(number) && number >= min && number <= max ? number : fallback;
  }

  function hasOption(options, name) {
    return Object.hasOwn(options, name) && options[name] !== null && options[name] !== undefined && String(options[name]).trim() !== '';
  }

  function mapWorkflow(workflow, variables, uploaded, options) {
    const original = JSON.stringify(workflow);
    const result = replaceVariables(workflow, variables);
    const nodes = Object.values(result);
    const positiveIds = new Set();
    const negativeIds = new Set();
    for (const node of nodes) {
      if (Array.isArray(node.inputs.positive)) positiveIds.add(String(node.inputs.positive[0]));
      if (Array.isArray(node.inputs.negative)) negativeIds.add(String(node.inputs.negative[0]));
      if (['KSampler', 'KSamplerAdvanced'].includes(node.class_type)) {
        if (hasOption(options, 'seed')) {
          if ('seed' in node.inputs && !Array.isArray(node.inputs.seed)) node.inputs.seed = variables.seed;
          if ('noise_seed' in node.inputs && !Array.isArray(node.inputs.noise_seed)) node.inputs.noise_seed = variables.seed;
        }
      }
      if (['EmptyLatentImage', 'EmptySD3LatentImage'].includes(node.class_type)) {
        if (hasOption(options, 'width') && 'width' in node.inputs && !Array.isArray(node.inputs.width)) node.inputs.width = variables.width;
        if (hasOption(options, 'height') && 'height' in node.inputs && !Array.isArray(node.inputs.height)) node.inputs.height = variables.height;
      }
    }
    if (!/\{\{\s*prompt\s*\}\}/.test(original)) {
      const candidates = Object.entries(result).filter(([id, node]) => node.class_type === 'CLIPTextEncode' && typeof node.inputs.text === 'string' && !negativeIds.has(id) && !/negative|负面/i.test(node._meta?.title || ''));
      const known = candidates.filter(([id]) => positiveIds.has(id));
      const targets = known.length ? known : candidates.length === 1 ? candidates : [];
      if (!targets.length) throw new Error('工作流提示词位置不明确。请在目标文本输入中写入 {{prompt}}。');
      for (const [, node] of targets) node.inputs.text = variables.prompt;
    }
    const loads = nodes.filter(node => node.class_type === 'LoadImage');
    for (const node of loads) {
      if (typeof node.inputs.image !== 'string') continue;
      if (uploaded.some(image => image.filename === node.inputs.image)) continue;
      const title = node._meta?.title || '';
      const slots = [['portrait', /portrait|face|人像|面部/i], ['costume', /costume|outfit|服装/i], ['pose', /pose|姿势|姿态/i], ['composite', /composite|拼图|合成/i]];
      const slot = slots.find(([, pattern]) => pattern.test(title))?.[0];
      const image = uploaded.find(item => item.slot === slot);
      if (image) node.inputs.image = image.filename;
      else if (loads.length === 1) {
        const combined = uploaded.find(item => item.slot === 'composite');
        if (combined) node.inputs.image = combined.filename;
        else if (uploaded.length === 1) node.inputs.image = uploaded[0].filename;
        else if (uploaded.length > 1) throw new Error('工作流只有一个 LoadImage。请提供拼图或为各参考图设置对应的图像占位符。');
      }
    }
    const unresolved = JSON.stringify(result).match(/\{\{\s*\w+\s*\}\}/g);
    if (unresolved) throw new Error('工作流缺少占位符对应的内容。' + [...new Set(unresolved)].join('、'));
    const serialized = JSON.stringify(result);
    const used = uploaded.filter(image => serialized.includes(JSON.stringify(image.filename)));
    if (uploaded.length && !used.length) throw new Error('工作流没有使用参考图。请在图像输入中设置 {{pose_image}}、{{portrait_image}}、{{costume_image}} 或 {{composite_image}}。');
    const usesComposite = used.some(image => image.slot === 'composite');
    const missingImages = uploaded.filter(image => !used.includes(image) && image.slot !== 'composite' && (!usesComposite || !['portrait', 'costume', 'pose'].includes(image.slot)));
    if (missingImages.length) {
      throw new Error('部分参考图尚未映射到工作流。请给各图像输入设置对应占位符，附加图可使用 {{extra_image_1}}、{{extra_image_2}}。');
    }
    return result;
  }

  async function delay(milliseconds, signal) {
    checkSignal(signal);
    return new Promise((resolve, reject) => {
      const onAbort = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); reject(abortError()); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, milliseconds);
      signal?.addEventListener('abort', onAbort, {once: true});
    });
  }

  async function resume(config) {
    const context = {...config, provider: 'comfyui'};
    const promptId = String(context.promptId || '');
    if (!promptId || promptId.length > 200) throw new Error('缺少有效的 ComfyUI 任务 ID。');
    const options = optionsFor(context);
    const deadline = Date.now() + integer(options.maxWaitMs, 60 * 60 * 1000, 1000, 24 * 60 * 60 * 1000);
    const interval = integer(options.pollIntervalMs, 1500, 1, 30000);
    while (Date.now() < deadline) {
      checkSignal(context.signal);
      const data = await jsonRequest(endpoint(context, 'history/' + encodeURIComponent(promptId)), undefined, {...context, timeoutMs: 30000}, 'GET');
      const history = data[promptId];
      if (history) {
        const failure = responseList(history.status?.messages).find(item => ['execution_error', 'execution_interrupted'].includes(item[0]));
        if (history.status?.status_str === 'error' || failure) {
          throw new Error('ComfyUI 任务失败。' + safeMessage(failure?.[1]?.exception_message || history.status?.status_str, context.apiKey));
        }
        const images = [];
        for (const output of Object.values(history.outputs || {})) {
          for (const image of responseList(output?.images)) {
            if (!image.filename || !['output', 'temp', undefined].includes(image.type)) continue;
            const params = new URLSearchParams({filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output'});
            images.push({url: endpoint(context, 'view') + '?' + params, name: image.filename});
          }
        }
        const completed = history.status?.completed || history.status?.status_str === 'success';
        if (completed && images.length) {
          context.onProgress?.({status: 'complete', message: 'ComfyUI 已完成', promptId});
          return {...resultImages(images), promptId};
        }
        if (completed) throw new Error('ComfyUI 已完成，但工作流没有输出图片。请添加 SaveImage 或 PreviewImage 节点。');
      }
      context.onProgress?.({status: 'waiting', message: '等待 ComfyUI 完成，可切换图库继续浏览', promptId});
      await delay(interval, context.signal);
    }
    throw new Error('ComfyUI 任务仍未返回结果。可使用保存的任务 ID 继续追踪。');
  }

  async function generateComfy(config) {
    const workflow = validateWorkflow(config.workflow);
    const options = optionsFor(config);
    const uploaded = [];
    config.onProgress?.({status: 'uploading', message: '正在上传所选参考图'});
    for (let index = 0; index < config.images.length; index++) {
      const image = config.images[index];
      const blob = await imageBlob(image, config);
      const form = new FormData();
      const unique = globalThis.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(16).slice(2);
      form.append('image', blob, `pose-index-${unique}-${index}.${blob.type.split('/')[1]}`);
      form.append('type', 'input');
      form.append('overwrite', 'false');
      const result = await request(endpoint(config, 'upload/image'), {method: 'POST', body: form}, config);
      if (!result.name || typeof result.name !== 'string') throw new Error('ComfyUI 未返回已上传图片的名称。');
      uploaded.push({slot: image.slot || 'extra', filename: (result.subfolder ? result.subfolder + '/' : '') + result.name});
    }
    const variables = {
      prompt: config.prompt,
      seed: integer(options.seed, Math.floor(Math.random() * 0x100000000), 0, Number.MAX_SAFE_INTEGER),
      width: integer(options.width, 1024, 64, 8192),
      height: integer(options.height, 1024, 64, 8192)
    };
    let extraIndex = 0;
    for (const image of uploaded) {
      if (['portrait', 'costume', 'pose', 'composite'].includes(image.slot)) variables[image.slot + '_image'] = image.filename;
      else variables['extra_image_' + (++extraIndex)] = image.filename;
    }
    const prepared = mapWorkflow(workflow, variables, uploaded, options);
    const clientId = globalThis.crypto?.randomUUID?.() || 'pose-index-' + Date.now();
    checkSignal(config.signal);
    let data;
    try {
      data = await jsonRequest(endpoint(config, 'prompt'), {prompt: prepared, client_id: clientId}, config);
    } catch (error) {
      if (error.httpStatus && error.httpStatus < 500) throw error;
      const unknown = new Error('ComfyUI 提交结果未知，服务端可能已接收，请在 ComfyUI 确认后再重试。' + safeMessage(error.message, config.apiKey));
      unknown.code = 'COMFY_SUBMISSION_UNKNOWN';
      throw unknown;
    }
    if (!data.prompt_id) throw new Error('ComfyUI 未接收工作流。' + safeMessage(data.error?.message || JSON.stringify(data.node_errors || {}), config.apiKey));
    await config.onProgress?.({status: 'queued', message: 'ComfyUI 已接收任务', promptId: data.prompt_id});
    return resume({...config, promptId: data.prompt_id});
  }

  async function testConnection(config) {
    if (config.provider !== 'comfyui') throw new Error('连接检测适用于 ComfyUI。云端接口会在生成时验证。');
    const data = await jsonRequest(endpoint(config, 'system_stats'), undefined, {...config, timeoutMs: 15000}, 'GET');
    if (!data.system && !data.devices) throw new Error('此地址返回的内容与 ComfyUI 系统信息不匹配。');
    return {ok: true, message: '已连接 ComfyUI', devices: (data.devices || []).map(device => device.name).filter(Boolean)};
  }

  async function generate(input) {
    const config = {...input, images: Array.isArray(input.images) ? input.images : []};
    checkSignal(config.signal);
    const generators = {gemini: generateGemini, openai: generateOpenAI, qwen: generateQwen, doubao: generateDoubao, comfyui: generateComfy};
    if (!generators[config.provider]) throw new Error('请选择支持的图像接口协议。');
    baseUrl(config);
    if (typeof config.prompt !== 'string' || !config.prompt.trim()) throw new Error('请填写生成提示词。');
    if (config.provider !== 'comfyui' && (!config.apiKey || !config.model?.trim())) throw new Error('请先填写接口密钥和模型名称。');
    config.onProgress?.({status: 'preparing', message: '正在准备参考图'});
    return generators[config.provider](config);
  }

  window.PoseGenerator = Object.freeze({generate, testConnection, resume, validateWorkflow, workflowTemplate});
})();
