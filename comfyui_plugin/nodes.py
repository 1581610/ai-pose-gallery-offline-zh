"""Four reference nodes. Network requests occur only when a selected node runs."""

import numpy as np
import torch
from PIL import Image, ImageOps

from .catalog import catalog_data, load_reference


def image_tensor(image):
    return torch.from_numpy(np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0).unsqueeze(0)


def default_id(kind):
    records = catalog_data()[{"pose": "poses", "costume": "costumes", "portrait": "portraits"}[kind]]
    return next((record["id"] for record in records if not record.get("nsfw")), "")


def pose_prompt(record, include_angle):
    parts = [record.get("anglePrompt", "")] if include_angle else []
    parts.append(record.get("prompt", ""))
    return ", ".join(part for part in parts if part)


class PoseIndexPose:
    CATEGORY = "姿态索引 / 参考图库"
    FUNCTION = "load"
    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("姿势图", "图片ID", "英文姿态提示词")
    DESCRIPTION = "选择本地姿势白模或在线深度图，使用已校对的英文姿态提示词。"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "pose_id": ("STRING", {"default": default_id("pose")}),
            "use_depth": ("BOOLEAN", {"default": False, "label_on": "深度图", "label_off": "白模"}),
            "include_angle": ("BOOLEAN", {"default": True}),
            "safe_mode": ("BOOLEAN", {"default": True}),
        }}

    def load(self, pose_id, use_depth=False, include_angle=True, safe_mode=True):
        image, record = load_reference("pose", pose_id, use_depth=use_depth, safe_mode=safe_mode)
        return image_tensor(image), pose_id, pose_prompt(record, include_angle)


class PoseIndexCostume:
    CATEGORY = PoseIndexPose.CATEGORY
    FUNCTION = "load"
    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("服装图", "图片ID", "中文服装描述", "英文服装提示词")
    DESCRIPTION = "运行时仅从原作者站点读取所选服装参考图。"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "costume_id": ("STRING", {"default": default_id("costume")}),
            "costume_view": ("INT", {"default": 0, "min": 0, "max": 3}),
            "safe_mode": ("BOOLEAN", {"default": True}),
        }}

    def load(self, costume_id, costume_view=0, safe_mode=True):
        image, record = load_reference("costume", costume_id, view_index=costume_view, safe_mode=safe_mode)
        description = record.get("description") or record["name"]
        if record.get("selectedView"):
            description += " · " + record["selectedView"]
        return image_tensor(image), costume_id, description, record.get("prompt", "")


class PoseIndexPortrait:
    CATEGORY = PoseIndexPose.CATEGORY
    FUNCTION = "load"
    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("人像图", "图片ID", "人像描述")
    DESCRIPTION = "运行时从原作者站点读取所选人像参考图。"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "portrait_id": ("STRING", {"default": default_id("portrait")}),
            "safe_mode": ("BOOLEAN", {"default": True}),
        }}

    def load(self, portrait_id, safe_mode=True):
        image, record = load_reference("portrait", portrait_id, safe_mode=safe_mode)
        return image_tensor(image), portrait_id, record.get("description") or record["name"]


class PoseIndexRecipe:
    CATEGORY = PoseIndexPose.CATEGORY
    FUNCTION = "compose"
    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE", "IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("人像图", "服装图", "姿势图", "三图拼图", "中文合成提示词", "英文合成提示词")
    DESCRIPTION = "以人像、服装、姿势的顺序输出三张参考和 1800×1200 拼图。"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "portrait_id": ("STRING", {"default": default_id("portrait")}),
            "costume_id": ("STRING", {"default": default_id("costume")}),
            "pose_id": ("STRING", {"default": default_id("pose")}),
            "costume_view": ("INT", {"default": 0, "min": 0, "max": 3}),
            "use_depth": ("BOOLEAN", {"default": False}),
            "include_angle": ("BOOLEAN", {"default": True}),
            "safe_mode": ("BOOLEAN", {"default": True}),
            "extra_prompt": ("STRING", {"default": "", "multiline": True}),
        }}

    def compose(self, portrait_id, costume_id, pose_id, costume_view=0, use_depth=False,
                include_angle=True, safe_mode=True, extra_prompt=""):
        portrait, portrait_record = load_reference("portrait", portrait_id, safe_mode=safe_mode)
        costume, costume_record = load_reference("costume", costume_id, view_index=costume_view, safe_mode=safe_mode)
        pose, pose_record = load_reference("pose", pose_id, use_depth=use_depth, safe_mode=safe_mode)
        composite = Image.new("RGB", (1800, 1200), "white")
        for index, image in enumerate((portrait, costume, pose)):
            fitted = ImageOps.contain(image, (600, 1200), Image.Resampling.LANCZOS)
            composite.paste(fitted, (index * 600 + (600 - fitted.width) // 2, (1200 - fitted.height) // 2))
        chinese = "\n".join([
            "结合三张参考创作角色。参考顺序为人像、服装、姿势。",
            "人像参考：" + (portrait_record.get("description") or portrait_record["name"]),
            "服装参考：" + (costume_record.get("description") or costume_record["name"]),
            "姿势参考：" + pose_record["description"],
        ])
        english_parts = [
            "Create a character using the three references in order: portrait, costume, pose.",
            "Preserve the identity and hairstyle of the portrait reference and the clothing of the costume reference.",
        ]
        if costume_record.get("prompt"):
            english_parts.append("Clothing: " + costume_record["prompt"])
        english_parts.append("Pose: " + pose_prompt(pose_record, include_angle))
        if extra_prompt.strip():
            chinese += "\n" + extra_prompt.strip()
            english_parts.append(extra_prompt.strip())
        return (image_tensor(portrait), image_tensor(costume), image_tensor(pose), image_tensor(composite),
                chinese, "\n".join(english_parts))


NODE_CLASS_MAPPINGS = {
    "PoseIndexPose": PoseIndexPose,
    "PoseIndexCostume": PoseIndexCostume,
    "PoseIndexPortrait": PoseIndexPortrait,
    "PoseIndexRecipe": PoseIndexRecipe,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PoseIndexPose": "姿态索引 · 姿势参考图",
    "PoseIndexCostume": "姿态索引 · 服装参考图",
    "PoseIndexPortrait": "姿态索引 · 人像参考图",
    "PoseIndexRecipe": "姿态索引 · 三合一角色配方",
}
