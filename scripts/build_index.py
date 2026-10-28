#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""由 poses.json + translations.zh-CN.json 生成中文化的 CSV 索引与 Markdown 目录。"""
import json, os, csv
from collections import OrderedDict, Counter

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import ROOT, DATA, GAL, DOC, TOOL, AUDIT, P, G, D, asset_relative

DATA = json.load(open(P("poses.json"), encoding="utf-8"))
META = json.load(open(P("meta.json"), encoding="utf-8"))
ZH = json.load(open(P("translations.zh-CN.json"), encoding="utf-8"))

POS_ZH, CAT_ZH, LINE_ZH, ANG_ZH = ZH["poses"], ZH["cats"], ZH["lines"], ZH["angs"]
ANG = ["正面", "上から", "下から", "横", "斜め"]
LINES = META.get("lines") or ["全身1人・セクシー系", "全身1人・標準系", "上半身1人", "2人絡み"]


def _s(d, k):
    v = d.get(k)
    return v if isinstance(v, str) else ("" if v is None else str(v))


def zh_pose(d):
    n = _s(d, "ポーズ名")
    return POS_ZH.get(n, n)


def zh_cat(d):
    k = _s(d, "分類").strip()
    return CAT_ZH.get(k, k)


def zh_line(d):
    k = _s(d, "系統")
    return LINE_ZH.get(k, k)


def zh_ang(d):
    k = _s(d, "アングル")
    return ANG_ZH.get(k, k)


# ---------- CSV（中文列在前，日文原名附后） ----------
cols = ["id", "系列", "编号", "分类", "姿势名", "视角", "文件", "原名（日）"]
with open(P("index.csv"), "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f)
    w.writerow(cols)
    for d in DATA:
        w.writerow([d.get("id", ""), zh_line(d), _s(d, "ポーズ番号"), zh_cat(d), zh_pose(d),
                    zh_ang(d), asset_relative(_s(d, "原寸")), _s(d, "ポーズ名")])

# ---------- 分组 ----------
groups = OrderedDict()
for d in DATA:
    groups.setdefault(d["系統"], OrderedDict()).setdefault(
        (d.get("ポーズ番号") or d["id"], d.get("ポーズ名", "")), []).append(d)


def line_order(l):
    return LINES.index(l) if l in LINES else 99


md = ["# 姿势库 POSE-DB-01 目录（中译）\n"]
md.append("- 原始站点：https://ai-pose-gallery.pages.dev/")
md.append(f"- 总计：{len(DATA)} 图 / {sum(len(v) for v in groups.values())} 个姿势")
cnt = Counter(d["系統"] for d in DATA)
for l in sorted(groups, key=line_order):
    md.append(f"  - {LINE_ZH.get(l, l)}（{l}）：{cnt[l]} 图 / {len(groups[l])} 姿势")
md.append("")
md.append("## 分类统计\n")
cc = Counter(zh_cat(d) for d in DATA)
for k, v in cc.most_common():
    md.append(f"- {k or '（未分类）'}：{v} 图")
md.append("")

for l in sorted(groups, key=line_order):
    md.append(f"\n## {LINE_ZH.get(l, l)}\n")
    md.append("| 编号 | 姿势名（中） | 原名（日） | 分类 | 视角 | 文件（原图） |")
    md.append("|---|---|---|---|---|---|")
    for (num, name), items in groups[l].items():
        angs = [ANG_ZH.get(i["アングル"], i["アングル"]) for i in items if i.get("アングル")]
        angs = [a for a in ["正面", "俯视", "仰视", "侧面", "斜视"] if a in angs]
        files = "<br>".join(i["原寸"].split("/")[-1] for i in
                            sorted(items, key=lambda x: ANG.index(x["アングル"]) if x.get("アングル") in ANG else 9))
        md.append(f"| {num} | {POS_ZH.get(name, name)} | {name} | {CAT_ZH.get((items[0].get('分類') or '').strip(), '')} "
                  f"| {'・'.join(angs)} | {files} |")

open(P("index.md"), "w", encoding="utf-8").write("\n".join(md) + "\n")
print("CSV/MD 生成完成:", len(DATA), "条 /", sum(len(v) for v in groups.values()), "姿势")
