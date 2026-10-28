"""Check the exact staged website over HTTP, including a repository URL prefix."""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import threading
import sys
import json
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        prefix='/ai-pose-gallery-offline-zh'
        if self.path.startswith(prefix+'/'):
            self.path=self.path[len(prefix):]
        super().do_GET()

    def log_message(self, *args):
        pass


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(ROOT/'dist')))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    failures=[]
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(channel='msedge',headless=True)
            page=browser.new_page(viewport={'width':1440,'height':1000})
            page.on('pageerror',lambda e: failures.append(str(e)))
            page.on('response',lambda r: failures.append(f'{r.status}: {r.url}') if r.status>=400 else None)
            url=f'http://127.0.0.1:{server.server_port}/ai-pose-gallery-offline-zh/'
            page.goto(url,wait_until='load')
            page.wait_for_function("() => [...document.querySelectorAll('.card-image>img')].slice(0,4).every(i=>i.complete&&i.naturalWidth===300)")
            assert page.locator('.card').count()==48
            assert page.locator('.source-link').inner_text().startswith('原作：ギア')
            data=json.loads(page.locator('#poseData').text_content())
            assert all(d['full'].startswith('assets/images/') and not d['full'].startswith('http') for d in data)
            page.locator('.card').first.click()
            page.wait_for_function("() => document.querySelector('#fullImage').naturalWidth===900")
            assert page.locator('#downloadImage').get_attribute('download').endswith('.png')
            page.click('#closeViewer')
            page.screenshot(path=str(ROOT/'tests/artifacts/published-desktop.png'))
            page.set_viewport_size({'width':390,'height':844})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            assert page.locator('.source-link').is_visible()
            page.screenshot(path=str(ROOT/'tests/artifacts/published-mobile.png'))
            assert not failures, failures
            browser.close()
            print('PASS staged HTTP site: prefix URLs, same-origin assets, original download, attribution, mobile layout; zero errors')
    finally:
        server.shutdown()
        server.server_close()


if __name__=='__main__':
    main()
