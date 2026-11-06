"""Safe, dependency-light regression checks for the optional ComfyUI plugin."""

import sys
import unittest
from pathlib import Path
from io import BytesIO
from email.message import Message
import importlib.util
import json
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class CatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from comfyui_plugin.catalog import catalog_data
        cls.catalog = catalog_data()

    def test_catalog_counts_and_kinds(self):
        self.assertEqual(len(self.catalog["poses"]), 1439)
        self.assertEqual(len(self.catalog["costumes"]), 3224)
        self.assertEqual(len(self.catalog["portraits"]), 1499)
        for key, kind in (("poses", "pose"), ("costumes", "costume"), ("portraits", "portrait")):
            self.assertEqual({item["kind"] for item in self.catalog[key]}, {kind})
            self.assertEqual(len({item["id"] for item in self.catalog[key]}), len(self.catalog[key]))

    def test_pose_prompt_and_depth_pairing(self):
        item = self.catalog["poses"][0]
        self.assertTrue(item["prompt"])
        self.assertTrue(item["full"].startswith("/pose-index/image/"))
        self.assertTrue(item["depthFull"].startswith("https://ai-pose-depth-gallery.pages.dev/img/"))
        self.assertIn(item["anglePrompt"], {
            "front view, eye-level camera",
            "slightly high-angle view, camera looking down",
            "low-angle view, camera looking up",
            "side profile view, eye-level camera",
            "three-quarter front view, eye-level camera",
        })

    def test_remote_allowlist_rejects_arbitrary_urls(self):
        from comfyui_plugin.catalog import validate_remote_url
        validate_remote_url(self.catalog["portraits"][0]["full"])
        with self.assertRaises(ValueError):
            validate_remote_url("https://example.com/image.png")
        with self.assertRaises(ValueError):
            validate_remote_url("https://ai-costume-gallery.pages.dev/../secret.png")
        with self.assertRaises(ValueError):
            validate_remote_url("http://ai-costume-gallery.pages.dev/img/a.png")
        with self.assertRaises(ValueError):
            validate_remote_url("https://user:password@ai-costume-gallery.pages.dev/img/a.png")
        with self.assertRaises(ValueError):
            validate_remote_url("https://ai-costume-gallery.pages.dev:8443/img/a.png")
        with self.assertRaises(ValueError):
            validate_remote_url("https://raw.githubusercontent.com/other/repo/main/img/a.png")

    def test_all_catalog_urls_are_allowed(self):
        from comfyui_plugin.catalog import validate_remote_url
        for kind in ("costumes", "portraits"):
            for record in self.catalog[kind]:
                for view in [record, *record.get("views", [])]:
                    validate_remote_url(view["thumb"])
                    validate_remote_url(view["full"])

    def test_views_and_ids_are_bounded(self):
        from comfyui_plugin.catalog import selected_record, get_pose_file
        record = next(item for item in self.catalog["costumes"] if item.get("views"))
        selected = selected_record("costume", record["id"], 1)
        self.assertEqual(selected["full"], record["views"][1]["full"])
        with self.assertRaises(ValueError):
            selected_record("costume", record["id"], 100)
        with self.assertRaises(ValueError):
            get_pose_file("../../README.md", "full")
        with self.assertRaises(ValueError):
            get_pose_file(self.catalog["poses"][0]["id"], "anything")

    def test_safe_mode_rejects_before_loading(self):
        from comfyui_plugin.catalog import load_reference
        record = next(item for item in self.catalog["poses"] if item["nsfw"])
        with patch("comfyui_plugin.catalog.load_remote_image") as fetch:
            with self.assertRaises(ValueError):
                load_reference("pose", record["id"], use_depth=True, safe_mode=True)
            fetch.assert_not_called()

    def test_transparent_images_and_pixel_limit(self):
        from comfyui_plugin.catalog import _decode_image
        payload = BytesIO()
        Image.new("RGBA", (8, 8), (255, 0, 0, 0)).save(payload, format="PNG")
        payload.seek(0)
        image = _decode_image(payload)
        self.assertEqual(image.mode, "RGB")
        self.assertEqual(image.getpixel((0, 0)), (255, 255, 255))
        payload.seek(0)
        with patch("comfyui_plugin.catalog.MAX_IMAGE_PIXELS", 20):
            with self.assertRaises(ValueError):
                _decode_image(payload)

    def test_compressed_mapping_and_traversal(self):
        from comfyui_plugin.catalog import local_pose_path
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "data").mkdir()
            (root / "assets" / "images").mkdir(parents=True)
            target = root / "assets" / "images" / "example.webp"
            target.write_bytes(b"fixture")
            mapping = {"files": [{"old": "img/example.png", "new": "img/example.webp"}]}
            (root / "data" / "image-map.json").write_text(json.dumps(mapping), encoding="utf-8")
            with patch("comfyui_plugin.catalog.ROOT", root):
                self.assertEqual(local_pose_path({"原寸": "img/example.png"}), target.resolve())
                with self.assertRaises(ValueError):
                    local_pose_path({"原寸": "img/../../private.png"})

    def test_remote_fetch_is_bounded_and_decodes_only_images(self):
        from comfyui_plugin.catalog import load_remote_image
        payload = BytesIO()
        Image.new("RGB", (8, 8), "red").save(payload, format="PNG")
        address = "https://ai-costume-gallery.pages.dev/img/example.png"
        headers = Message()
        headers["Content-Type"] = "image/png"
        class Response(BytesIO):
            def geturl(self):
                return address
        response = Response(payload.getvalue())
        response.headers = headers
        with patch("comfyui_plugin.catalog.urllib.request.build_opener") as opener:
            opener.return_value.open.return_value = response
            self.assertEqual(load_remote_image(address).size, (8, 8))
            self.assertEqual(opener.return_value.open.call_args.kwargs["timeout"], 30)
        response = Response(payload.getvalue())
        response.headers = headers
        with patch("comfyui_plugin.catalog.urllib.request.build_opener") as opener:
            opener.return_value.open.return_value = response
            with patch("comfyui_plugin.catalog.MAX_IMAGE_BYTES", 2):
                with self.assertRaises(ValueError):
                    load_remote_image(address)


