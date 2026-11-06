"""Isolated browser regressions for the reference libraries and composition workbench."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from urllib.parse import urlsplit
import base64
import json
import os
import re
import sys
import threading
import time
import traceback

from PIL import Image
from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
PREFIX = '/ai-pose-gallery-offline-zh'
FAKE_KEY = 'workbench-regression-secret-never-persist'
API_ORIGIN = 'https://workbench-api.invalid'
CATALOGUE = json.loads((ROOT / 'data/reference-catalog.json').read_text(encoding='utf-8'))
IMAGE_BUFFER = BytesIO()
Image.new('RGB', (32, 48), '#638675').save(IMAGE_BUFFER, format='PNG')
PNG = IMAGE_BUFFER.getvalue()
PNG_BASE64 = base64.b64encode(PNG).decode('ascii')


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith(PREFIX + '/'):
            self.path = self.path[len(PREFIX):]
        super().do_GET()

    def log_message(self, *args):
        pass


class Server(ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


def navigate(page, workspace):
    page.click(f'#referenceNav button[data-workspace="{workspace}"]')
    expect(page.locator('#app')).to_have_attribute('data-workspace', workspace)


def wait_count(page, expected):
    expect(page.locator('#referenceCount')).to_have_text(f'{expected:,} 条结果')


def upload(name='reference.png', body=PNG, mime='image/png'):
    return {'name': name, 'mimeType': mime, 'buffer': body}


def download_text(page, action):
    with page.expect_download() as pending:
        action()
    download = pending.value
    assert download.failure() is None
    return Path(download.path()).read_text(encoding='utf-8')


def assert_no_horizontal_overflow(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'page overflows horizontally'


def configure_openai(page):
    navigate(page, 'settings')
    page.select_option('#studioProvider', 'openai')
    page.fill('#studioBaseUrl', API_ORIGIN + '/v1')
    page.fill('#studioModel', 'workbench-test-image')
    page.fill('#studioApiKey', FAKE_KEY)
    navigate(page, 'studio')


def persisted_studio(page):
    return page.evaluate('''async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('pose_studio_v1', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const entries = await Promise.all([...database.objectStoreNames].map(name => new Promise((resolve, reject) => {
          const request = database.transaction(name).objectStore(name).getAll();
          request.onsuccess = () => resolve([name, request.result]);
          request.onerror = () => reject(request.error);
        })));
        return Object.fromEntries(entries);
      } finally {
        database.close();
      }
    }''')


def wait_recipe_saved(page):
    expected = page.evaluate('PoseStudio.getRecipe()')
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if expected in persisted_studio(page).get('state', []):
            return
        page.wait_for_timeout(50)
    raise AssertionError('current recipe was not committed to IndexedDB before reload')


def run():
    failures = []
    cases = []
    server = Server(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    http_url = f'http://127.0.0.1:{server.server_port}{PREFIX}/'
    file_url = (ROOT / 'index.html').as_uri()

    try:
        with sync_playwright() as playwright:
            channel = os.environ.get('POSE_BROWSER_CHANNEL', 'msedge')
            launch_options = {'channel': channel} if channel != 'chromium' else {}
            browser = playwright.chromium.launch(headless=True, **launch_options)

            def case(name, callback, mobile=False, http=False):
                cases.append(name)
                context = browser.new_context(
                    viewport={'width': 390 if mobile else 1440, 'height': 844 if mobile else 1000},
                    has_touch=mobile,
                    is_mobile=mobile,
                    accept_downloads=True,
                )
                remote_images = []
                errors = []

                def intercept(route):
                    request = route.request
                    url = urlsplit(request.url)
                    if url.scheme not in ('http', 'https') or url.hostname == '127.0.0.1':
                        route.continue_()
                    elif request.resource_type == 'image' or re.search(r'\.(png|jpe?g|webp)(?:$|\?)', request.url):
                        remote_images.append(request.url)
                        route.fulfill(status=200, content_type='image/png', body=PNG,
                                      headers={'Access-Control-Allow-Origin': '*'})
                    else:
                        route.abort()

                context.route('**/*', intercept)
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.set_default_timeout(12000)
                try:
                    page.goto(http_url if http else file_url, wait_until='load')
                    expect(page.locator('#grid .card')).to_have_count(48)
                    callback(page, context, remote_images)
                    assert not errors, errors
                    print('PASS', name, flush=True)
                except Exception as error:
                    message = (str(error).splitlines() or [type(error).__name__])[0]
                    failures.append((name, message))
                    print('FAIL', name, message, flush=True)
                    traceback.print_exc(limit=2)
                    artifacts = ROOT / 'tests' / 'artifacts'
                    artifacts.mkdir(parents=True, exist_ok=True)
                    try:
                        page.screenshot(path=str(artifacts / f'workbench-{len(cases)}-failure.png'))
                    except Exception:
                        pass
                finally:
                    context.close()

            def pose_compatibility(page, context, remote_images):
                assert not remote_images, 'opening the offline pose library requests remote images'
                assert len(json.loads(page.locator('#poseData').text_content())) == 1439
                page.locator('#grid .card').first.click()
                prompts = json.loads(page.locator('#promptData').text_content())
                expect(page.locator('#posePrompt')).to_have_text(prompts['full_sexy_P001'])
                expect(page.locator('#anglePrefix')).to_have_text('front view, eye-level camera')
                page.click('#viewerDepth')
                expect(page.locator('#viewerDepth')).to_have_attribute('aria-pressed', 'true')
                page.wait_for_function("() => document.querySelector('#fullImage').src.includes('ai-pose-depth-gallery')")
                page.click('#viewerDepth')
                expect(page.locator('#viewerDepth')).to_have_attribute('aria-pressed', 'false')
                page.wait_for_function("() => document.querySelector('#fullImage').src.includes('/assets/images/')")
                expect(page.locator('#posePrompt')).to_have_text(prompts['full_sexy_P001'])
                page.click('#closeViewer')
            case('offline pose startup, reviewed prompts and reversible depth view', pose_compatibility)

            def costume_filters(page, context, remote_images):
                embedded = json.loads(page.locator('#referenceData').text_content())
                assert len(embedded['costumes']) == 3224
                assert len(embedded['portraits']) == 1499
                navigate(page, 'costumes')
                expect(page.locator('#referenceWorkspace')).to_be_visible()
                expect(page.locator('#poseWorkspace')).not_to_be_visible()
                safe = [record for record in CATALOGUE['costumes'] if not record.get('nsfw')]
                wait_count(page, len(safe))
                expect(page.locator('#referenceGrid .reference-card')).to_have_count(48)
                page.click('#referenceMore')
                expect(page.locator('#referenceGrid .reference-card')).to_have_count(96)
                page.uncheck('#referenceSafe')
                wait_count(page, 3224)
                page.check('#referenceSafe')
                sample = next(record for record in safe if record['tags'])
                page.select_option('#referenceSource', sample['source'])
                page.select_option('#referenceCategory', sample['category'])
                page.select_option('#referenceTag', sample['tags'][0])
                expected = [record for record in safe if record['source'] == sample['source']
                            and record['category'] == sample['category'] and sample['tags'][0] in record['tags']]
                wait_count(page, len(expected))
                page.fill('#referenceSearch', sample['id'] + ' ' + sample['category'])
                wait_count(page, 1)
                page.locator('#referenceGrid [data-reference-preview]').first.click()
                expect(page.locator('#referenceViewer')).to_be_visible()
                expect(page.locator('#referencePrompt')).to_have_text(sample['prompt'])
                page.locator('#referenceViewer [data-reference-close]').click()
                page.fill('#referenceSearch', 'missing-reference-784529')
                wait_count(page, 0)
                expect(page.locator('.reference-empty')).to_be_visible()
                page.locator('.reference-empty [data-reference-reset]').click()
                wait_count(page, len(safe))
            case('costume catalogue, safe filter, pagination, intersecting filters and empty state', costume_filters)

            def portrait_filters(page, context, remote_images):
                navigate(page, 'portraits')
                wait_count(page, 1499)
                sample = next(record for record in CATALOGUE['portraits'] if record.get('hairLength') and record.get('hairstyle'))
                page.select_option('#referenceSource', sample['source'])
                page.select_option('#referenceCategory', sample['category'])
                page.select_option('#referenceHairLength', sample['hairLength'])
                page.select_option('#referenceHairstyle', sample['hairstyle'])
                expected = [record for record in CATALOGUE['portraits'] if all(record.get(field) == sample.get(field)
                            for field in ('source', 'category', 'hairLength', 'hairstyle'))]
                wait_count(page, len(expected))
                page.fill('#referenceSearch', sample['id'])
                wait_count(page, 1)
                navigate(page, 'costumes')
                navigate(page, 'portraits')
                expect(page.locator('#referenceSearch')).to_have_value(sample['id'])
                wait_count(page, 1)
            case('portrait hair filters and independent catalogue state', portrait_filters)

            def failed_reference_image(page, context, remote_images):
                context.route('https://ai-costume-gallery.pages.dev/**', lambda route: route.abort())
                navigate(page, 'costumes')
                expect(page.locator('.reference-image-error:visible').first).to_be_visible()
                expect(page.locator('#referenceGrid [data-reference-add]').first).to_be_enabled()
                expect(page.locator('#referenceSearch')).to_be_enabled()
            case('unavailable remote pictures show inline feedback and usable catalogue controls', failed_reference_image)

            def recipe_slots(page, context, remote_images):
                page.locator('#grid .card').first.click()
                page.click('#addPoseRecipe')
                expect(page.locator('#studioWorkspace')).to_be_visible()
                expect(page.locator('#studioSlots [data-slot="pose"] img')).to_have_count(1)
                assert page.evaluate('PoseStudio.getRecipe().pose.id') == 'full_sexy_P001_front'
                navigate(page, 'costumes')
                costume_id = page.locator('#referenceGrid [data-reference-add]').first.get_attribute('data-reference-add')
                page.locator('#referenceGrid [data-reference-add]').first.click()
                expect(page.locator('#studioWorkspace')).to_be_visible()
                assert page.evaluate('PoseStudio.getRecipe().costume.id') == costume_id
                navigate(page, 'portraits')
                portrait_id = page.locator('#referenceGrid [data-reference-add]').first.get_attribute('data-reference-add')
                page.locator('#referenceGrid [data-reference-add]').first.click()
                expect(page.locator('#studioWorkspace')).to_be_visible()
                assert page.evaluate('PoseStudio.getRecipe().portrait.id') == portrait_id
                prompt = page.input_value('#studioPrompt')
                assert all(label in prompt for label in ('人像参考', '服装参考', '姿势参考'))
                assert 'front view, eye-level camera' in prompt
                page.click('[data-remove-slot="portrait"]')
                expect(page.locator('#studioSlots [data-slot="portrait"] img')).to_have_count(0)
                page.click('[data-random-slot="portrait"]')
                expect(page.locator('#studioSlots [data-slot="portrait"] img')).to_have_count(1)
                page.click('#studioRandomAll')
                expect(page.locator('#studioSlots img')).to_have_count(3)
                recipe = page.evaluate('PoseStudio.getRecipe()')
                assert all(recipe[slot] for slot in ('portrait', 'costume', 'pose'))
                page.select_option('#studioStyle', 'anime')
                assert '日系二次元插画' in page.input_value('#studioPrompt')
            case('three libraries fill independent recipe slots and randomized style prompts', recipe_slots)

            def portable_pose_recipe(page, context, remote_images):
                page.locator('#grid .card').first.click()
                page.click('#addPoseRecipe')
                expect(page.locator('#studioSlots [data-slot="pose"] img')).to_have_count(1)
                pose_id = 'full_sexy_P001_front'
                wait_recipe_saved(page)
                page.reload(wait_until='load')
                page.wait_for_function("() => document.querySelectorAll('#studioSlots [data-slot=pose] img').length === 1")
                page.wait_for_function("() => document.querySelector('#studioSlots [data-slot=pose] img')?.naturalWidth === 900")
                assert page.evaluate('PoseStudio.getRecipe().pose.id') == pose_id
                file_recipe = download_text(page, lambda: page.click('#studioExportRecipe'))
                page.goto(http_url + '#studio', wait_until='load')
                page.set_input_files('#studioImportRecipe', upload('file-recipe.json', file_recipe.encode('utf-8'), 'application/json'))
                expected_http = http_url + 'assets/images/' + pose_id + '.png'
                expect(page.locator('#studioSlots [data-slot="pose"] img')).to_have_attribute('src', expected_http)
                page.wait_for_function("() => document.querySelector('#studioSlots [data-slot=pose] img')?.naturalWidth === 900")
                http_recipe = download_text(page, lambda: page.click('#studioExportRecipe'))
                relocated = json.loads(file_recipe)
                relocated['recipe']['pose']['full'] = 'file:///Z:/old-gallery/assets/images/' + pose_id + '.png'
                relocated['recipe']['pose']['thumb'] = 'file:///Z:/old-gallery/assets/thumbnails/' + pose_id + '.webp'
                page.set_input_files('#studioImportRecipe', upload('relocated.json', json.dumps(relocated).encode(), 'application/json'))
                expect(page.locator('#studioSlots [data-slot="pose"] img')).to_have_attribute('src', expected_http)
                page.goto(file_url + '#studio', wait_until='load')
                page.set_input_files('#studioImportRecipe', upload('http-recipe.json', http_recipe.encode('utf-8'), 'application/json'))
                expected_file = (ROOT / 'assets' / 'images' / (pose_id + '.png')).as_uri()
                expect(page.locator('#studioSlots [data-slot="pose"] img')).to_have_attribute('src', expected_file)
                page.wait_for_function("() => document.querySelector('#studioSlots [data-slot=pose] img')?.naturalWidth === 900")
            case('known local poses survive reload and recipe moves between file and HTTP origins', portable_pose_recipe)

            def route_closes_dialogs(page, context, remote_images):
                page.locator('#grid .card').first.click()
                page.click('#pinImage')
                expect(page.locator('#viewer')).to_be_visible()
                page.evaluate("location.hash = 'costumes'")
                expect(page.locator('#app')).to_have_attribute('data-workspace', 'costumes')
                expect(page.locator('#viewer')).not_to_be_visible()
                navigate(page, 'poses')
                page.click('#boardBtn')
                expect(page.locator('#boardDialog')).to_be_visible()
                page.evaluate("document.dispatchEvent(new CustomEvent('pose-workspace-request', {detail: {page: 'portraits'}}))")
                expect(page.locator('#app')).to_have_attribute('data-workspace', 'portraits')
                expect(page.locator('#boardDialog')).not_to_be_visible()
                navigate(page, 'poses')
                page.click('#newCollection')
                expect(page.locator('#smallDialog')).to_be_visible()
                page.evaluate("location.hash = 'studio'")
                expect(page.locator('#app')).to_have_attribute('data-workspace', 'studio')
                expect(page.locator('#smallDialog')).not_to_be_visible()
                assert page.locator('dialog[open]').count() == 0
            case('hash and workspace navigation close pose viewer, reference board and edit dialogs', route_closes_dialogs)

            def isolated_pose_scroll(page, context, remote_images):
                page.evaluate('window.scrollTo(0, 1000)')
                page.wait_for_function("() => JSON.parse(localStorage.getItem('pose_index_v2')).view.scroll === 1000")
                page.evaluate('''() => {
                  const input = document.querySelector('#search');
                  input.value = 'P';
                  input.dispatchEvent(new Event('input', {bubbles: true}));
                  document.querySelector('#referenceNav [data-workspace=costumes]').click();
                  window.scrollTo(0, 1700);
                }''')
                expect(page.locator('#app')).to_have_attribute('data-workspace', 'costumes')
                page.wait_for_function("() => JSON.parse(localStorage.getItem('pose_index_v2')).view.query === 'P'")
                page.wait_for_timeout(220)
                assert abs(page.evaluate('scrollY') - 1700) < 3, 'pending pose search changes another workspace scroll'
                saved = page.evaluate("JSON.parse(localStorage.getItem('pose_index_v2')).view")
                assert saved['scroll'] == 1000, 'other workspace scroll overwrites saved pose position'
                navigate(page, 'poses')
                page.wait_for_function('() => Math.abs(scrollY - 1000) < 3')
                expect(page.locator('#search')).to_have_value('P')
                navigate(page, 'portraits')
                page.evaluate('window.scrollTo(0, 1900)')
                page.wait_for_timeout(220)
                page.reload(wait_until='load')
                assert page.evaluate("JSON.parse(localStorage.getItem('pose_index_v2')).view.scroll") == 1000
            case('pending pose search and other workspace scroll preserve independent pose position', isolated_pose_scroll)

            def upload_export_import(page, context, remote_images):
                navigate(page, 'studio')
                for slot in ('portrait', 'costume', 'pose'):
                    page.set_input_files(f'[data-upload-slot="{slot}"]', upload(slot + '.png'))
                    expect(page.locator(f'#studioSlots [data-slot="{slot}"] img')).to_have_count(1)
                page.set_input_files('#studioExtrasInput', [upload('extra-one.png'), upload('extra-two.png')])
                expect(page.locator('#studioExtras img')).to_have_count(2)
                page.fill('#studioPrompt', '手写配方提示词 regression 4631')
                serialized = download_text(page, lambda: page.click('#studioExportRecipe'))
                exported = json.loads(serialized)
                assert exported['format'] == 'pose-studio-recipe' and exported['version'] == 1
                assert exported['recipe']['prompt'] == '手写配方提示词 regression 4631'
                assert len(exported['recipe']['extras']) == 2
                for slot in ('portrait', 'costume', 'pose'):
                    assert exported['recipe'][slot]['full'].startswith('data:image/png;base64,')
                page.click('[data-remove-slot="portrait"]')
                page.set_input_files('#studioImportRecipe', upload('recipe.json', serialized.encode('utf-8'), 'application/json'))
                expect(page.locator('#studioSlots img')).to_have_count(3)
                expect(page.locator('#studioPrompt')).to_have_value('手写配方提示词 regression 4631')
                wait_recipe_saved(page)
                page.reload(wait_until='load')
                expect(page.locator('#studioSlots img')).to_have_count(3)
                expect(page.locator('#studioExtras img')).to_have_count(2)
                expect(page.locator('#studioPrompt')).to_have_value('手写配方提示词 regression 4631')
                page.click('#studioCompose')
                expect(page.locator('#studioCompositeDialog')).to_be_visible()
                page.wait_for_function("() => document.querySelector('#studioCompositeImage').naturalWidth === 1800")
                with page.expect_download() as pending:
                    page.click('#studioDownloadComposite')
                with Image.open(pending.value.path()) as image:
                    assert image.size == (1800, 1200) and image.format == 'PNG'
            case('uploaded reference files, recipe round-trip and persistent 1800x1200 PNG composition', upload_export_import)

            def failed_files(page, context, remote_images):
                navigate(page, 'studio')
                page.set_input_files('[data-upload-slot="portrait"]', upload())
                expect(page.locator('#studioSlots [data-slot="portrait"] img')).to_have_count(1)
                before = page.evaluate('PoseStudio.getRecipe()')
                page.set_input_files('[data-upload-slot="portrait"]', upload('broken.png', b'not a PNG image'))
                expect(page.locator('#studioStatus')).to_contain_text('解码失败')
                assert page.evaluate('PoseStudio.getRecipe()') == before
                page.set_input_files('#studioExtrasInput', upload('notes.txt', b'plain text', 'text/plain'))
                expect(page.locator('#studioStatus')).to_contain_text('请选择')
                expect(page.locator('#studioExtras img')).to_have_count(0)
                page.set_input_files('#studioImportRecipe', upload('invalid.json', b'{"format":"other","version":1}', 'application/json'))
                expect(page.locator('#studioStatus')).to_contain_text('格式无效')
                assert page.evaluate('PoseStudio.getRecipe()') == before
                expect(page.locator('#studioGenerate')).to_be_enabled()
            case('bad image and recipe inputs give feedback and preserve the previous recipe', failed_files)

            def attachments_and_settings(page, context, remote_images):
                navigate(page, 'studio')
                page.fill('#studioUrlInput', 'javascript:alert(1)')
                page.click('#studioAddUrl')
                expect(page.locator('#studioStatus')).to_contain_text('HTTP')
                expect(page.locator('#studioExtras img')).to_have_count(0)
                page.fill('#studioUrlInput', 'https://reference-test.invalid/example.png')
                page.click('#studioAddUrl')
                expect(page.locator('#studioExtras img')).to_have_count(1)
                page.evaluate('''encoded => {
                  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
                  const transfer = new DataTransfer();
                  transfer.items.add(new File([bytes], 'pasted-reference.png', {type: 'image/png'}));
                  document.dispatchEvent(new ClipboardEvent('paste', {clipboardData: transfer, bubbles: true}));
                }''', PNG_BASE64)
                expect(page.locator('#studioExtras img')).to_have_count(2)
                page.evaluate('''encoded => {
                  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
                  const transfer = new DataTransfer();
                  transfer.items.add(new File([bytes], 'dropped-reference.png', {type: 'image/png'}));
                  document.querySelector('#studioDropZone').dispatchEvent(new DragEvent('drop', {dataTransfer: transfer, bubbles: true}));
                }''', PNG_BASE64)
                expect(page.locator('#studioExtras img')).to_have_count(3)
                page.locator('[data-remove-extra]').first.click()
                expect(page.locator('#studioExtras img')).to_have_count(2)
                page.click('[data-studio-settings]')
                expect(page.locator('#studioProvider')).to_be_visible()
                page.click('[data-studio-back]')
                expect(page.locator('#studioRandomAll')).to_be_visible()
            case('URL, pasted and dropped attachments plus direct settings navigation', attachments_and_settings)

            def credentials_and_generation(page, context, remote_images):
                requests = []

                def success(route):
                    requests.append(route.request)
                    route.fulfill(status=200, content_type='application/json',
                                  headers={'Access-Control-Allow-Origin': '*'},
                                  body=json.dumps({'data': [{'b64_json': PNG_BASE64}]}))

                context.route(API_ORIGIN + '/**', success)
                configure_openai(page)
                page.fill('#studioPrompt', 'mock image generation 874')
                recipe_json = download_text(page, lambda: page.click('#studioExportRecipe'))
                assert FAKE_KEY not in recipe_json
                assert FAKE_KEY not in page.evaluate('JSON.stringify({...localStorage})')
                page.click('#studioGenerate')
                expect(page.locator('#studioResults img')).to_have_count(1)
                expect(page.locator('#studioHistory .studio-history-card')).to_have_count(1)
                expect(page.locator('#studioStatus')).to_contain_text('生成完成')
                actual = [request for request in requests if request.method == 'POST']
                assert len(actual) == 1
                assert actual[0].url == API_ORIGIN + '/v1/images/generations'
                assert actual[0].headers.get('authorization') == 'Bearer ' + FAKE_KEY
                assert actual[0].post_data_json['prompt'] == 'mock image generation 874'
                stored = persisted_studio(page)
                assert FAKE_KEY not in json.dumps(stored)
                assert len(stored['history']) == 1
                navigate(page, 'poses')
                personal_backup = download_text(page, lambda: page.click('#backupBtn'))
                assert FAKE_KEY not in personal_backup
                navigate(page, 'studio')
                page.reload(wait_until='load')
                expect(page.locator('#studioHistory .studio-history-card')).to_have_count(1)
                navigate(page, 'settings')
                expect(page.locator('#studioApiKey')).to_have_value('')
                expect(page.locator('#studioBaseUrl')).to_have_value(API_ORIGIN + '/v1')
                page.fill('#studioApiKey', FAKE_KEY)
                navigate(page, 'studio')
                context.unroute(API_ORIGIN + '/**', success)
                context.route(API_ORIGIN + '/**', lambda route: route.fulfill(
                    status=401, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'},
                    body=json.dumps({'error': {'message': 'rejected ' + FAKE_KEY}})))
                page.click('#studioGenerate')
                expect(page.locator('#studioStatus')).to_contain_text('HTTP 401')
                expect(page.locator('#studioGenerate')).to_be_enabled()
                assert FAKE_KEY not in page.inner_text('#studioStatus')
                expect(page.locator('#studioHistory .studio-history-card')).to_have_count(1)
            case('mock API generation, persistent history, recoverable failure and memory-only credentials', credentials_and_generation, http=True)

            def cancel_generation(page, context, remote_images):
                pending = []
                context.route(API_ORIGIN + '/**', lambda route: pending.append(route))
                configure_openai(page)
                page.fill('#studioPrompt', 'cancel pending mock request')
                page.click('#studioGenerate')
                expect(page.locator('#studioGenerate')).to_be_disabled()
                expect(page.locator('#studioStop')).to_be_visible()
                page.click('#studioStop')
                expect(page.locator('#studioGenerate')).to_be_enabled()
                expect(page.locator('#studioStatus')).to_contain_text('已停止等待')
                expect(page.locator('#studioHistory .studio-history-card')).to_have_count(0)
                for route in pending:
                    route.abort()
            case('pending generation can be stopped without creating successful history', cancel_generation, http=True)

            def comfy_workflow_resume(page, context, remote_images):
                submitted = []
                uploads = []
                history_calls = []
                ready = {'complete': False}
                prompt_id = 'workbench-mock-comfy-task'

                def comfy_route(route):
                    path = urlsplit(route.request.url).path
                    headers = {'Access-Control-Allow-Origin': '*'}
                    if path == '/system_stats':
                        response = {'system': {'os': 'mock'}, 'devices': [{'name': 'Mock GPU'}]}
                    elif path == '/upload/image':
                        uploads.append(route.request)
                        response = {'name': f'uploaded-{len(uploads)}.png', 'subfolder': '', 'type': 'input'}
                    elif path == '/prompt':
                        submitted.append(route.request.post_data_json)
                        response = {'prompt_id': prompt_id}
                    elif path == '/history/' + prompt_id:
                        history_calls.append(route.request.url)
                        response = {prompt_id: {'outputs': {'9': {'images': [{'filename': 'result.png', 'subfolder': '', 'type': 'output'}]}},
                                                'status': {'completed': True, 'status_str': 'success'}}} if ready['complete'] else {}
                    elif path == '/view':
                        route.fulfill(status=200, content_type='image/png', body=PNG, headers=headers)
                        return
                    else:
                        route.fulfill(status=404, content_type='application/json', body='{}', headers=headers)
                        return
                    route.fulfill(status=200, content_type='application/json', body=json.dumps(response), headers=headers)

                context.route(API_ORIGIN + '/**', comfy_route)
                navigate(page, 'settings')
                page.select_option('#studioProvider', 'comfyui')
                page.fill('#studioBaseUrl', API_ORIGIN)
                page.click('#studioTestConnection')
                expect(page.locator('#studioStatus')).to_contain_text('已连接 ComfyUI')
                template = download_text(page, lambda: page.click('#studioWorkflowTemplate'))
                workflow = json.loads(template)
                workflow['1']['inputs']['ckpt_name'] = 'test-model.safetensors'
                page.set_input_files('#studioWorkflowInput', upload('mock-workflow.api.json', json.dumps(workflow).encode(), 'application/json'))
                expect(page.locator('#studioStatus')).to_contain_text('工作流已载入')
                navigate(page, 'studio')
                page.set_input_files('[data-upload-slot="pose"]', upload('pose-reference.png'))
                expect(page.locator('#studioSlots [data-slot="pose"] img')).to_have_count(1)
                page.fill('#studioPrompt', 'UI template workflow regression 632')
                page.click('#studioGenerate')
                expect(page.locator('#studioStatus')).to_contain_text('等待 ComfyUI 完成')
                assert len(submitted) == 1 and len(uploads) == 2
                mapped = submitted[0]['prompt']
                assert mapped['2']['inputs']['text'] == 'UI template workflow regression 632'
                assert mapped['4']['inputs']['image'] == 'uploaded-2.png'
                assert '{{' not in json.dumps(mapped)
                page.click('#studioStop')
                expect(page.locator('#studioStatus')).to_contain_text('已停止等待')
                expect(page.locator('#studioResume')).to_be_visible()
                stored = persisted_studio(page)
                assert any(isinstance(entry, dict) and entry.get('promptId') == prompt_id for entry in stored['state'])
                page.reload(wait_until='load')
                expect(page.locator('#studioResume')).to_be_visible()
                ready['complete'] = True
                page.click('#studioResume')
                expect(page.locator('#studioResults img')).to_have_count(1)
                expect(page.locator('#studioHistory .studio-history-card')).to_have_count(1)
                expect(page.locator('#studioStatus')).to_contain_text('生成完成')
                expect(page.locator('#studioResume')).to_have_count(0)
                assert len(submitted) == 1, 'resuming a task submits a second ComfyUI generation'
                assert len(history_calls) >= 2
                stored = persisted_studio(page)
                assert stored['history'][0]['images'][0]['dataUrl'].startswith('data:image/png;base64,')
                assert not any(isinstance(entry, dict) and entry.get('promptId') == prompt_id for entry in stored['state'])
            case('ComfyUI template import, upload, submission and persisted HTTP polling resume', comfy_workflow_resume, http=True)

            def mobile_layout(page, context, remote_images):
                for workspace in ('costumes', 'portraits', 'studio', 'settings', 'poses'):
                    navigate(page, workspace)
                    assert_no_horizontal_overflow(page)
                    expect(page.locator(f'#referenceNav [data-workspace="{workspace}"]')).to_have_attribute('aria-current', 'page')
            case('all workspace navigation remains accessible without mobile overflow', mobile_layout, mobile=True)

            def repository_prefix(page, context, remote_images):
                for workspace in ('costumes', 'portraits', 'studio', 'settings'):
                    navigate(page, workspace)
                    page.reload(wait_until='load')
                    expect(page.locator('#app')).to_have_attribute('data-workspace', workspace)
                    assert urlsplit(page.url).path == PREFIX + '/'
                navigate(page, 'poses')
                page.locator('#grid .card').first.click()
                page.wait_for_function("() => document.querySelector('#fullImage').naturalWidth === 900")
                assert PREFIX + '/assets/images/' in page.locator('#fullImage').get_attribute('src') or page.evaluate(
                    "document.querySelector('#fullImage').src.includes('/ai-pose-gallery-offline-zh/assets/images/')")
            case('repository-prefixed HTTP routes reload and retain local asset paths', repository_prefix, http=True)

            browser.close()
    finally:
        server.shutdown()
        server.server_close()

    for name, message in failures:
        print('ISSUE', name, '—', message)
    print(f'{len(cases) - len(failures)}/{len(cases)} workbench cases passed')
    return bool(failures)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(run())
