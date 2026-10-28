#!/usr/bin/env python
"""Publish an allowlisted snapshot; repeat builds never retain unlisted files."""
from pathlib import Path
import shutil
import os
import json
import re
import tempfile
from _paths import ROOT, P, G, asset_relative, validate_asset


def prepare():
    root = Path(ROOT).resolve()
    output = root / 'dist'
    if output.is_symlink() or output.resolve().parent != root:
        raise ValueError('Publish output must be the project dist directory')
    index = output / 'index.html'
    html = index.read_text(encoding='utf-8')
    if 'content="hosted"' not in html:
        raise RuntimeError('Build the hosted page first: python scripts/build.py --hosted')
    catalog = json.loads(Path(P('poses.json')).read_text(encoding='utf-8'))
    paths = list(dict.fromkeys(d[k] for d in catalog for k in ('原寸', 'サムネ')))
    sources = []
    for rel in paths:
        validate_asset(rel)
        source = Path(G(rel)).resolve()
        if not source.is_relative_to(root / 'assets') or not source.is_file():
            raise ValueError(f'Invalid or missing asset: {rel}')
        sources.append((source, asset_relative(rel)))
    embedded = re.search(r'<script id="poseData" type="application/json">(.*?)</script>', html, re.S)
    if not embedded:
        raise ValueError('Compiled data is missing; rebuild the hosted page')
    records = json.loads(embedded.group(1))
    expected = {asset_relative(p) for p in paths}
    actual = {d[k] for d in records for k in ('thumb', 'full')}
    if len(records) != len(catalog) or expected != actual or {d['id'] for d in records} != {d['id'] for d in catalog}:
        raise ValueError('Compiled page and source catalog differ; rebuild the hosted page')

    # Build in a verified workspace-local temporary directory. Directory swaps
    # and recursive cleanup are restricted to this generated output only.
    with tempfile.TemporaryDirectory(prefix='.dist-', dir=root) as temporary:
        temporary = Path(temporary).resolve()
        if temporary.parent != root:
            raise ValueError('Temporary output escaped workspace')
        stage = temporary / 'new'
        stage.mkdir()
        (stage / 'index.html').write_text(html, encoding='utf-8')
        (stage / '.nojekyll').touch()
        for source, rel in sources:
            target = stage / rel
            if not target.resolve().is_relative_to(stage):
                raise ValueError(f'Publish path escaped staging: {rel}')
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.link(source, target)
            except OSError:
                shutil.copy2(source, target)
        previous = temporary / 'previous'
        os.replace(output, previous)
        try:
            os.replace(stage, output)
        except Exception:
            os.replace(previous, output)
            raise
    print(f'Staged {len(sources)} verified image assets in {output}')


if __name__ == '__main__':
    prepare()