@unittest.skipUnless(importlib.util.find_spec("aiohttp"), "ComfyUI aiohttp is not installed")
class RouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_catalog_kind_and_invalid_kind(self):
        from comfyui_plugin.routes import catalog_response
        with patch("comfyui_plugin.routes.catalog_data", return_value={"poses": [], "costumes": [], "portraits": []}):
            result = await catalog_response(SimpleNamespace(query={"kind": "pose"}))
            self.assertEqual(json.loads(result.text), {"poses": []})
            result = await catalog_response(SimpleNamespace(query={"kind": "arbitrary"}))
            self.assertEqual(result.status, 400)

    async def test_image_route_rejects_unknown_identity(self):
        from aiohttp import web
        from comfyui_plugin.routes import image_response
        with self.assertRaises(web.HTTPNotFound):
            await image_response(SimpleNamespace(match_info={"identity": "../../README.md", "size": "full"}))


class NodeShapeTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec("torch") and importlib.util.find_spec("numpy"), "ComfyUI dependencies are not installed")
    def test_four_nodes_are_registered(self):
        from comfyui_plugin.nodes import NODE_CLASS_MAPPINGS
        self.assertEqual(set(NODE_CLASS_MAPPINGS), {
            "PoseIndexPose", "PoseIndexCostume", "PoseIndexPortrait", "PoseIndexRecipe",
        })
        self.assertEqual(NODE_CLASS_MAPPINGS["PoseIndexPose"].RETURN_TYPES, ("IMAGE", "STRING", "STRING"))
        self.assertEqual(NODE_CLASS_MAPPINGS["PoseIndexRecipe"].RETURN_TYPES[-2:], ("STRING", "STRING"))

    @unittest.skipUnless(importlib.util.find_spec("torch") and importlib.util.find_spec("numpy"), "ComfyUI dependencies are not installed")
    def test_local_node_returns_float_image_and_reviewed_prompt(self):
        from comfyui_plugin.nodes import PoseIndexPose, default_id
        identity = default_id("pose")
        image, actual_id, prompt = PoseIndexPose().load(identity)
        self.assertEqual(actual_id, identity)
        self.assertEqual(tuple(image.shape), (1, 1200, 900, 3))
        self.assertEqual(str(image.dtype), "torch.float32")
        self.assertGreaterEqual(float(image.min()), 0.0)
        self.assertLessEqual(float(image.max()), 1.0)
        self.assertIn("view", prompt)
        self.assertIn(", ", prompt)

    @unittest.skipUnless(importlib.util.find_spec("torch") and importlib.util.find_spec("numpy"), "ComfyUI dependencies are not installed")
    def test_recipe_tensor_order_and_prompts_with_mock_images(self):
        from comfyui_plugin.nodes import PoseIndexRecipe
        image = Image.new("RGB", (16, 24), "white")
        records = {
            "portrait": {"name": "短发人像", "description": "短发"},
            "costume": {"name": "外套", "description": "蓝色外套", "prompt": "blue coat"},
            "pose": {"description": "站姿 正面", "prompt": "a person stands", "anglePrompt": "front view, eye-level camera"},
        }
        def load_fixture(kind, identity, **kwargs):
            return image.copy(), records[kind]
        with patch("comfyui_plugin.nodes.load_reference", side_effect=load_fixture):
            result = PoseIndexRecipe().compose("portrait", "costume", "pose", extra_prompt="soft light")
        self.assertEqual(len(result), 6)
        self.assertEqual(tuple(result[3].shape), (1, 1200, 1800, 3))
        self.assertIn("蓝色外套", result[4])
        self.assertIn("blue coat", result[5])
        self.assertIn("front view, eye-level camera, a person stands", result[5])
        self.assertTrue(result[5].endswith("soft light"))


if __name__ == "__main__":
    unittest.main()
