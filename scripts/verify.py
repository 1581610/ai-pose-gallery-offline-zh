#!/usr/bin/env python
"""Verify every effective image reference; optionally decode all files."""
import argparse
import hashlib
import json
from pathlib import Path
from _paths import P, G


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--decode', action='store_true')
    args = parser.parse_args()
    data = json.loads(Path(P('poses.json')).read_text(encoding='utf-8'))
    path = Path(P('image-map.json'))
    mapping = {x['old']: x['new'] for x in json.loads(path.read_text(encoding='utf-8'))['files']} if path.exists() else {}
    failures = []
    paths = list(dict.fromkeys(mapping.get(d[k], d[k]) for d in data for k in ('原寸', 'サムネ')))
    for rel in paths:
        try:
            p = Path(G(rel))
            head = p.read_bytes()[:16]
            valid = head.startswith(b'\x89PNG\r\n\x1a\n') or head.startswith(b'\xff\xd8\xff') or (head[:4] == b'RIFF' and head[8:12] == b'WEBP')
            if not valid:
                raise ValueError('Invalid image signature')
            if args.decode:
                from PIL import Image
                with Image.open(p) as img:
                    img.load()
                    expected = (900, 1200) if rel.startswith('img/') else (300, 400)
                    if img.size != expected:
                        raise ValueError(f'Dimensions {img.size} != {expected}')
        except Exception as ex:
            failures.append((rel, str(ex)))
    print(f'{len(paths)} image references; {len(failures)} failures')
    for item in failures[:20]:
        print(*item)
    if failures:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
