"""Read-only ComfyUI endpoints for catalogs and allowlisted local pose images."""

from aiohttp import web

from .catalog import catalog_data, get_pose_file

_registered = False


async def catalog_response(request):
    try:
        data = catalog_data()
    except (OSError, ValueError, KeyError):
        return web.json_response({"error": "图库元数据不完整，请更新完整仓库后重试"}, status=503)
    kind = request.query.get("kind")
    if kind:
        plural = {"pose": "poses", "costume": "costumes", "portrait": "portraits"}.get(kind)
        if not plural:
            return web.json_response({"error": "图库类型无效"}, status=400)
        data = {plural: data[plural]}
    return web.json_response(data, headers={"Cache-Control": "no-cache"})


async def image_response(request):
    try:
        path = get_pose_file(request.match_info["identity"], request.match_info["size"])
    except (OSError, ValueError, KeyError):
        raise web.HTTPNotFound(text="姿势图片不存在")
    return web.FileResponse(path, headers={"X-Content-Type-Options": "nosniff"})


def register_routes():
    global _registered
    if _registered:
        return
    try:
        from server import PromptServer
    except ImportError:
        return
    routes = PromptServer.instance.routes
    routes.get("/pose-index/catalog")(catalog_response)
    routes.get("/pose-index/image/{identity}/{size}")(image_response)
    _registered = True
