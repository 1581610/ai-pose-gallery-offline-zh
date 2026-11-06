/* Provider contract regressions. All HTTP requests use in-memory fixtures. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../src/generator.js'), 'utf8');
const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=';
const imageData = `data:image/png;base64,${imageBase64}`;
const apiKey = 'private-fixture-key-do-not-display';

class FixtureFileReader {
  readAsDataURL(blob) {
    blob.arrayBuffer().then(buffer => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    }).catch(error => {
      this.error = error;
      this.onerror?.({ target: this });
    });
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function imageResponse() {
  return new Response(Buffer.from(imageBase64, 'base64'), {
    headers: { 'Content-Type': 'image/png' },
  });
}

function harness(respond) {
  const requests = [];
  const context = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    URLSearchParams,
    Blob,
    File,
    FormData,
    Headers,
    Request,
    Response,
    ReadableStream,
    AbortController,
    AbortSignal,
    DOMException,
    TypeError,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    crypto: webcrypto,
    FileReader: FixtureFileReader,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    location: { href: 'http://127.0.0.1:8899/index.html', origin: 'http://127.0.0.1:8899' },
    fetch: async (input, init = {}) => {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      const request = { url, method: init.method || 'GET', ...init };
      if (request.signal?.aborted) throw new DOMException('Aborted fixture request', 'AbortError');
      requests.push(request);
      return respond(request, requests);
    },
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'src/generator.js' });
  assert.ok(context.PoseGenerator, 'The generator exposes window.PoseGenerator');
  return { api: context.PoseGenerator, requests };
}

function body(request) {
  return JSON.parse(request.body);
}

function reference(slot = 'portrait') {
  return { dataUrl: imageData, name: `${slot}.png`, slot };
}

function assertImages(result) {
  assert.ok(Array.isArray(result.images) && result.images.length > 0);
  assert.ok(result.images.every(image => image.dataUrl || image.url));
}

const tests = [];
function test(name, run) {
  tests.push({ name, run });
}

test('Gemini sends prompt, inline reference and requested image settings', async () => {
  const { api, requests } = harness(request => {
    if (request.url.startsWith('data:')) return imageResponse();
    assert.match(request.url, /\/models\/gemini-image-fixture:generateContent/);
    return jsonResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: imageBase64 } }] } }] });
  });
  const result = await api.generate({
    provider: 'gemini', baseUrl: 'https://gemini.fixture/v1beta', apiKey,
    model: 'gemini-image-fixture', prompt: 'fixture portrait', images: [reference()],
    options: { aspectRatio: '3:4', resolution: '2K' },
  });
  const request = requests.find(item => item.url.includes(':generateContent'));
  const payload = body(request);
  const parts = payload.contents.flatMap(content => content.parts);
  assert.ok(parts.some(part => part.text === 'fixture portrait'));
  assert.ok(parts.some(part => part.inlineData?.data === imageBase64));
  assert.equal(payload.generationConfig.imageConfig.aspectRatio, '3:4');
  assert.equal(payload.generationConfig.imageConfig.imageSize, '2K');
  assert.ok(new Headers(request.headers).get('x-goog-api-key') === apiKey || new URL(request.url).searchParams.get('key') === apiKey);
  assertImages(result);
});

test('OpenAI text generation uses one v1 prefix and JSON parameters', async () => {
  const { api, requests } = harness(request => {
    assert.equal(request.url, 'https://openai.fixture/v1/images/generations');
    return jsonResponse({ data: [{ b64_json: imageBase64 }] });
  });
  const result = await api.generate({
    provider: 'openai', baseUrl: 'https://openai.fixture/v1/', apiKey,
    model: 'gpt-image-fixture', prompt: 'fixture landscape', images: [],
    options: { size: '1024x1536', quality: 'high', background: 'transparent' },
  });
  const payload = body(requests[0]);
  assert.equal(payload.prompt, 'fixture landscape');
  assert.equal(payload.model, 'gpt-image-fixture');
  assert.equal(payload.size, '1024x1536');
  assert.equal(payload.quality, 'high');
  assert.equal(payload.background, 'transparent');
  assert.equal(new Headers(requests[0].headers).get('authorization'), `Bearer ${apiKey}`);
  assertImages(result);
});

test('OpenAI references use multipart edits with every uploaded image', async () => {
  const { api, requests } = harness(request => {
    if (request.url.startsWith('data:')) return imageResponse();
    assert.equal(request.url, 'https://openai.fixture/v1/images/edits');
    assert.ok(request.body instanceof FormData);
    return jsonResponse({ data: [{ b64_json: imageBase64 }] });
  });
  const result = await api.generate({
    provider: 'openai', baseUrl: 'https://openai.fixture', apiKey,
    model: 'gpt-image-fixture', prompt: 'combine fixtures',
    images: [reference('portrait'), reference('costume')], options: { size: '1024x1024' },
  });
  const request = requests.find(item => item.url.endsWith('/images/edits'));
  const files = [...request.body.entries()].filter(([, value]) => value instanceof Blob);
  assert.equal(files.length, 2);
  assert.ok(files.every(([, file]) => file.size > 0 && file.type === 'image/png'));
  assert.equal(request.body.get('prompt'), 'combine fixtures');
  assert.equal(request.body.get('model'), 'gpt-image-fixture');
  assert.equal(new Headers(request.headers).has('content-type'), false, 'The browser supplies the multipart boundary');
  assertImages(result);
});

test('Qwen sends multimodal content and parses returned images', async () => {
  const { api, requests } = harness(request => {
    if (request.url.startsWith('data:')) return imageResponse();
    assert.match(request.url, /\/services\/aigc\/multimodal-generation\/generation$/);
    return jsonResponse({ output: { choices: [{ message: { content: [{ image: 'https://result.fixture/qwen.png' }] } }] } });
  });
  const result = await api.generate({
    provider: 'qwen', baseUrl: 'https://qwen.fixture/api/v1', apiKey,
    model: 'qwen-image-fixture', prompt: 'qwen fixture', images: [reference()],
    options: { width: 1024, height: 1536, promptExtend: false, watermark: false },
  });
  const payload = body(requests.find(item => item.url.includes('/multimodal-generation/')));
  const content = payload.input.messages.flatMap(message => message.content);
  assert.ok(content.some(item => item.text === 'qwen fixture'));
  assert.ok(content.some(item => item.image));
  assert.equal(payload.parameters.prompt_extend, false);
  assert.equal(payload.parameters.watermark, false);
  assertImages(result);
});

test('Doubao sends multiple references and recognizes image URLs', async () => {
  const { api, requests } = harness(request => {
    if (request.url.startsWith('data:')) return imageResponse();
    assert.equal(request.url, 'https://doubao.fixture/api/v3/images/generations');
    return jsonResponse({ data: [{ url: 'https://result.fixture/doubao.png' }] });
  });
  const result = await api.generate({
    provider: 'doubao', baseUrl: 'https://doubao.fixture/api/v3', apiKey,
    model: 'seedream-fixture', prompt: 'doubao fixture',
    images: [reference('portrait'), reference('pose')], options: { size: '2K', watermark: false },
  });
  const payload = body(requests.find(item => item.url.endsWith('/images/generations')));
  assert.equal(payload.model, 'seedream-fixture');
  assert.equal(payload.prompt, 'doubao fixture');
  assert.equal(payload.image.length, 2);
  assert.equal(payload.watermark, false);
  assertImages(result);
});

test('Provider errors redact the configured key', async () => {
  const { api } = harness(() => jsonResponse({ error: { message: `Rejected token ${apiKey}` } }, 401));
  await assert.rejects(api.generate({
    provider: 'openai', baseUrl: 'https://openai.fixture/v1', apiKey,
    model: 'gpt-image-fixture', prompt: 'error fixture', images: [],
  }), error => {
    assert.ok(!String(error.message).includes(apiKey));
    assert.ok(String(error.message).length > 0);
    return true;
  });
});

test('Missing generated images produce a useful rejection', async () => {
  const { api } = harness(() => jsonResponse({ data: [] }));
  await assert.rejects(api.generate({
    provider: 'openai', baseUrl: 'https://openai.fixture/v1', apiKey,
    model: 'gpt-image-fixture', prompt: 'empty fixture', images: [],
  }));
});

test('An already cancelled request performs no HTTP work', async () => {
  const controller = new AbortController();
  controller.abort();
  const { api, requests } = harness(() => { throw new Error('No request should be sent'); });
  await assert.rejects(api.generate({
    provider: 'openai', baseUrl: 'https://openai.fixture/v1', apiKey,
    model: 'gpt-image-fixture', prompt: 'cancel fixture', images: [], signal: controller.signal,
  }));
  assert.equal(requests.length, 0);
});

test('Failed reference download stops before an OpenAI generation request', async () => {
  const { api, requests } = harness(request => {
    assert.equal(request.url, 'https://reference.fixture/blocked.png');
    return new Response('Image unavailable', { status: 403 });
  });
  await assert.rejects(api.generate({
    provider: 'openai', baseUrl: 'https://openai.fixture/v1', apiKey,
    model: 'gpt-image-fixture', prompt: 'image failure',
    images: [{ url: 'https://reference.fixture/blocked.png', slot: 'portrait' }],
  }));
  assert.equal(requests.length, 1);
});

test('Reference downloads omit provider authentication headers', async () => {
  for (const provider of ['openai', 'gemini']) {
    const { api, requests } = harness(request => {
      if (request.url === 'https://reference.fixture/public.png') {
        const headers = new Headers(request.headers);
        assert.equal(headers.has('authorization'), false);
        assert.equal(headers.has('x-goog-api-key'), false);
        assert.equal(request.credentials, 'omit');
        return imageResponse();
      }
      if (provider === 'gemini') {
        return jsonResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: imageBase64 } }] } }] });
      }
      return jsonResponse({ data: [{ b64_json: imageBase64 }] });
    });
    const result = await api.generate({
      provider, baseUrl: `https://${provider}.fixture`, apiKey,
      model: 'fixture-model', prompt: 'authentication fixture',
      images: [{ url: 'https://reference.fixture/public.png', slot: 'portrait' }],
    });
    assertImages(result);
    assert.equal(requests.filter(request => request.url === 'https://reference.fixture/public.png').length, 1);
  }
});

test('Unsafe image response URLs are rejected', async () => {
  for (const url of ['javascript:alert(1)', 'file:///private.png', 'https://user:secret@result.fixture/image.png']) {
    const { api } = harness(() => jsonResponse({ data: [{ url }] }));
    await assert.rejects(api.generate({
      provider: 'openai', baseUrl: 'https://openai.fixture/v1', apiKey,
      model: 'gpt-image-fixture', prompt: 'unsafe URL fixture', images: [],
    }));
  }
});

test('Credentials embedded in API base URLs are rejected before HTTP work', async () => {
  const { api, requests } = harness(() => { throw new Error('No request should be sent'); });
  await assert.rejects(api.generate({
    provider: 'openai', baseUrl: 'https://user:password@openai.fixture/v1', apiKey,
    model: 'gpt-image-fixture', prompt: 'credential URL fixture', images: [],
  }));
  assert.equal(requests.length, 0);
});

test('Cancelling after response headers aborts a pending JSON body', async () => {
  const controller = new AbortController();
  let markHeadersReady;
  const headersReady = new Promise(resolve => { markHeadersReady = resolve; });
  const { api } = harness(request => {
    const stream = new ReadableStream({
      start(streamController) {
        request.signal.addEventListener('abort', () => {
          streamController.error(new DOMException('Fixture response body aborted', 'AbortError'));
        }, { once: true });
      },
    });
    setTimeout(markHeadersReady, 0);
    return new Response(stream, { headers: { 'Content-Type': 'application/json' } });
  });
  const pending = api.generate({
    provider: 'openai', baseUrl: 'https://openai.fixture/v1', apiKey,
    model: 'gpt-image-fixture', prompt: 'slow body fixture', images: [], signal: controller.signal,
  });
  const rejected = assert.rejects(pending, error => error.name === 'AbortError');
  await headersReady;
  controller.abort();
  let watchdog;
  try {
    await Promise.race([
      rejected,
      new Promise((resolve, reject) => { watchdog = setTimeout(() => reject(new Error('Cancelling a response body did not settle within 2 seconds')), 2000); }),
    ]);
  } finally {
    clearTimeout(watchdog);
  }
});

test('Request timeout also covers a stalled response body', async () => {
  const { api } = harness(request => {
    const stream = new ReadableStream({
      start(streamController) {
        request.signal.addEventListener('abort', () => {
          streamController.error(new DOMException('Fixture response timed out', 'AbortError'));
        }, { once: true });
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/json' } });
  });
  const rejected = assert.rejects(api.generate({
    provider: 'openai', baseUrl: 'https://openai.fixture/v1', apiKey,
    model: 'gpt-image-fixture', prompt: 'body timeout fixture', images: [], timeoutMs: 5,
  }), error => /超时/.test(error.message));
  let watchdog;
  try {
    await Promise.race([
      rejected,
      new Promise((resolve, reject) => { watchdog = setTimeout(() => reject(new Error('Stalled response body did not time out')), 2000); }),
    ]);
  } finally {
    clearTimeout(watchdog);
  }
});

test('Cancelling a pending reference body stops before a generation request', async () => {
  const controller = new AbortController();
  let markHeadersReady;
  const headersReady = new Promise(resolve => { markHeadersReady = resolve; });
  const { api, requests } = harness(request => {
    assert.equal(request.url, 'https://reference.fixture/slow.png');
    const stream = new ReadableStream({
      start(streamController) {
        request.signal.addEventListener('abort', () => {
          streamController.error(new DOMException('Fixture reference body aborted', 'AbortError'));
        }, { once: true });
      },
    });
    setTimeout(markHeadersReady, 0);
    return new Response(stream, { headers: { 'Content-Type': 'image/png' } });
  });
  const rejected = assert.rejects(api.generate({
    provider: 'openai', baseUrl: 'https://openai.fixture/v1', apiKey,
    model: 'gpt-image-fixture', prompt: 'slow reference fixture', signal: controller.signal,
    images: [{ url: 'https://reference.fixture/slow.png', slot: 'portrait' }],
  }), error => error.name === 'AbortError');
  await headersReady;
  controller.abort();
  let watchdog;
  try {
    await Promise.race([
      rejected,
      new Promise((resolve, reject) => { watchdog = setTimeout(() => reject(new Error('Cancelling a reference body did not settle')), 2000); }),
    ]);
  } finally {
    clearTimeout(watchdog);
  }
  assert.equal(requests.length, 1);
});

test('ComfyUI rejects editor-format graphs and clones valid API graphs', () => {
  const { api } = harness(() => { throw new Error('Validation performs no network requests'); });
  assert.throws(() => api.validateWorkflow({ nodes: [{ id: 1, type: 'KSampler' }], links: [] }));
  assert.throws(() => api.validateWorkflow({}));
  const graph = { '1': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } } };
  const validated = api.validateWorkflow(graph);
  assert.deepEqual(JSON.parse(JSON.stringify(validated)), graph);
  assert.notEqual(validated, graph);
  assert.ok(api.validateWorkflow(api.workflowTemplate()));
});

test('ComfyUI uploads inputs, substitutes typed placeholders and tracks its own job', async () => {
  const progress = [];
  let historyChecks = 0;
  const workflow = {
    '1': { class_type: 'LoadImage', inputs: { image: '{{portrait_image}}' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } },
    '3': { class_type: 'EmptyLatentImage', inputs: { width: '{{width}}', height: '{{height}}' } },
    '4': { class_type: 'KSampler', inputs: { seed: '{{seed}}' } },
    '5': { class_type: 'SaveImage', inputs: { filename_prefix: 'fixture' } },
  };
  const original = JSON.stringify(workflow);
  const { api, requests } = harness(request => {
    if (request.url.startsWith('data:')) return imageResponse();
    const url = new URL(request.url);
    if (url.pathname === '/upload/image') {
      assert.ok(request.body instanceof FormData);
      assert.ok(request.body.get('image') instanceof Blob);
      return jsonResponse({ name: 'portrait.png', subfolder: 'fixture', type: 'input' });
    }
    if (url.pathname === '/prompt') return jsonResponse({ prompt_id: 'job-fixture' });
    if (url.pathname === '/history/job-fixture') {
      historyChecks += 1;
      return jsonResponse(historyChecks === 1 ? {} : {
        'job-fixture': {
          status: { completed: true, status_str: 'success', messages: [] },
          outputs: { '5': { images: [{ filename: 'output.png', subfolder: 'fixture', type: 'output' }] } },
        },
      });
    }
    if (url.pathname === '/view') return imageResponse();
    throw new Error(`Unexpected fixture endpoint ${url.pathname}`);
  });
  const result = await api.generate({
    provider: 'comfyui', baseUrl: 'http://127.0.0.1:8188/', prompt: 'comfy fixture',
    images: [reference()], workflow,
    options: { width: 768, height: 1024, seed: 123, pollIntervalMs: 1 },
    onProgress: value => progress.push(value),
  });
  const payload = body(requests.find(request => new URL(request.url).pathname === '/prompt'));
  assert.equal(payload.prompt['1'].inputs.image, 'fixture/portrait.png');
  assert.equal(payload.prompt['2'].inputs.text, 'comfy fixture');
  assert.equal(payload.prompt['3'].inputs.width, 768);
  assert.equal(payload.prompt['3'].inputs.height, 1024);
  assert.equal(payload.prompt['4'].inputs.seed, 123);
  assert.equal(JSON.stringify(workflow), original, 'Preparing a request preserves the imported template');
  assert.equal(result.promptId, 'job-fixture');
  assert.ok(progress.some(value => value.promptId === 'job-fixture'));
  assertImages(result);
});

test('ComfyUI resume returns an existing completed job without enqueueing again', async () => {
  const { api, requests } = harness(request => {
    const url = new URL(request.url);
    if (url.pathname === '/history/existing-job') return jsonResponse({
      'existing-job': {
        status: { completed: true, status_str: 'success' },
        outputs: { '7': { images: [{ filename: 'existing.png', subfolder: '', type: 'output' }] } },
      },
    });
    if (url.pathname === '/view') return imageResponse();
    throw new Error(`Unexpected fixture endpoint ${url.pathname}`);
  });
  const result = await api.resume({ baseUrl: 'http://127.0.0.1:8188', promptId: 'existing-job', options: { pollIntervalMs: 1 } });
  assertImages(result);
  assert.equal(requests.some(request => request.method === 'POST'), false);
});

test('ComfyUI keeps waiting when partial outputs precede completion', async () => {
  let historyChecks = 0;
  const { api } = harness(request => {
    const url = new URL(request.url);
    assert.equal(url.pathname, '/history/partial-job');
    historyChecks += 1;
    return jsonResponse({
      'partial-job': {
        status: { completed: historyChecks > 1, status_str: historyChecks > 1 ? 'success' : 'running' },
        outputs: { '7': { images: [{ filename: historyChecks > 1 ? 'final.png' : 'partial.png', subfolder: '', type: 'output' }] } },
      },
    });
  });
  const result = await api.resume({ baseUrl: 'http://127.0.0.1:8188', promptId: 'partial-job', options: { pollIntervalMs: 1 } });
  assert.equal(historyChecks, 2);
  assert.ok(result.images[0].url.includes('final.png'));
});

test('ComfyUI refuses ambiguous multi-reference mapping before enqueueing', async () => {
  let uploads = 0;
  const { api, requests } = harness(request => {
    if (request.url.startsWith('data:')) return imageResponse();
    assert.equal(new URL(request.url).pathname, '/upload/image');
    uploads += 1;
    return jsonResponse({ name: `reference-${uploads}.png`, subfolder: '', type: 'input' });
  });
  await assert.rejects(api.generate({
    provider: 'comfyui', baseUrl: 'http://127.0.0.1:8188', prompt: 'ambiguous mapping fixture',
    images: [reference('portrait'), reference('costume')],
    workflow: {
      '1': { class_type: 'LoadImage', inputs: { image: 'old-image.png' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } },
    },
  }), error => /LoadImage|占位符|参考图/.test(error.message));
  assert.equal(uploads, 2);
  assert.equal(requests.some(request => new URL(request.url).pathname === '/prompt'), false);
});

test('ComfyUI execution failures stop polling and explain the failed task', async () => {
  const { api, requests } = harness(() => jsonResponse({
    'failed-job': {
      status: {
        completed: false,
        status_str: 'error',
        messages: [['execution_error', { node_id: '4', exception_message: 'Fixture sampler failure' }]],
      },
      outputs: {},
    },
  }));
  await assert.rejects(api.resume({ baseUrl: 'http://127.0.0.1:8188', promptId: 'failed-job', options: { pollIntervalMs: 1 } }));
  assert.equal(requests.length, 1);
});

function completedComfyFixture(request) {
  const url = new URL(request.url);
  if (url.pathname === '/prompt') return jsonResponse({ prompt_id: 'mapping-job' });
  if (url.pathname === '/history/mapping-job') return jsonResponse({
    'mapping-job': {
      status: { completed: true, status_str: 'success' },
      outputs: { '9': { images: [{ filename: 'mapping.png', subfolder: '', type: 'output' }] } },
    },
  });
  throw new Error(`Unexpected fixture endpoint ${url.pathname}`);
}

function parameterWorkflow() {
  return {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } },
    '2': { class_type: 'KSampler', inputs: { seed: 42 } },
    '3': { class_type: 'KSamplerAdvanced', inputs: { noise_seed: 84 } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 640 } },
    '5': { class_type: 'EmptySD3LatentImage', inputs: { width: 896, height: 1152 } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'mapping' } },
  };
}

test('ComfyUI preserves connected seed and dimension inputs when options are explicit', async () => {
  const workflow = parameterWorkflow();
  workflow['2'].inputs.seed = ['10', 0];
  workflow['3'].inputs.noise_seed = ['10', 1];
  workflow['4'].inputs.width = ['11', 0];
  workflow['4'].inputs.height = ['11', 1];
  workflow['5'].inputs.width = ['12', 0];
  workflow['5'].inputs.height = ['12', 1];
  workflow['10'] = { class_type: 'PrimitiveInt', inputs: { value: 321 } };
  workflow['11'] = { class_type: 'PrimitiveInt', inputs: { value: 512 } };
  workflow['12'] = { class_type: 'PrimitiveInt', inputs: { value: 1024 } };
  const { api, requests } = harness(completedComfyFixture);
  await api.generate({
    provider: 'comfyui', baseUrl: 'http://127.0.0.1:8188', prompt: 'linked parameter fixture',
    images: [], workflow, options: { seed: 0, width: 768, height: 1024 },
  });
  const sent = body(requests.find(request => new URL(request.url).pathname === '/prompt')).prompt;
  for (const id of ['2', '3', '4', '5']) assert.deepEqual(sent[id].inputs, workflow[id].inputs);
});

test('ComfyUI retains workflow scalar parameters for missing or empty options', async () => {
  for (const options of [undefined, {}, { seed: '', width: '', height: '' }]) {
    const workflow = parameterWorkflow();
    const { api, requests } = harness(completedComfyFixture);
    await api.generate({
      provider: 'comfyui', baseUrl: 'http://127.0.0.1:8188', prompt: 'retained parameter fixture',
      images: [], workflow, options,
    });
    const sent = body(requests.find(request => new URL(request.url).pathname === '/prompt')).prompt;
    for (const id of ['2', '3', '4', '5']) assert.deepEqual(sent[id].inputs, workflow[id].inputs);
  }
});

test('ComfyUI applies explicit scalar options including seed zero', async () => {
  const { api, requests } = harness(completedComfyFixture);
  await api.generate({
    provider: 'comfyui', baseUrl: 'http://127.0.0.1:8188', prompt: 'explicit parameter fixture',
    images: [], workflow: parameterWorkflow(), options: { seed: 0, width: 768 },
  });
  const sent = body(requests.find(request => new URL(request.url).pathname === '/prompt')).prompt;
  assert.equal(sent['2'].inputs.seed, 0);
  assert.equal(sent['3'].inputs.noise_seed, 0);
  assert.equal(sent['4'].inputs.width, 768);
  assert.equal(sent['5'].inputs.width, 768);
  assert.equal(sent['4'].inputs.height, 640);
  assert.equal(sent['5'].inputs.height, 1152);
});

test('ComfyUI reports ambiguous submission status after a network failure without retrying', async () => {
  const { api, requests } = harness(request => {
    assert.equal(new URL(request.url).pathname, '/prompt');
    throw new TypeError('Fixture connection lost after request transmission');
  });
  await assert.rejects(api.generate({
    provider: 'comfyui', baseUrl: 'http://127.0.0.1:8188', prompt: 'uncertain submission fixture',
    images: [], workflow: parameterWorkflow(),
  }), error => /可能已接收/.test(error.message) && /确认.*重试/.test(error.message));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
});

test('ComfyUI preserves text and image links while replacing upstream placeholders', async () => {
  const workflow = {
    '1': { class_type: 'LoadImage', inputs: { image: ['11', 0] }, _meta: { title: 'Portrait reference' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: ['12', 0] } },
    '11': { class_type: 'PrimitiveString', inputs: { value: '{{portrait_image}}' } },
    '12': { class_type: 'PrimitiveString', inputs: { value: '{{prompt}}' } },
  };
  const { api, requests } = harness(request => {
    if (request.url.startsWith('data:')) return imageResponse();
    if (new URL(request.url).pathname === '/upload/image') {
      return jsonResponse({ name: 'linked-portrait.png', subfolder: 'fixture', type: 'input' });
    }
    return completedComfyFixture(request);
  });
  await api.generate({
    provider: 'comfyui', baseUrl: 'http://127.0.0.1:8188', prompt: 'linked content fixture',
    images: [reference('portrait')], workflow,
  });
  const sent = body(requests.find(request => new URL(request.url).pathname === '/prompt')).prompt;
  assert.deepEqual(sent['1'].inputs.image, ['11', 0]);
  assert.deepEqual(sent['2'].inputs.text, ['12', 0]);
  assert.equal(sent['11'].inputs.value, 'fixture/linked-portrait.png');
  assert.equal(sent['12'].inputs.value, 'linked content fixture');
  assert.equal(workflow['11'].inputs.value, '{{portrait_image}}');
  assert.equal(workflow['12'].inputs.value, '{{prompt}}');
});

test('ComfyUI awaits queued progress persistence before polling history', async () => {
  let queuedSaved = false;
  let queuedCalls = 0;
  const { api } = harness(request => {
    if (new URL(request.url).pathname.startsWith('/history/')) assert.equal(queuedSaved, true);
    return completedComfyFixture(request);
  });
  const result = await api.generate({
    provider: 'comfyui', baseUrl: 'http://127.0.0.1:8188', prompt: 'saved task fixture',
    images: [], workflow: parameterWorkflow(),
    onProgress: async progress => {
      if (progress.status !== 'queued') return;
      queuedCalls += 1;
      assert.equal(progress.promptId, 'mapping-job');
      await new Promise(resolve => setTimeout(resolve, 5));
      queuedSaved = true;
    },
  });
  assert.equal(queuedCalls, 1);
  assertImages(result);
});

test('ComfyUI connection check uses the configured base path', async () => {
  const { api, requests } = harness(request => {
    assert.equal(request.url, 'http://127.0.0.1:8188/comfy/system_stats');
    return jsonResponse({ system: { comfyui_version: 'fixture' }, devices: [] });
  });
  await api.testConnection({ provider: 'comfyui', baseUrl: 'http://127.0.0.1:8188/comfy/' });
  assert.equal(requests.length, 1);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${name}`);
      console.error(String(error.stack || error).replaceAll(apiKey, '[redacted]'));
    }
  }
  console.log(`Generator protocol tests: ${tests.length - failures}/${tests.length} passed, no live API requests`);
  process.exitCode = failures ? 1 : 0;
})();
