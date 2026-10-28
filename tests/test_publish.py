"""Check the exact staged website over HTTP, including a repository URL prefix."""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import threading
import sys
import os
import json
import hashlib
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]


class Server(ThreadingHTTPServer):
    request_queue_size=128


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
    server=Server(('127.0.0.1',0),partial(Handler,directory=str(ROOT/'dist')))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    failures=[]
    try:
        with sync_playwright() as pw:
            channel=os.environ.get('POSE_BROWSER_CHANNEL','msedge')
            browser=pw.chromium.launch(headless=True,**({'channel':channel} if channel!='chromium' else {}))
            page=browser.new_page(viewport={'width':1440,'height':1000})
            page.on('pageerror',lambda e: failures.append(str(e)))
            page.on('response',lambda r: failures.append(f'{r.status}: {r.url}') if r.status>=400 else None)
            url=f'http://127.0.0.1:{server.server_port}/ai-pose-gallery-offline-zh/'
            page.goto(url,wait_until='load')
            page.wait_for_function("() => [...document.querySelectorAll('.card-image>img')].slice(0,4).every(i=>i.complete&&i.naturalWidth===300)")
            assert page.locator('.card').count()==48
            assert page.locator('.source-link').inner_text().startswith('素材原站')
            data=json.loads(page.locator('#poseData').text_content())
            assert all(d['full'].startswith('assets/images/') and not d['full'].startswith('http') for d in data)
            page.locator('.card').first.click()
            page.wait_for_function("() => document.querySelector('#fullImage').naturalWidth===900")
            assert page.locator('#downloadImage').get_attribute('download').endswith('.png')
            page.locator('#viewer').evaluate('''el=>{
              const zone=document.createElement('div');zone.id='file-drop-test';
              zone.style.cssText='position:absolute;right:20px;top:180px;width:220px;height:160px;background:lightblue;z-index:100';
              zone.addEventListener('dragover',e=>e.preventDefault());
              zone.addEventListener('drop',async e=>{
                e.preventDefault();const files=[...e.dataTransfer.files],file=files[0];
                if(!file){window.dropResult={error:'No file payload'};return;}
                const image=await createImageBitmap(file);
                const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
                const hash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
                window.dropResult={count:files.length,name:file.name,type:file.type,size:file.size,width:image.width,height:image.height,hash};image.close();
              });el.append(zone);
            }''')
            image=page.locator('#fullImage').bounding_box();zone=page.locator('#file-drop-test').bounding_box()
            x=image['x']+image['width']/2;y=image['y']+image['height']/2
            # Playwright's intercepted drag replay loses in-memory File items.
            # Use actual Chromium mouse input, without serializing the payload.
            session=page.context.new_cdp_session(page)
            session.send('Input.setInterceptDrags',{'enabled':False})
            tx,ty=zone['x']+100,zone['y']+80
            session.send('Input.dispatchMouseEvent',{'type':'mouseMoved','x':x,'y':y,'buttons':0})
            session.send('Input.dispatchMouseEvent',{'type':'mousePressed','x':x,'y':y,'button':'left','buttons':1,'clickCount':1})
            for i in range(1,21):
                session.send('Input.dispatchMouseEvent',{'type':'mouseMoved','x':x+(tx-x)*i/20,'y':y+(ty-y)*i/20,'button':'left','buttons':1})
            session.send('Input.dispatchMouseEvent',{'type':'mouseMoved','x':tx+2,'y':ty,'button':'left','buttons':1})
            session.send('Input.dispatchMouseEvent',{'type':'mouseReleased','x':tx+2,'y':ty,'button':'left','buttons':0,'clickCount':1})
            page.wait_for_function('() => !!window.dropResult')
            drop=page.evaluate('window.dropResult')
            assert drop.get('count')==1 and drop.get('width')==900 and drop.get('height')==1200 and drop.get('size',0)>0,drop
            expected=hashlib.sha256((ROOT/'assets/images/full_sexy_P001_front.png').read_bytes()).hexdigest()
            assert drop['hash']==expected,'Dropped file differs from original bytes'
            print('PASS native webpage drop receives real 900x1200 file with exact original SHA256',drop['type'],flush=True)
            page.locator('#file-drop-test').evaluate('el=>el.remove()')
            page.click('#closeViewer')
            page.screenshot(path=str(ROOT/'tests/artifacts/published-desktop.png'))
            page.click('#themeBtn')
            page.screenshot(path=str(ROOT/'tests/artifacts/published-dark.png'))
            page.click('#themeBtn')
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
