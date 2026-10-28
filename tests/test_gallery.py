"""Isolated headless regression checks. No access to the user's browser profile."""
from pathlib import Path
import json
import sys
import tempfile
import shutil
import subprocess
import threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests' / 'artifacts'
OUT.mkdir(parents=True, exist_ok=True)


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    print('PASS', message, flush=True)


def image_fits(page):
    return page.eval_on_selector('#fullImage', '''img => {
      const r=img.getBoundingClientRect(), s=img.parentElement.getBoundingClientRect();
      return getComputedStyle(img).objectFit==='contain' && r.width>0 && r.height>0 && r.top>=s.top && r.bottom<=s.bottom+1 && r.left>=s.left && r.right<=s.right+1;
    }''')


def browser_tests():
    errors = []
    external = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='msedge', headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('request', lambda r: external.append(r.url) if r.url.startswith(('https:', 'http:')) and '127.0.0.1' not in r.url else None)
        page.goto((ROOT / 'index.html').as_uri(), wait_until='load')
        check(page.locator('.card').count() == 48, 'file:// opens with 48 pose cards')
        check('288' in page.inner_text('#resultCount') and '1,439' in page.inner_text('#resultCount'), 'dataset counts')
        page.wait_for_function("() => [...document.querySelectorAll('.card-image>img')].slice(0,4).every(i=>i.complete&&i.naturalWidth)")
        page.screenshot(path=str(OUT / 'desktop.png'))
        page.click('#loadMore')
        check(page.locator('.card').count() == 96, 'load another batch')
        page.fill('#search', 'P001 侧面')
        page.wait_for_timeout(230)
        check(page.locator('.card').count() == 4, 'multiple search tokens intersect')
        page.locator('.card').first.click()
        page.wait_for_function("() => document.querySelector('#fullImage').naturalWidth===900")
        check(image_fits(page), 'desktop full image stays inside stage')
        page.screenshot(path=str(OUT / 'viewer-desktop.png'))
        page.click('#favPose')
        check('已收藏' in page.inner_text('#favPose'), 'favourite an entire pose')
        page.click('#favImage')
        page.fill('#poseNote', '构图备注：保持肩部转向')
        page.click('#pinImage')
        check('1 / 4' in page.inner_text('#boardCount'), 'pin image to reference board')
        page.click('#mirrorImage')
        check(page.get_attribute('#mirrorImage', 'aria-pressed') == 'true', 'mirror is display-only')
        page.click('#zoomIn')
        check(page.locator('#stage.zoomed').count() == 1, 'zoom enabled')
        page.click('#fitImage')
        page.click('#addCollection')
        page.fill('#dialogValue', '构图练习')
        page.click('#dialogConfirm')
        check(page.locator('#collections button').filter(has_text='构图练习').count() == 1, 'create collection from viewer')
        page.click('#closeViewer')
        page.reload(wait_until='load')
        saved = json.loads(page.evaluate("localStorage.getItem('pose_index_v2')"))
        check(len(saved['favPoses']) == 1 and len(saved['favImages']) == 1 and len(saved['notes']) == 1, 'favourites and note survive reload')
        check(len(saved['collections']) == 1 and len(saved['collections'][0]['items']) == 1, 'collection survives reload')
        page.click('#resetBtn')
        page.click('[data-scope="fav"]')
        check('5 张图片' in page.inner_text('#resultCount'), 'pose favourite includes all five angles')
        page.click('#resetBtn')
        page.click('[data-mode="compare"]')
        check(page.locator('.compare-group').count() == 24, 'comparison batches by pose')
        check(page.locator('.compare-group').first.locator('.compare-images>*').count() == 5, 'comparison retains five angle columns')
        page.click('#resetBtn')
        page.click('[data-mode="single"]')
        check(page.locator('.card').count() == 96, 'single-image mode uses 96-card batches')
        page.locator('.card-check').first.check()
        with page.expect_download() as download:
            page.click('#selectionCsv')
        csv = Path(download.value.path()).read_text(encoding='utf-8-sig')
        check(len(csv.splitlines()) == 2 and '文件' in csv, 'selected export contains only selected image')
        with page.expect_download() as download:
            page.click('#backupBtn')
        backup = json.loads(Path(download.value.path()).read_text(encoding='utf-8'))
        check(backup['format'] == 'pose-index-backup', 'portable personal backup export')
        page.set_input_files('#importInput', {'name':'backup.json','mimeType':'application/json','buffer':json.dumps(backup).encode()})
        page.click('#dialogConfirm')
        imported = json.loads(page.evaluate("localStorage.getItem('pose_index_v2')"))
        check(len(imported['collections']) == 1 and len(imported['favPoses']) == 1, 'import merges without duplicate favourites or collection')
        page.click('#boardBtn')
        check(page.locator('.board-card').count() == 1, 'reference board displays pinned image')
        page.click('#closeBoard')
        page.click('#themeBtn')
        check(page.get_attribute('html','data-theme') == 'dark', 'dark theme')
        page.click('#themeBtn')
        page.click('#resetBtn')
        page.click('[data-mode="pose"]')
        page.fill('#search', '<img src=x onerror=alert(1)>')
        page.wait_for_timeout(220)
        check(page.locator('.empty').count() == 1 and page.locator('#activeFilters img').count() == 0, 'search input is rendered as text')
        page.click('#resetBtn')
        for width,height in [(1280,720),(1920,1080),(390,844),(360,640),(740,360)]:
            page.set_viewport_size({'width':width,'height':height})
            page.locator('.card').first.click()
            page.wait_for_function("() => document.querySelector('#fullImage').naturalWidth===900")
            check(image_fits(page), f'full image fits {width}x{height}')
            page.screenshot(path=str(OUT / f'viewer-{width}x{height}.png'))
            page.click('#closeViewer')
            check(page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'no page overflow {width}x{height}')
        page.set_viewport_size({'width':390,'height':844})
        page.screenshot(path=str(OUT / 'mobile.png'))
        page.click('#filtersToggle')
        check(page.locator('.controls.filters-open').count() == 1, 'mobile filters expand')
        page.evaluate("localStorage.setItem('pose_index_v2', '{bad json')")
        page.reload(wait_until='load')
        check(page.locator('.card').count() == 48, 'corrupt storage recovers safely')
        page.add_init_script("localStorage.removeItem('pose_index_v2');localStorage.setItem('pose_fav',JSON.stringify(['full_sexy_P001_front']))")
        page.reload(wait_until='load')
        migrated=json.loads(page.evaluate("localStorage.getItem('pose_index_v2')"))
        check(migrated['favImages'] == ['full_sexy_P001_front'], 'legacy favourites migrate')
        check(not errors, 'zero JavaScript errors: '+str(errors))
        check(not external, 'zero external network requests')
        browser.close()


