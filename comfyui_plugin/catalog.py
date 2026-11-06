"""Shared metadata and bounded, source-allowlisted reference image loading."""

from copy import deepcopy
from functools import lru_cache
from io import BytesIO
import json
from pathlib import Path, PurePosixPath
import re
import urllib.error
import urllib.parse
import urllib.request
import warnings

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
MAX_IMAGE_BYTES = 25 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
ANGLE_PROMPTS = {
    "正面": "front view, eye-level camera",
    "俯视": "slightly high-angle view, camera looking down",
    "仰视": "low-angle view, camera looking up",
    "侧面": "side profile view, eye-level camera",
    "斜视": "three-quarter front view, eye-level camera",
}
SOURCE_HOSTS = {
    "ai-costume-gallery.pages.dev",
    "ai-costume-anime-gallery.pages.dev",
    "charadb-2fi.pages.dev",
    "ai-portrait-gallery.pages.dev",
    "ai-pose-depth-gallery.pages.dev",
}
SHISEI_PREFIX = "/wquguru/shisei/8f61ceab10e45f8d3afd254900903733a0ba76ee/images/costume/grey/"


def validate_remote_url(value):
    """Only image URLs from catalog-owned source hosts can be fetched."""
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError("参考图地址无效")
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme != "https" or parsed.username or parsed.password
            or parsed.port not in (None, 443) or parsed.query or parsed.fragment):
        raise ValueError("参考图地址必须来自已登记的 HTTPS 图源")
    decoded = urllib.parse.unquote(parsed.path)
    path = PurePosixPath(decoded)
    if ".." in path.parts or "\\" in decoded or path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
        raise ValueError("参考图路径无效")
    if parsed.hostname == "raw.githubusercontent.com":
        if not any(decoded.startswith(SHISEI_PREFIX + size + "/") for size in ("w300", "w900")):
            raise ValueError("参考图不在已登记的 Shisei 版本中")
    elif parsed.hostname not in SOURCE_HOSTS:
        raise ValueError("参考图来源未登记")
    return value


