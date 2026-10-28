#!/usr/bin/env python
"""Measure WebP in memory by default; commit verified derivatives explicitly."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import random
import shutil
from PIL import Image, ImageChops
from _paths import P, G, ROOT, validate_asset


def convert(job):
    rel, mode, apply = job
    validate_asset(rel)
    source = Path(G(rel))
    if not source.exists():
        source = Path(G('归档', '原图', rel))
    if not source.exists():
        return {'old': rel, 'error': 'Source not found'}
    try:
        with Image.open(source) as im:
            image = im.convert('RGB' if mode != 'gray' else 'L')
            buf = io.BytesIO()
            image.save(buf, 'WEBP', lossless=mode == 'lossless', quality=100 if mode == 'lossless' else 92, method=4)
            blob = buf.getvalue()
            with Image.open(io.BytesIO(blob)) as check:
                check.load()
                if check.size != image.size:
                    raise ValueError('Dimension mismatch')
                if mode == 'lossless' and ImageChops.difference(image, check.convert('RGB')).getbbox() is not None:
                    raise ValueError('Pixel mismatch in lossless conversion')
        # Content-addressed names never overwrite a derivative still referenced
        # by the current page, including when a later build fails and rolls back.
        name = Path(rel).stem + '.' + hashlib.sha256(blob).hexdigest()[:16] + '.webp'
        result = {'old': rel, 'new': str(Path(rel).with_name(name)).replace('\\', '/'), 'before': source.stat().st_size, 'after': len(blob)}
        # Larger derivatives bring no benefit. Keep the original reference.
        result['use'] = len(blob) < result['before']
        if apply and result['use']:
            target = Path(G(result['new']))
            temp = target.with_suffix('.webp.tmp')
            temp.write_bytes(blob)
            os.replace(temp, target)
        return result
    except Exception as ex:
        return {'old': rel, 'error': str(ex)}


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--lossy', action='store_true', help='WebP quality 92; default is pixel-lossless RGB')
    parser.add_argument('--gray', action='store_true', help='Grayscale, quality 92; not pixel-lossless')
    parser.add_argument('--sample', type=int, default=20)
    parser.add_argument('--workers', type=int, default=min(8, os.cpu_count() or 2))
    parser.add_argument('--archive-originals', action='store_true', help='Archive originals ONLY after successful rebuild')
    args = parser.parse_args()
    if args.sample < 1 or args.workers < 1:
        parser.error('sample and workers must be positive')
    if args.archive_originals and not args.apply:
        parser.error('--archive-originals requires --apply')
    mode = 'gray' if args.gray else 'lossy' if args.lossy else 'lossless'
    data = json.loads(Path(P('poses.json')).read_text(encoding='utf-8'))
    paths = list(dict.fromkeys(d[k] for d in data for k in ('原寸', 'サムネ')))
    if not args.apply:
        paths = random.Random(0).sample(paths, min(args.sample * 2, len(paths)))
    print(f'{"APPLY" if args.apply else "MEASURE ONLY (memory)"}: {mode}, {len(paths)} files')
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(convert, [(p, mode, args.apply) for p in paths]))
    errors = [x for x in results if 'error' in x]
    for error in errors[:5]:
        print('FAILED', error['old'], error['error'])
    successful = [x for x in results if 'error' not in x]
    before = sum(x['before'] for x in successful)
    after = sum(min(x['after'], x['before']) for x in successful)
    print(f'{len(successful)} verified; {len(errors)} failed. Active assets: {before/1048576:.2f} -> {after/1048576:.2f} MiB')
    if not args.apply:
        print('No image or metadata files created, moved or deleted. Image disk use is unchanged.')
        return 1 if errors else 0
    if errors:
        print('Mapping unchanged; originals untouched. Successful derivatives can be reused on retry.')
        return 1
    path = Path(P('image-map.json'))
    previous = path.read_bytes() if path.exists() else None
    mapping = json.loads(previous)['files'] if previous else []
    entries = {x['old']: x for x in mapping}
    for result in successful:
        if result['use']:
            entries[result['old']] = {k: result[k] for k in ('old', 'new')}
        else:
            entries.pop(result['old'], None)
            original = Path(G(result['old']))
            if not original.exists():
                shutil.copy2(G('归档', '原图', result['old']), original)
    temp = path.with_suffix('.json.tmp')
    temp.write_text(json.dumps({'files': list(entries.values()), 'mode': mode}, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(temp, path)
    try:
        from build import build
        build()
    except Exception:
        if previous is not None:
            path.write_bytes(previous)
        else:
            path.unlink(missing_ok=True)
        raise
    if args.archive_originals:
        for old, entry in entries.items():
            src, dst = Path(G(old)), Path(G('归档', '原图', old))
            if not src.exists():
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            if dst.exists():
                if hashlib.sha256(src.read_bytes()).digest() != hashlib.sha256(dst.read_bytes()).digest():
                    raise RuntimeError(f'Archive conflict, original preserved: {old}')
                src.unlink()
            else:
                os.replace(src, dst)
    print('Gallery rebuilt. Archive keeps originals recoverable; total disk usage includes that archive.')
    return 0


if __name__ == '__main__':
    raise SystemExit(run())
