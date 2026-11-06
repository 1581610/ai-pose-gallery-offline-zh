"""Import pinned reference metadata without downloading any gallery images.

Run this script again to reproduce data/reference-catalog.json, or use --check
to validate the existing catalog without network access. New upstream revisions
must be reviewed before changing UPSTREAM_COMMIT and the expected counts.
"""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import json
import math
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "reference-catalog.json"
UPSTREAM_COMMIT = "488939139c69acfe078372b39d4bd0c457dc060e"
UPSTREAM_RAW = f"https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/{UPSTREAM_COMMIT}/data/"
SHISEI_COMMIT = "8f61ceab10e45f8d3afd254900903733a0ba76ee"
SHISEI_RAW = f"https://raw.githubusercontent.com/wquguru/shisei/{SHISEI_COMMIT}/images/costume/grey/"
MAX_METADATA_BYTES = 10 * 1024 * 1024
SENSITIVE_CATEGORIES = {"内衣・睡衣", "性感穿搭"}

SOURCES = [
    {
        "id": "gia-costume", "name": "ギア · 写实服装",
        "url": "https://ai-costume-gallery.pages.dev/",
        "license": "作者自定义素材条款",
        "note": "ギア（@giaaibusi）创作。允许逐张用于作品制作、编辑及生成参考；禁止批量下载（含自动获取）、再分发、转载或转售图片。禁止用于实在人物、未成年人或违反公序良俗的用途。本目录按需加载原站图片。",
    },
    {
        "id": "gia-anime", "name": "ギア · 动漫服装",
        "url": "https://ai-costume-anime-gallery.pages.dev/",
        "license": "作者自定义素材条款",
        "note": "ギア（@giaaibusi）创作。图片仅供按需参考，使用须遵守原站说明；禁止批量下载、再分发、转载或转售图片，禁止用于实在人物或未成年人用途。本目录仅保存中文元数据。",
    },
    {
        "id": "charadb", "name": "たき AI · CharaDB",
        "url": "https://charadb-2fi.pages.dev/",
        "license": "标签表 CC0 1.0；图片适用独立条款",
        "note": "たき AI（@taki_auto）创作。图片仅供参考，禁止再分发、转载、转售以及用于描绘实在人物或未成年人；生成模型条款同时适用。许可见 https://github.com/taki-ttt/charadb/blob/main/LICENSE 。图片从原站按需加载。",
    },
    {
        "id": "shisei", "name": "Shisei · 中国历代服装",
        "url": "https://github.com/wquguru/shisei",
        "license": "CC0 1.0",
        "note": f"wquguru 的 AI 生成服装参考，专业历史服饰考据请另行核实。图片固定到 {SHISEI_COMMIT}，许可见 https://github.com/wquguru/shisei/blob/{SHISEI_COMMIT}/LICENSE-images 。本目录按需加载来源图片。",
    },
    {
        "id": "gia-portrait", "name": "ギア · 人像与发型",
        "url": "https://ai-portrait-gallery.pages.dev/",
        "license": "CC0 1.0",
        "note": "ギア（@giaaibusi）的 AI 生成角色参考。原站标注 CC0，另请求避免图片数据本身的再分发或转载；本目录按需加载原站图片。",
    },
]
SOURCE_MAP = {source["id"]: source for source in SOURCES}
DATASETS = {
    "costume-zh.json": ("gia-costume", 1407),
    "costume-gia-anime-zh.json": ("gia-anime", 1320),
    "costume-anime-zh.json": ("charadb", 440),
    "costume-shisei-zh.json": ("shisei", 57),
    "portrait-zh.json": ("gia-portrait", 1499),
    "portrait.json": (None, 1499),
}


def fetch_metadata(filename, timeout=30):
    """Fetch only a known JSON snapshot, with bounded response size and timeout."""
    if filename not in DATASETS:
        raise ValueError(f"Unknown metadata file: {filename}")
    request = Request(UPSTREAM_RAW + filename, headers={"User-Agent": "PoseIndex-MetadataImporter/1"})
    with urlopen(request, timeout=timeout) as response:
        data = response.read(MAX_METADATA_BYTES + 1)
    if len(data) > MAX_METADATA_BYTES:
        raise ValueError(f"Metadata exceeds size limit: {filename}")
    rows = json.loads(data.decode("utf-8"))
    expected = DATASETS[filename][1]
    if not isinstance(rows, list) or len(rows) != expected:
        raise ValueError(f"Unexpected row count for {filename}; expected {expected}")
    ids = [row.get("id") for row in rows if isinstance(row, dict)]
    if len(ids) != expected or any(not isinstance(item, str) or not item for item in ids) or len(set(ids)) != expected:
        raise ValueError(f"Missing or duplicate IDs in {filename}")
    return rows


