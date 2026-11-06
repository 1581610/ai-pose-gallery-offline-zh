"""Optional ComfyUI entry point for the Pose Index reference library."""

from .comfyui_plugin.nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from .comfyui_plugin.routes import register_routes

WEB_DIRECTORY = "./comfyui_plugin/web"

register_routes()

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