def compression_tests():
    from PIL import Image
    with tempfile.TemporaryDirectory(prefix='pose-index-test-') as temp:
        root=Path(temp)
        for folder in ['scripts','data','assets/images','assets/thumbnails']:
            (root/folder).mkdir(parents=True,exist_ok=True)
        for name in ['optimize_images.py','_paths.py','build.py']:
            shutil.copy2(ROOT/'scripts'/name,root/'scripts'/name)
        shutil.copytree(ROOT/'src',root/'src')
        Image.new('RGB',(900,1200),(220,220,218)).save(root/'assets/images/test_front.png')
        Image.new('RGB',(300,400),(220,220,218)).save(root/'assets/thumbnails/test_front.jpg')
        data=[{'id':'test_front','原寸':'img/test_front.png','サムネ':'thumbs/test_front.jpg','ポーズ名':'测试','系統':'测试','分類':'测试','アングル':'正面','ポーズ番号':'P001'}]
        (root/'data/poses.json').write_text(json.dumps(data),encoding='utf-8')
        (root/'data/translations.zh-CN.json').write_text(json.dumps({'poses':{},'lines':{},'cats':{},'angs':{}}),encoding='utf-8')
        def snapshot():return {str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
        before=snapshot()
        command=[sys.executable,'-B','-X','utf8',str(root/'scripts/optimize_images.py')]
        subprocess.run(command,check=True,capture_output=True)
        check(before == snapshot(), 'compression measurement makes zero filesystem changes')
        subprocess.run(command+['--apply'],check=True,capture_output=True)
        check((root/'assets/images/test_front.png').exists() and (root/'assets/thumbnails/test_front.jpg').exists(), 'apply retains originals by default')
        mapping=json.loads((root/'data/image-map.json').read_text(encoding='utf-8'))
        check(all((root/('assets/images/'+x['new'][4:] if x['new'].startswith('img/') else 'assets/thumbnails/'+x['new'][7:])).exists() for x in mapping['files']), 'conversion mapping only references verified derivatives')
        subprocess.run(command+['--apply','--archive-originals'],check=True,capture_output=True)
        check((root/'.archive/originals/img/test_front.png').exists(), 'explicit archive runs after successful gallery build')
        subprocess.run(command+['--apply','--archive-originals'],check=True,capture_output=True)
        check(True, 'conversion can be repeated after originals are archived')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    if '--tools-only' not in sys.argv:
        browser_tests()
    compression_tests()
    print('ALL CHECKS PASSED')
