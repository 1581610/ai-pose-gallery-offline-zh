#!/usr/bin/env python
"""Download original-author assets for local use. Nothing is redistributed by Git."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
from pathlib import Path, PurePosixPath
import re
import time
import urllib.request
import struct
import zlib
from _paths import P, G

BASE = 'https://ai-pose-gallery.pages.dev/'
HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; PoseIndexLocal/2.0)', 'Referer': BASE}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=90) as response:
        blob = response.read()
        expected = response.headers.get('Content-Length')
        if expected and len(blob) != int(expected):
            raise ValueError('Incomplete response')
        return blob


def safe_path(rel):
    p = PurePosixPath(rel)
    if p.is_absolute() or '..' in p.parts or not p.parts or p.parts[0] not in ('img', 'thumbs') or ':' in rel or '\\' in rel:
        raise ValueError(f'Unsafe source path: {rel}')
    return p


def valid(blob, rel):
    if rel.endswith('.jpg'):
        return len(blob)>100 and blob.startswith(b'\xff\xd8\xff') and blob.endswith(b'\xff\xd9')
    if not rel.endswith('.png') or not blob.startswith(b'\x89PNG\r\n\x1a\n'):
        return False
    offset=8
    has_header=has_pixels=False
    while offset+12<=len(blob):
        length=struct.unpack('>I',blob[offset:offset+4])[0]
        end=offset+12+length
        if end>len(blob):
            return False
        kind=blob[offset+4:offset+8]
        payload=blob[offset+8:offset+8+length]
        crc=struct.unpack('>I',blob[end-4:end])[0]
        if zlib.crc32(kind+payload)&0xffffffff!=crc:
            return False
        if not has_header:
            if kind!=b'IHDR' or length!=13:
                return False
            has_header=True
        if kind==b'IDAT':
            has_pixels=True
        if kind==b'IEND':
            return has_header and has_pixels and length==0 and end==len(blob)
        offset=end
    return False


def bootstrap(source=None):
    path = Path(P('poses.json'))
    if path.exists():
        return json.loads(path.read_text(encoding='utf-8'))
    html = Path(source).read_text(encoding='utf-8') if source else get(BASE).decode('utf-8')
    match = re.search(r'const\s+D\s*=\s*(\[.*?\])\s*;', html, re.S)
    if not match:
        raise ValueError('Original site data layout changed. No files were written.')
    data = json.loads(match.group(1))
    if not isinstance(data, list) or not data:
        raise ValueError('Empty original metadata')
    ids = set()
    for d in data:
        if not isinstance(d, dict) or not isinstance(d.get('id'), str) or d['id'] in ids:
            raise ValueError('Invalid or duplicate record')
        ids.add(d['id'])
        for k in ('原寸', 'サムネ'):
            safe_path(d[k])
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.json.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
    os.replace(temp, path)
    meta = {'lines': list(dict.fromkeys(d.get('系統', '') for d in data))}
    Path(P('meta.json')).write_text(json.dumps(meta, ensure_ascii=False), encoding='utf-8')
    return data


def fetch(rel):
    safe_path(rel)
    dst = Path(G(rel))
    if dst.is_file() and valid(dst.read_bytes(), rel):
        return 'skip', rel
    archive = Path(G('归档', '原图', rel))
    if archive.is_file() and valid(archive.read_bytes(), rel):
        blob = archive.read_bytes()
    else:
        for attempt in range(4):
            try:
                blob = get(BASE + rel)
                if not valid(blob, rel):
                    raise ValueError('Not a valid image response')
                break
            except Exception as ex:
                if attempt == 3:
                    return 'fail', f'{rel}: {ex}'
                time.sleep(min(2 ** attempt, 5))
    dst.parent.mkdir(parents=True, exist_ok=True)
    temp = dst.with_suffix(dst.suffix + '.part')
    temp.write_bytes(blob)
    os.replace(temp, dst)
    return 'ok', rel


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['all', 'img', 'thumbs', 'data'], nargs='?', default='all')
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--source-html', help='Use a locally saved original-author HTML page to bootstrap metadata')
    args = parser.parse_args()
    if not 1 <= args.workers <= 32:
        parser.error('workers must be between 1 and 32')
    data = bootstrap(args.source_html)
    if args.mode == 'data':
        print(f'{len(data)} local metadata records ready')
        return
    paths = list(dict.fromkeys(d[k] for d in data for k in ('原寸', 'サムネ')))
    for rel in paths:
        safe_path(rel)
    if args.mode != 'all':
        paths = [p for p in paths if p.startswith(args.mode + '/')]
    counts = {'skip': 0, 'ok': 0, 'fail': 0}
    failures = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(fetch, p) for p in paths]
        for i, future in enumerate(as_completed(futures), 1):
            status, message = future.result()
            counts[status] += 1
            if status == 'fail':
                failures.append(message)
            if i % 100 == 0 or i == len(paths):
                print(f'{i}/{len(paths)} {counts}', flush=True)
    if failures:
        Path(P('failures.txt')).write_text('\n'.join(failures), encoding='utf-8')
        raise SystemExit('Some downloads failed; rerun to resume. See 数据/failures.txt')
    print('Local download complete. Run python scripts/build.py')


if __name__ == '__main__':
    main()
