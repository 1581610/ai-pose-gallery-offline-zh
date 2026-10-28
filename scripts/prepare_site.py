#!/usr/bin/env python
"""Stage only the public gallery and its image assets for GitHub Pages."""
from pathlib import Path
import shutil
import os
import json
from _paths import ROOT, P, G, asset_relative


def prepare():
    root = Path(ROOT)
    output = root / 'dist'
    output.mkdir(exist_ok=True)
    index = root / 'dist' / 'index.html'
    if not index.is_file() or 'content="hosted"' not in index.read_text(encoding='utf-8'):
        raise RuntimeError('Build the hosted page first: python scripts/build.py --hosted')
    (output / '.nojekyll').touch()
    count = 0
    for d in json.loads(Path(P('poses.json')).read_text(encoding='utf-8')):
        for k in ('原寸', 'サムネ'):
            rel = d[k]
            source = Path(G(rel)).resolve()
            if not source.is_relative_to(Path(G()).resolve()) or not source.is_file():
                raise ValueError(f'Invalid or missing asset: {rel}')
            target = output / asset_relative(rel)
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                if os.path.samefile(source, target):
                    count += 1
                    continue
                target.unlink()
            try:
                os.link(source, target)
            except OSError:
                shutil.copy2(source, target)
            count += 1
    print(f'Staged {count} image assets in {output}')


if __name__ == '__main__':
    prepare()