def local_pose_path(record, size="full"):
    field, folder = ("原寸", "images") if size == "full" else ("サムネ", "thumbnails")
    if size not in ("full", "thumb"):
        raise ValueError("图片尺寸参数无效")
    relative = record[field]
    mapping_path = ROOT / "data" / "image-map.json"
    if mapping_path.is_file():
        image_map = json.loads(mapping_path.read_text(encoding="utf-8"))
        relative = next((entry["new"] for entry in image_map["files"] if entry["old"] == relative), relative)
    if not isinstance(relative, str):
        raise ValueError("本地姿势图片路径无效")
    path = PurePosixPath(relative)
    expected = "img" if size == "full" else "thumbs"
    if (path.is_absolute() or ".." in path.parts
            or not path.parts or path.parts[0] != expected or "\\" in relative
            or ":" in relative or path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp")):
        raise ValueError("本地姿势图片路径无效")
    base = (ROOT / "assets" / folder).resolve()
    result = (base / Path(*path.parts[1:])).resolve()
    if not base.is_relative_to(ROOT.resolve()) or not result.is_relative_to(base) or not result.is_file():
        raise FileNotFoundError("姿势图片缺失，请完整下载仓库素材后重试")
    return result


def _catalog_signature():
    filenames = ("poses.json", "translations.zh-CN.json", "prompts.en.json", "reference-catalog.json")
    return tuple((ROOT / "data" / name).stat().st_mtime_ns for name in filenames)


@lru_cache(maxsize=2)
def _load_catalog(signature):
    def read(name):
        return json.loads((ROOT / "data" / name).read_text(encoding="utf-8"))

    translations = read("translations.zh-CN.json")
    prompts = read("prompts.en.json")
    originals = read("poses.json")
    references = read("reference-catalog.json")
    poses = []
    for record in originals:
        identity = record["id"]
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", identity):
            raise ValueError("姿势编号无效")
        group_id = identity.rsplit("_", 1)[0]
        name = translations["poses"].get(record["ポーズ名"], record["ポーズ名"])
        angle = translations["angs"].get(record["アングル"], record["アングル"])
        line = translations["lines"].get(record["系統"], record["系統"])
        pose = {
            "id": identity,
            "kind": "pose",
            "name": name,
            "category": translations["cats"].get(record["分類"], record["分類"]),
            "line": line,
            "angle": angle,
            "description": name + " · " + angle,
            "prompt": prompts.get(group_id, ""),
            "anglePrompt": ANGLE_PROMPTS.get(angle, ""),
            "thumb": "/pose-index/image/" + identity + "/thumb",
            "full": "/pose-index/image/" + identity + "/full",
            "depthThumb": "https://ai-pose-depth-gallery.pages.dev/thumbs/" + identity + ".jpg",
            "depthFull": "https://ai-pose-depth-gallery.pages.dev/img/" + identity + ".png",
            "sourceLabel": "ギア · 姿势参考",
            "sourceUrl": "https://ai-pose-gallery.pages.dev/",
            "tags": [line, angle],
            "nsfw": "sexy" in identity or "pair" in identity,
        }
        poses.append(pose)
    catalogs = {"poses": poses, "costumes": references["costumes"], "portraits": references["portraits"]}
    indexes = {}
    for plural, records in catalogs.items():
        index = {record["id"]: record for record in records}
        if len(index) != len(records):
            raise ValueError("图库中存在重复编号")
        indexes[plural] = index
    return catalogs, indexes, {record["id"]: record for record in originals}


def catalog_data():
    return deepcopy(_load_catalog(_catalog_signature())[0])


def get_record(kind, identity):
    plural = {"pose": "poses", "costume": "costumes", "portrait": "portraits"}.get(kind)
    if not plural or not isinstance(identity, str):
        raise ValueError("图库类型或图片编号无效")
    record = _load_catalog(_catalog_signature())[1][plural].get(identity)
    if record is None:
        raise ValueError("找不到所选图片，请重新打开选图器选择")
    return deepcopy(record)


def get_pose_file(identity, size):
    original = _load_catalog(_catalog_signature())[2].get(identity)
    if original is None:
        raise ValueError("姿势编号不存在")
    return local_pose_path(original, size)


class SourceRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        validate_remote_url(new_url)
        return super().redirect_request(request, response, code, message, headers, new_url)


def _decode_image(stream):
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(stream) as image:
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise ValueError("参考图超过 4000 万像素限制")
            image.load()
            oriented = ImageOps.exif_transpose(image)
            if oriented.mode in ("RGBA", "LA") or "transparency" in oriented.info:
                rgba = oriented.convert("RGBA")
                background = Image.new("RGBA", rgba.size, "white")
                background.alpha_composite(rgba)
                return background.convert("RGB")
            return oriented.convert("RGB")


def load_remote_image(url):
    validate_remote_url(url)
    request = urllib.request.Request(url, headers={"User-Agent": "PoseIndex-ComfyUI/1.0", "Accept": "image/*"})
    opener = urllib.request.build_opener(SourceRedirectHandler())
    try:
        with opener.open(request, timeout=30) as response:
            validate_remote_url(response.geturl())
            content_type = response.headers.get_content_type()
            if not content_type.startswith("image/"):
                raise ValueError("图源返回了非图片内容，请稍后重试")
            length = response.headers.get("Content-Length")
            if length and int(length) > MAX_IMAGE_BYTES:
                raise ValueError("参考图超过 25 MB 限制")
            payload = response.read(MAX_IMAGE_BYTES + 1)
            if len(payload) > MAX_IMAGE_BYTES:
                raise ValueError("参考图超过 25 MB 限制")
        return _decode_image(BytesIO(payload))
    except (urllib.error.URLError, TimeoutError) as error:
        raise RuntimeError("无法从原站读取所选参考图，请检查网络连接后重试") from error


def selected_record(kind, identity, view_index=0):
    record = get_record(kind, identity)
    views = record.get("views") or []
    if views:
        if type(view_index) is not int or not 0 <= view_index < len(views):
            raise ValueError("服装视角编号超出范围，请重新选择视角")
        view = views[view_index]
        record.update(thumb=view["thumb"], full=view["full"], selectedView=view["label"])
    return record


def load_reference(kind, identity, use_depth=False, view_index=0, safe_mode=True):
    record = selected_record(kind, identity, view_index)
    if safe_mode and record.get("nsfw"):
        raise ValueError("所选参考属于成人分类，请在节点中确认安全模式设置")
    if kind == "pose" and not use_depth:
        image = _decode_image(get_pose_file(identity, "full"))
    else:
        url = record["depthFull"] if kind == "pose" else record["full"]
        image = load_remote_image(url)
    return image, record
