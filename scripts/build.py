#!/usr/bin/env python
"""Build a dependency-free, file:// compatible gallery from local assets."""
import json
import os
import argparse
from pathlib import Path, PurePosixPath
from _paths import ROOT, P, G, asset_relative, validate_asset


def build(online=False, hosted=False):
    records = json.loads(Path(P('poses.json')).read_text(encoding='utf-8'))
    zh = json.loads(Path(P('translations.zh-CN.json')).read_text(encoding='utf-8'))
    prompts_path = Path(P('prompts.en.json'))
    prompts = json.loads(prompts_path.read_text(encoding='utf-8')) if prompts_path.exists() else {}
    mapping_path = Path(P('image-map.json'))
    mapping = {}
    if mapping_path.exists() and not online:
        mapping = {x['old']: x['new'] for x in json.loads(mapping_path.read_text(encoding='utf-8'))['files']}
    output = []
    seen = set()
    for item in records:
        identity = str(item.get('id', ''))
        if not identity or identity in seen:
            raise ValueError(f'Missing or duplicate image ID: {identity}')
        seen.add(identity)
        def asset(field):
            old = str(item.get(field, ''))
            if online:
                p = validate_asset(old)
                if hosted and not Path(G(*p.parts)).is_file():
                    raise FileNotFoundError(f'Missing hosted image: {old}')
                return asset_relative(old) if hosted else 'https://ai-pose-gallery.pages.dev/' + old
            rel = mapping.get(old, old)
            p = validate_asset(rel)
            if not Path(G(*p.parts)).is_file():
                raise FileNotFoundError(f'Missing image: {rel}. Restore or download it before building.')
            return asset_relative(rel)
        name = str(item.get('ポーズ名') or '')
        line = str(item.get('系統') or '')
        cat = str(item.get('分類') or '').strip()
        angle = str(item.get('アングル') or '')
        output.append(dict(id=identity, pose=identity.rsplit('_', 1)[0], num=str(item.get('ポーズ番号') or ''),
                           name=zh['poses'].get(name, name) or '未命名姿势', ja=name,
                           line=zh['lines'].get(line, line) or '未分类', cat=zh['cats'].get(cat, cat),
                           angle=zh['angs'].get(angle, angle), thumb=asset('サムネ'), full=asset('原寸')))
    source = Path(ROOT) / 'src'
    html = (source / 'shell.html').read_text(encoding='utf-8')
    payload = json.dumps(output, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    html = html.replace('/*__STYLE__*/', (source / 'style.css').read_text(encoding='utf-8'), 1)
    html = html.replace('/*__APP__*/', (source / 'app.js').read_text(encoding='utf-8'), 1)
    prompt_payload = json.dumps(prompts, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    html = html.replace('/*__PROMPTS__*/', prompt_payload, 1)
    html = html.replace('/*__DATA__*/', payload, 1).replace('__GALLERY_MODE__', 'hosted' if hosted else 'online' if online else 'offline', 1)
    if online and not hosted:
        html = html.replace("img-src 'self' data: blob: file:", "img-src 'self' data: blob: https://ai-pose-gallery.pages.dev")
    dst = Path(ROOT) / 'dist' / 'index.html' if online else Path(G('gallery.html'))
    dst.parent.mkdir(parents=True, exist_ok=True)
    temp = dst.with_suffix('.html.tmp')
    temp.write_text(html, encoding='utf-8')
    os.replace(temp, dst)
    print(f'Built {dst}: {len(output)} images / {len({x["pose"] for x in output})} poses / {len(prompts)} prompts')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--online', action='store_true', help='Images load directly from the original author')
    modes.add_argument('--hosted', action='store_true', help='Build site using same-origin image files')
    args = parser.parse_args()
    build(online=args.online or args.hosted, hosted=args.hosted)
