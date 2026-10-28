"""Regression cases from an independent review of combined user actions."""
from pathlib import Path
import json
import sys
import os
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
URL=(ROOT/'index.html').as_uri()
KEY='pose_index_v2'
FRONT='full_sexy_P001_front'
POSE='full_sexy_P001'


def run():
    failures=[]
    cases=[]
    with sync_playwright() as pw:
        channel=os.environ.get('POSE_BROWSER_CHANNEL','msedge')
        browser=pw.chromium.launch(headless=True,**({'channel':channel} if channel!='chromium' else {}))

        def case(name, fn, seed=None, mobile=False):
            cases.append(name)
            context=browser.new_context(viewport={'width':390 if mobile else 1280,'height':844 if mobile else 900},has_touch=mobile,is_mobile=mobile)
            if seed is not None:
                context.add_init_script(f"localStorage.setItem('{KEY}',{json.dumps(json.dumps(seed))})")
            page=context.new_page()
            try:
                page.goto(URL,wait_until='load')
                fn(page, context)
                print('PASS',name,flush=True)
            except Exception as ex:
                failures.append((name,(str(ex).splitlines() or [type(ex).__name__])[0]))
                print('FAIL',name,failures[-1][1],flush=True)
            finally:
                context.close()

        def reset_pending(p,c):
            p.fill('#search','站姿')
            p.click('#resetBtn')
            p.wait_for_timeout(220)
            assert p.input_value('#search')=='', 'delayed search restores query after reset'
        case('reset cancels pending search',reset_pending)

        def scope_search(p,c):
            p.fill('#search','不存在的动作XYZ')
            p.click('[data-scope="fav"]')
            p.wait_for_timeout(230)
            assert p.locator('.empty').count()==1
            assert p.input_value('#search')=='不存在的动作XYZ'
        case('navigation preserves pending search',scope_search)

        def composition(p,c):
            p.locator('#search').dispatch_event('compositionstart')
            p.locator('#search').evaluate("el=>{el.value='站';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}))}")
            p.wait_for_timeout(230)
            assert '288' in p.inner_text('#resultCount'), 'search executes during IME composition'
            p.locator('#search').dispatch_event('compositionend')
            p.wait_for_timeout(230)
            assert '288' not in p.inner_text('#resultCount')
        case('Chinese IME commits only after composition ends',composition)

        def modal_snapshot(p,c):
            p.click('[data-scope="fav"]')
            p.locator('.card').first.click()
            p.click('#favImage')
            assert p.inner_text('#viewerPosition')=='1 / 1 姿势', 'removing current favourite corrupts modal navigation'
            p.click('#closeViewer')
            assert p.locator('.empty').count()==1
        case('modal navigation remains stable when unfavouriting',modal_snapshot,{'favImages':[FRONT]})

        def focus(p,c):
            p.locator('.card').first.focus()
            p.keyboard.press('Enter')
            p.click('#closeViewer')
            assert p.evaluate("!!document.activeElement.closest('#grid')"), 'focus returns to a detached card'
        case('closing viewer restores keyboard focus',focus)

        def pose_heart(p,c):
            b=p.locator('.card .fav-mark').first
            assert b.get_attribute('aria-pressed')=='false'
            assert b.inner_text()=='♡', 'single-image favourite incorrectly fills pose favourite control'
        case('pose favourite state differs from image favourite',pose_heart,{'favImages':[FRONT]})

        def image_heart(p,c):
            p.click('[data-mode="single"]')
            b=p.locator('.card .fav-mark').first
            assert b.get_attribute('aria-pressed')=='false'
            assert b.inner_text()=='♡', 'pose favourite incorrectly fills independent image favourite control'
        case('image favourite state differs from pose favourite',image_heart,{'favPoses':[POSE]})

        def selection(p,c):
            p.select_option('#angle','侧面')
            p.locator('.card-check').first.check()
            assert p.inner_text('#selectionCount')=='已选 1 张图片', 'filtered group selection includes hidden angles'
            p.click('#selectVisible')
            assert p.locator('.card-check:not(:checked)').count()==0, 'select-visible state differs from checkboxes'
        case('bulk selection follows visible filter matches',selection)

        def comparison_selection(p,c):
            p.click('[data-mode="compare"]')
            assert p.locator('.compare-group input[type=checkbox]').count()>0, 'comparison view cannot start bulk selection'
        case('comparison view supports bulk selection',comparison_selection)

        def large_collections(p,c):
            value=json.loads(p.evaluate(f"localStorage.getItem('{KEY}')"))
            assert len(value['collections'])==101, 'stored collections silently truncated to 100'
        case('collection persistence does not silently discard data',large_collections,{'collections':[{'id':f'c{i}','name':f'集合{i}','items':[FRONT]} for i in range(101)]})

        def tabs(p,c):
            other=c.new_page();other.goto(URL,wait_until='load')
            p.locator('.card .fav-mark').first.click()
            other.wait_for_timeout(180)
            other.click('#themeBtn')
            store=json.loads(other.evaluate(f"localStorage.getItem('{KEY}')"))
            assert POSE in store['favPoses'], 'stale second tab overwrites favourite when saving view'
        case('second tab does not overwrite newly saved favourites',tabs)

        def button_space(p,c):
            p.locator('.card').first.click()
            p.locator('#favPose').focus()
            p.keyboard.press('Space')
            assert p.get_attribute('#favPose','aria-pressed')=='true'
        case('Space activates focused viewer buttons',button_space)

        def actual_size(p,c):
            p.set_viewport_size({'width':740,'height':360})
            p.locator('.card').first.click()
            p.wait_for_function("() => document.querySelector('#fullImage').naturalWidth===900")
            p.locator('#viewer').evaluate('el=>el.focus()')
            p.keyboard.press('Space')
            size=p.locator('#fullImage').evaluate('''img=>{
              const ratio=img.naturalWidth/img.naturalHeight,z=Math.abs(new DOMMatrixReadOnly(getComputedStyle(img).transform).a);
              return Math.min(img.clientWidth,img.clientHeight*ratio)*z;
            }''')
            assert abs(size-900)<2, f'original pixel width is {size}, not 900'
        case('original-size zoom works in short landscape viewport',actual_size)

        def toast_layer(p,c):
            p.locator('.card').nth(4).click()
            p.click('#pinImage')
            assert p.locator('#toast').evaluate("el=>el.matches(':popover-open')"), 'feedback is hidden behind the modal top layer'
            assert '最多 4 张' in p.inner_text('#toast')
        case('viewer feedback is visible above native dialogs',toast_layer,{'board':['full_sexy_P00'+str(i)+'_front' for i in range(1,5)]})

        def partial_selection(p,c):
            p.click('[data-mode="single"]')
            p.locator('.card-check').first.check()
            p.click('[data-mode="pose"]')
            first=p.locator('.card-check').first
            assert first.evaluate('el=>el.indeterminate')
            first.check()
            assert p.inner_text('#selectionCount')=='已选 5 张图片'
            p.click('[data-mode="single"]')
            assert p.locator('.card-check:checked').count()==5
        case('partial selections remain consistent across modes',partial_selection)

        def too_many(p,c):
            raw={'format':'pose-index-backup','version':2,'collections':[{'id':f'c{i}','name':f'集合{i}','items':[]} for i in range(1001)]}
            p.set_input_files('#importInput',{'name':'backup.json','mimeType':'application/json','buffer':json.dumps(raw).encode()})
            expect(p.locator('#toast')).to_contain_text('1000')
            saved=json.loads(p.evaluate(f"localStorage.getItem('{KEY}')"))
            assert saved['favImages']==[FRONT] and not saved['collections']
        case('oversized collection import is rejected without data changes',too_many,{'favImages':[FRONT]})

        def hostile_backup(p,c):
            raw={'format':'pose-index-backup','version':2,'collections':[{'id':'cxss','name':'<img src=x onerror="window.pwned=1">','items':[FRONT,'invalid-id',FRONT]}],'notes':{POSE:'</textarea><script>window.pwned=1</script>'}}
            p.set_input_files('#importInput',{'name':'backup.json','mimeType':'application/json','buffer':json.dumps(raw).encode()})
            p.click('#dialogConfirm')
            p.locator('#collections [data-scope="cxss"]').wait_for(state='attached')
            assert p.locator('#collections img').count()==0
            assert p.evaluate('window.pwned===undefined')
            saved=json.loads(p.evaluate(f"localStorage.getItem('{KEY}')"))
            assert saved['collections'][0]['items']==[FRONT]
        case('imported collection names and notes cannot inject markup',hostile_backup)

        def invalid_view(p,c):
            assert p.locator('.card').count()==48
            assert p.get_attribute('html','data-theme')=='light'
        case('malformed numeric view settings cannot crash startup',invalid_view,{'view':{'density':{'valueOf':None,'toString':None},'shown':{},'scroll':[]}})

        def restore(p,c):
            p.click('#loadMore')
            p.evaluate('window.scrollTo(0,1800)')
            p.wait_for_timeout(230)
            p.reload(wait_until='load')
            p.wait_for_function('() => window.scrollY>1000')
            assert p.locator('.card').count()==96
        case('reload restores both loaded batches and scroll position',restore)

        def hover_labels(p,c):
            first=p.locator('.card').first
            first.locator('.angle-mini').nth(1).hover()
            assert '俯视' in first.get_attribute('aria-label')
            assert '俯视' in first.locator('.card-image>img').get_attribute('alt')
        case('hover preview updates accessible angle labels',hover_labels)

        def nav_focus(p,c):
            p.locator('#series [data-line]').nth(1).focus()
            p.keyboard.press('Enter')
            assert p.evaluate("document.activeElement.matches('#series [data-line]')"), 'series navigation discards focused button'
            assert p.evaluate("document.activeElement.getAttribute('aria-pressed')==='true'")
        case('sidebar updates preserve keyboard focus and selected state',nav_focus)

        def swipe(p,c):
            p.locator('.card').first.click()
            previous=p.inner_text('#viewerNumber')
            r=p.locator('#stage').bounding_box();x=r['x']+r['width']*.75;y=r['y']+r['height']*.45
            session=c.new_cdp_session(p)
            session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y,'id':0}]})
            session.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x-r['width']*.5,'y':y,'id':0}]})
            session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
            assert p.inner_text('#viewerNumber')!=previous
        case('native touch swipe changes view angle',swipe,mobile=True)

        def pinch(p,c):
            p.locator('.card').first.click()
            p.wait_for_function("() => document.querySelector('#fullImage').naturalWidth===900")
            r=p.locator('#stage').bounding_box();x=r['x']+r['width']/2;y=r['y']+r['height']*.45
            session=c.new_cdp_session(p)
            session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x-30,'y':y,'id':0},{'x':x+30,'y':y,'id':1}]})
            session.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x-90,'y':y,'id':0},{'x':x+90,'y':y,'id':1}]})
            session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
            assert p.locator('#stage.zoomed').count()==1
            p.click('#fitImage')
            assert p.locator('#stage.zoomed').count()==0
        case('native two-finger pinch zooms and resets',pinch,mobile=True)

        def enter_confirm(p,c):
            p.click('#newCollection')
            p.fill('#dialogValue','键盘创建')
            p.keyboard.press('Enter')
            expect(p.locator('#collections [data-scope]').filter(has_text='键盘创建')).to_have_count(1)
        case('Enter confirms a collection name instead of cancelling',enter_confirm)

        def cancel_dialog(p,c):
            p.click('#newCollection')
            p.fill('#dialogValue','不应保存')
            p.click('#dialogCancel')
            assert p.locator('#smallDialog').evaluate('el=>!el.open')
            assert not p.locator('#collections [data-scope]').count()
        case('cancel closes the dialog without saving data',cancel_dialog)

        def help_import(p,c):
            raw={'format':'pose-index-backup','version':2,'collections':[{'id':'cmobile','name':'帮助导入','items':[FRONT]}]}
            p.click('#helpBtn')
            p.set_input_files('#helpImport',{'name':'backup.json','mimeType':'application/json','buffer':json.dumps(raw).encode()})
            expect(p.locator('#dialogTitle')).to_have_text('合并个人资料')
            p.click('#dialogConfirm')
            expect(p.locator('#collections [data-scope="cmobile"]')).to_have_count(1)
        case('help import waits for old dialog before showing confirmation',help_import,mobile=True)

        def track_drag(p):
            p.locator('.card').first.click()
            p.wait_for_function("() => document.querySelector('#fullImage').naturalWidth===900")
            p.locator('#fullImage').evaluate("el=>{window.dragResult=null;el.addEventListener('dragstart',e=>window.dragResult={cancelled:e.defaultPrevented,types:[...e.dataTransfer.types],url:e.dataTransfer.getData('text/uri-list'),download:e.dataTransfer.getData('DownloadURL')})}")

        def drag_image(p,alt=False):
            r=p.locator('#fullImage').bounding_box();x=r['x']+r['width']/2;y=r['y']+r['height']/2
            if alt:p.keyboard.down('Alt')
            p.mouse.move(x,y);p.mouse.down();p.mouse.move(x+100,y+60,steps=12);p.mouse.up()
            if alt:p.keyboard.up('Alt')
            return p.evaluate('window.dragResult')

        def native_drag(p,c):
            track_drag(p)
            result=drag_image(p)
            assert result and not result['cancelled'], 'native image drag did not start'
            assert 'downloadurl' in [t.lower() for t in result['types']] and 'text/uri-list' in result['types'], result
            # File delivery is checked over HTTP with actual native input in test_publish.
            assert result['download'].startswith('image/png:'), result
            assert '/assets/images/' in result['url'] and result['url'].endswith('.png'), result
        case('fit image exports full-resolution native drag data',native_drag)

        def native_pan(p,c):
            track_drag(p);p.click('#zoomIn');p.click('#zoomIn')
            result=drag_image(p)
            assert not result or result['cancelled'], 'zoomed pan incorrectly exports a file'
            transform=p.locator('#fullImage').evaluate('el=>{const m=new DOMMatrixReadOnly(getComputedStyle(el).transform);return {x:m.e,y:m.f}}')
            assert abs(transform['y'])>1, transform
        case('zoomed image drag still pans instead of exporting',native_pan)

        def native_alt_drag(p,c):
            track_drag(p);p.click('#zoomIn')
            result=drag_image(p,alt=True)
            assert result and not result['cancelled'] and '/assets/images/' in result['url']
        case('Alt drag exports original image while zoomed',native_alt_drag)

        browser.close()
    for name,message in failures:
        print('ISSUE:',name,'—',message)
    print(f'{len(cases)-len(failures)}/{len(cases)} review cases passed')
    return bool(failures)


if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(run())
