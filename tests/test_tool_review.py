"""Failure and repeat-build tests with generated, non-author image fixtures."""
from pathlib import Path
import tempfile
import subprocess
import shutil
import json
import sys
import unittest
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]


class ToolReview(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='pose-tool-review-')
        self.root=Path(self.temp.name)
        for name in ['scripts','data','assets/images','assets/thumbnails']:
            (self.root/name).mkdir(parents=True,exist_ok=True)
        for name in ['_paths.py','build.py','prepare_site.py','optimize_images.py','download.py']:
            shutil.copy2(ROOT/'scripts'/name,self.root/'scripts'/name)
        shutil.copytree(ROOT/'src',self.root/'src')
        Image.new('RGB',(900,1200),(210,80,30)).save(self.root/'assets/images/test_front.png')
        Image.new('RGB',(300,400),(210,80,30)).save(self.root/'assets/thumbnails/test_front.jpg')
        self.data=[{'id':'test_front','原寸':'img/test_front.png','サムネ':'thumbs/test_front.jpg','ポーズ名':'测试','系統':'测试','分類':'测试','アングル':'正面'}]
        (self.root/'data/poses.json').write_text(json.dumps(self.data),encoding='utf-8')
        (self.root/'data/translations.zh-CN.json').write_text(json.dumps({'poses':{},'lines':{},'cats':{},'angs':{}}),encoding='utf-8')

    def tearDown(self):
        self.temp.cleanup()

    def command(self,name,*args,success=True):
        result=subprocess.run([sys.executable,'-B','-X','utf8',str(self.root/'scripts'/name),*args],capture_output=True,text=True,encoding='utf-8')
        if success:self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        else:self.assertNotEqual(result.returncode,0)
        return result

    def test_failed_rebuild_does_not_change_current_images(self):
        self.command('optimize_images.py','--apply')
        mapping=(self.root/'data/image-map.json').read_bytes()
        html=(self.root/'index.html').read_bytes()
        previous={str(p.relative_to(self.root)):p.read_bytes() for p in (self.root/'assets').rglob('*.webp')}
        (self.root/'data/poses.json').write_text(json.dumps(self.data*2),encoding='utf-8')
        self.command('optimize_images.py','--apply','--gray',success=False)
        self.assertEqual(mapping,(self.root/'data/image-map.json').read_bytes())
        self.assertEqual(html,(self.root/'index.html').read_bytes())
        for rel,blob in previous.items():self.assertEqual(blob,(self.root/rel).read_bytes(),rel)

    def test_repeated_staging_removes_unlisted_files(self):
        self.command('build.py','--hosted')
        self.command('prepare_site.py')
        (self.root/'dist/private-not-for-publication.txt').write_text('must not be published')
        self.command('prepare_site.py')
        self.assertFalse((self.root/'dist/private-not-for-publication.txt').exists())
        self.assertTrue((self.root/'dist/assets/images/test_front.png').exists())

    def test_staging_rejects_non_asset_metadata(self):
        self.command('build.py','--hosted')
        (self.root/'.env').write_text('PRIVATE_TEST_VALUE=fixture')
        self.data[0]['原寸']='.env'
        (self.root/'data/poses.json').write_text(json.dumps(self.data),encoding='utf-8')
        self.command('prepare_site.py',success=False)
        self.assertFalse((self.root/'dist/.env').exists())

    def test_incomplete_hosted_build_keeps_previous_page(self):
        self.command('build.py','--hosted')
        previous=(self.root/'dist/index.html').read_bytes()
        (self.root/'assets/images/test_front.png').unlink()
        self.data[0]['ポーズ名']='changed'
        (self.root/'data/poses.json').write_text(json.dumps(self.data),encoding='utf-8')
        self.command('build.py','--hosted',success=False)
        self.assertEqual(previous,(self.root/'dist/index.html').read_bytes())

    def test_incremental_download_repairs_truncated_image(self):
        original=(self.root/'assets/images/test_front.png').read_bytes()
        (self.root/'source.png').write_bytes(original)
        (self.root/'assets/images/test_front.png').write_bytes(original[:40])
        script="from pathlib import Path;import sys;sys.path.insert(0,'scripts');import download;download.get=lambda _:Path('source.png').read_bytes();print(download.fetch('img/test_front.png')[0])"
        result=subprocess.run([sys.executable,'-B','-c',script],cwd=self.root,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(result.stdout.strip(),'ok')
        self.assertEqual((self.root/'assets/images/test_front.png').read_bytes(),original)


if __name__=='__main__':
    unittest.main(verbosity=2)