def reference_record(row, source_id, kind):
    source = SOURCE_MAP[source_id]
    name = row["服装名称"] if kind == "costume" else row["标题"]
    category = row["分类"] if kind == "costume" else row["分区"]
    return {
        "id": row["id"] if kind == "costume" else "portrait-" + row["id"],
        "kind": kind,
        "name": name,
        "category": category,
        "source": source_id,
        "sourceLabel": source["name"],
        "sourceUrl": source["url"],
        "thumb": "",
        "full": "",
        "tags": list(row.get("标签", [])),
        "prompt": row.get("关键词", ""),
        "description": name,
        "nsfw": bool(row.get("敏感")) or category in SENSITIVE_CATEGORIES,
    }


def costume_record(row, source_id):
    record = reference_record(row, source_id, "costume")
    origin = SOURCE_MAP[source_id]["url"]
    if source_id in {"gia-costume", "gia-anime"}:
        image_id = row["id"].removeprefix("gia-anime-")
        record["thumb"] = origin + f"thumbs/{image_id}.webp"
        record["full"] = origin + f"png/{image_id}.png"
    elif source_id == "charadb":
        record["thumb"] = row["缩略图"]
        record["full"] = row["原图"]
    else:
        views = []
        for view in row["views"]:
            filename = view["原图"].rsplit("/", 1)[-1]
            views.append({
                "label": view["label"],
                "thumb": SHISEI_RAW + "w300/" + filename,
                "full": SHISEI_RAW + "w900/" + filename,
            })
        record["views"] = views
        selected = next((view for view in views if view["label"] == "正面"), views[0])
        record["thumb"], record["full"] = selected["thumb"], selected["full"]
    record["description"] = "，".join([record["category"], record["name"]])
    return record


def build_catalog(snapshots):
    costumes = []
    for filename, (source_id, _) in DATASETS.items():
        if filename.startswith("costume-"):
            costumes.extend(costume_record(row, source_id) for row in snapshots[filename])
    original_portraits = {row["id"]: row for row in snapshots["portrait.json"]}
    portraits = []
    for row in snapshots["portrait-zh.json"]:
        original = original_portraits[row["id"]]
        record = reference_record(row, "gia-portrait", "portrait")
        record.update({
            "thumb": SOURCE_MAP["gia-portrait"]["url"] + original["thumb"],
            "full": SOURCE_MAP["gia-portrait"]["url"] + original["full"],
            "hairLength": row["发长"],
            "hairstyle": row["发型名称"],
            "section": row["分区"],
        })
        record["tags"] = list(dict.fromkeys([record["section"], record["hairLength"], record["hairstyle"]]))
        record["description"] = "，".join(record["tags"])
        portraits.append(record)
    catalog = {
        "version": 1,
        "upstreamCommit": UPSTREAM_COMMIT,
        "sources": [dict(source) for source in SOURCES],
        "costumes": costumes,
        "portraits": portraits,
    }
    validate_catalog(catalog)
    return catalog


def validate_image_url(value, record, role):
    if not isinstance(value, str):
        raise ValueError("Image URL must be a string")
    parsed = urlsplit(value)
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port or parsed.query or parsed.fragment:
        raise ValueError(f"Invalid image URL for {record['id']}")
    source_id = record["source"]
    image_id = record["id"]
    if source_id == "shisei":
        size = "w300" if role == "thumb" else "w900"
        prefix = SHISEI_RAW + size + "/"
        pattern = re.escape("costume_" + image_id.removeprefix("shisei-") + "_") + r"(front|diag|side|back)\.webp"
        valid = value.startswith(prefix) and re.fullmatch(pattern, value[len(prefix):])
    elif source_id == "gia-portrait":
        image_id = image_id.removeprefix("portrait-")
        path = f"img/thumb/{image_id}.webp" if role == "thumb" else f"img/full/{image_id}.png"
        valid = value == SOURCE_MAP[source_id]["url"] + path
    elif source_id == "charadb":
        image_id = image_id.removeprefix("charadb-")
        path = f"thumb/{image_id}.webp" if role == "thumb" else f"img/{image_id}.jpg"
        valid = value == SOURCE_MAP[source_id]["url"] + path
    else:
        image_id = image_id.removeprefix("gia-anime-")
        path = f"thumbs/{image_id}.webp" if role == "thumb" else f"png/{image_id}.png"
        valid = value == SOURCE_MAP[source_id]["url"] + path
    if not valid:
        raise ValueError(f"Unexpected source image URL for {record['id']}: {role}")


def validate_catalog(catalog):
    if not isinstance(catalog, dict) or catalog.get("version") != 1 or catalog.get("upstreamCommit") != UPSTREAM_COMMIT:
        raise ValueError("Unexpected catalog version or upstream revision")
    if catalog.get("sources") != SOURCES:
        raise ValueError("Source attribution or licensing metadata changed")
    ids = set()
    source_counts = Counter()
    view_count = 0
    for collection, kind, count in (("costumes", "costume", 3224), ("portraits", "portrait", 1499)):
        records = catalog.get(collection)
        if not isinstance(records, list) or len(records) != count:
            raise ValueError(f"Unexpected {collection} count; expected {count}")
        for record in records:
            if not isinstance(record, dict) or record.get("kind") != kind:
                raise ValueError(f"Invalid {collection} record")
            image_id = record.get("id")
            if not isinstance(image_id, str) or not re.fullmatch(r"[A-Za-z0-9-]+", image_id) or image_id in ids:
                raise ValueError(f"Invalid or duplicate reference ID: {image_id}")
            ids.add(image_id)
            source_id = record.get("source")
            source = SOURCE_MAP.get(source_id)
            if source is None or (source_id == "gia-portrait") != (kind == "portrait"):
                raise ValueError(f"Invalid source for {image_id}")
            if record.get("sourceLabel") != source["name"] or record.get("sourceUrl") != source["url"]:
                raise ValueError(f"Source attribution mismatch for {image_id}")
            source_counts[source_id] += 1
            for field in ("name", "category", "description"):
                if not isinstance(record.get(field), str) or not record[field].strip():
                    raise ValueError(f"Missing {field} for {image_id}")
            if not isinstance(record.get("prompt"), str) or type(record.get("nsfw")) is not bool:
                raise ValueError(f"Invalid prompt or content flag for {image_id}")
            tags = record.get("tags")
            if not isinstance(tags, list) or any(not isinstance(tag, str) or not tag.strip() for tag in tags):
                raise ValueError(f"Invalid tags for {image_id}")
            for role in ("thumb", "full"):
                validate_image_url(record.get(role), record, role)
            if kind == "portrait":
                if record.get("hairLength") not in {"短发", "中发", "中长发", "长发"}:
                    raise ValueError(f"Invalid hair length for {image_id}")
                if record.get("section") != record["category"] or not record.get("hairstyle"):
                    raise ValueError(f"Invalid portrait metadata for {image_id}")
            if source_id == "shisei":
                views = record.get("views")
                if not isinstance(views, list) or not 1 <= len(views) <= 4:
                    raise ValueError(f"Missing costume views for {image_id}")
                labels = [view.get("label") for view in views]
                if len(labels) != len(set(labels)) or not set(labels) <= {"正面", "斜侧", "侧面", "背面"}:
                    raise ValueError(f"Invalid costume views for {image_id}")
                for view in views:
                    for role in ("thumb", "full"):
                        validate_image_url(view.get(role), record, role)
                view_count += len(views)
    expected_counts = {source: count for source, count in DATASETS.values() if source}
    if source_counts != expected_counts or view_count != 227:
        raise ValueError("Source or costume-view counts differ from the reviewed snapshot")


def write_catalog(catalog, output):
    """Validate before replacing; failed writes leave the previous catalog intact."""
    validate_catalog(catalog)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", dir=output.parent,
                                         prefix=output.name + ".", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(catalog, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, output)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Validate the existing JSON without network access")
    parser.add_argument("--output", type=Path, default=OUTPUT, help="Catalog file to write or validate")
    parser.add_argument("--timeout", type=float, default=30, help="Per-request network timeout in seconds")
    args = parser.parse_args()
    if not math.isfinite(args.timeout) or not 0 < args.timeout <= 120:
        parser.error("--timeout must be greater than zero and at most 120 seconds")
    if args.check:
        validate_catalog(json.loads(args.output.read_text(encoding="utf-8")))
    else:
        filenames = list(DATASETS)
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {filename: pool.submit(fetch_metadata, filename, args.timeout) for filename in filenames}
            snapshots = {filename: future.result() for filename, future in futures.items()}
        write_catalog(build_catalog(snapshots), args.output)
    print("Reference catalog verified: 3224 costumes, 1499 portraits, 227 historical-costume views.")


if __name__ == "__main__":
    main()
