# 项目结构

```text
ai-pose-gallery-offline-zh/
├── assets/
│   ├── images/                 原尺寸图片
│   └── thumbnails/             缩略图
├── data/
│   ├── poses.json              原作者元数据，保留原字段与路径，便于溯源
│   ├── meta.json               原始系列定义
│   ├── translations.zh-CN.json 汉化对照
│   ├── prompts.en.json         288 组已复核的英文姿势提示词
│   ├── reference-catalog.json  服装、人像的中文索引、来源与图片 URL
│   ├── index.csv               中文图片索引，路径指向当前 assets 目录
│   └── index.md                按系列和姿势分组的目录
├── src/
│   ├── shell.html              页面骨架和编译占位符
│   ├── style.css               主题、布局和响应式样式
│   ├── app.js                  姿势搜索、浏览、收藏、备份和参考台
│   ├── workspaces.js           单页工作区切换和 hash 导航
│   ├── generator.js            五种图像协议与 ComfyUI 任务客户端
│   ├── studio.js               配方、拼图、接口设置与 IndexedDB 生成记录
│   ├── studio.css              合成台与接口设置布局
│   ├── reference-library.js    服装与人像浏览、筛选、详情和配方入口
│   └── reference-library.css   扩展图库样式
├── comfyui_plugin/
│   ├── catalog.py              共享目录读取和按需图像加载
│   ├── nodes.py                4 个 ComfyUI 原生节点
│   ├── routes.py               节点选图器目录与图片路由
│   └── web/                   ComfyUI 画布选图器
├── scripts/
│   ├── _paths.py               可搬移路径与原路径到 assets 的映射
│   ├── build.py                校验数据，生成离线或在线单页
│   ├── build_index.py          生成中文 CSV 和 Markdown 索引
│   ├── download.py             增量下载和补齐原素材
│   ├── import_reference_catalog.py 固定上游元数据同步与离线校验
│   ├── optimize_images.py      默认内存测算；显式转换与可恢复归档
│   ├── prepare_site.py         仅将公开页面及图片放入发布目录
│   ├── serve.py                只监听本机，验证服务身份和占用端口
│   ├── translations.py         重建汉化对照表
│   └── verify.py               图片魔数、解码与尺寸检查
├── tests/
│   ├── test_gallery.py         主要功能与压缩安全性回归
│   ├── test_review.py          搜索、选择、键盘、备份与多标签组合操作
│   ├── test_tool_review.py     失败回退、发布白名单与重复构建
│   ├── test_reference_catalog.py 扩展目录与来源 URL 校验
│   ├── test_generator.cjs      五协议请求、响应与错误处理的模拟测试
│   ├── test_comfy_plugin.py    可选插件的隔离检查
│   ├── test_workbench.py       扩展图库与工作台浏览器回归
│   └── test_publish.py         实际发布目录的 HTTP 路径与图片验证
├── docs/                       项目文档
├── .github/workflows/          代码检查和 GitHub Pages 自动发布
├── __init__.py                 可选 ComfyUI 插件入口
├── index.html                  可直接双击的单页构建产物
├── 打开图库.cmd                 Windows 入口
├── README.md
├── NOTICES.md
└── LICENSE
```

## 数据流

`poses.json + translations.zh-CN.json + prompts.en.json + reference-catalog.json + src/* → build.py → index.html`

- 原始数据中的 `img/...` 和 `thumbs/...` 不直接更改，路径层将它们映射到 `assets/images/...` 和 `assets/thumbnails/...`。
- 单页包含姿势与扩展目录的检索数据。姿势白模以本地相对路径读取，断网时可浏览原图库。
- 服装、人像和深度图保留来源 URL，仅在浏览或使用所选参考图时按需读取。目录更新只同步元数据。
- `--hosted` 生成 `dist/index.html`，使用同源 `assets/` 图片；`prepare_site.py` 为 GitHub Pages 准备公开文件。
- `--online` 可生成直接引用原作者图片地址的备用配置，不是默认发布模式。
- `dist/`、测试截图、临时文件、压缩归档和个人备份不进入 Git。
- 姿势收藏、集合、备注等保存在浏览器 localStorage。现有 JSON 备份用于迁移这些个人记录。
- 工作台生成记录与图片保存在 IndexedDB，API key 仅保存在页面内存。生成请求通过浏览器直连用户填写的服务端点。

## 修改边界

页面改动从 `src/` 开始，修改后重建 `index.html`；不手工修改编译产物。
原素材更新先下载、校验，再构建。压缩采用内容摘要命名的 WebP，不覆盖当前页面正在使用的衍生图；
更新映射与构建成功后才允许显式归档原图。构建失败会恢复先前映射，保留现有页面和图片。
发布只选取页面与图片，不把代码、测试、归档和个人记录复制进站点产物。
发布文件先在项目内临时目录形成完整清单，再替换 `dist/`，重复打包不会带入之前的额外文件。

浏览器记录写入前会合并其他标签页已保存的增删，并监听跨标签更新；视图状态仍由各标签页自行控制。
集合与单图采用稳定 ID，备份导入会验证 ID、合并重复项；超出集合数量限制时明确拒绝，不截断保存的数据。

图片拖出保留浏览器原生文件格式，补充原图地址、HTML 与下载格式；不另行 fetch、建立 File 缓存或要求选择目录。
未放大时直接拖出，放大后拖动平移，Alt＋拖动仍可导出。原图未加载完成时阻止导出缩略图。
直接打开 HTML 的文件接收能力取决于浏览器；启动离线本地 HTTP 服务或保存原图可作为替代。
原生文件验证用 Chromium 的实际鼠标输入，避免自动化拖放拦截／序列化丢失 File 而误判。


## 扩展图库与工作台

`reference-catalog.json` 使用稳定的来源标识与条目 ID，收录 3,224 套服装和 1,499 条人像。
姿势深度图按原姿势图片 ID 配对。姿势白模、五角定义和 288 组英文动作提示词继续使用原数据。
新增图库采用按批渲染和图片懒加载，来源说明随目录保留。

工作台将人像、服装、姿势与用户添加的参考图组合为配方，支持画风选择、提示词编辑和
`1800 × 1200` 核心参考 Canvas 拼图。附加图片随生成请求单独传入。
中文组合提示词同时保留原姿势的详细英文动作描述。
配方、工作流和待追踪任务 ID 存入 IndexedDB 的状态存储，历史存储保留最近 30 次生成记录。
远程结果优先保存为图片数据，跨域读取失败时保存服务返回的图片 URL。
图像接口客户端提供 Gemini、OpenAI Images、Qwen、Doubao 和 ComfyUI 五种协议。
ComfyUI 使用 API 格式工作流，按需上传所选参考图、提交任务并读取输出。
导入工作流默认保留其 API 图节点的数值与连线。界面尺寸和种子覆盖开关关闭时，
不重写工作流自身参数；开启时才替换对应占位值。提交状态未知时要求确认服务端状态后再重试，
避免同一任务被重复排队。

页面 CSP 允许扩展图片和用户配置的接口连接，运行逻辑随构建嵌入单页。
浏览器仍会执行 CORS、混合内容和本地网络访问检查。来源图片能在页面显示，
并不保证同一图片可供 Canvas 读取或上传 API；后两者需要来源响应允许跨域读取。
`file://` 入口还有本地图片读取与 Canvas 限制，可通过 `打开图库.cmd` 启动本地 HTTP 入口。

本轮未接入 ComfyUI `object_info` 动态参数表单或 WebSocket 节点进度。
高级动态参数通过导入的 API JSON 工作流配置，任务状态使用 HTTP 轮询，并可用已保存任务 ID 恢复追踪。

## 可选 ComfyUI 插件

根目录 `__init__.py` 导出节点注册信息和 `WEB_DIRECTORY`。
将完整仓库放入 `ComfyUI/custom_nodes/ai-pose-gallery-offline-zh/` 后，
ComfyUI 可注册姿势参考、服装参考、人像参考和三合一角色配方四个节点。
节点复用 `torch`、`numpy`、`Pillow` 和 `aiohttp`，从同一份项目数据读取目录。

姿势白模使用本地 `assets/`，深度图、服装和人像按选定的单张图片读取来源 URL。
配方节点输出三张参考图、`1800 × 1200` 拼图与中英文提示词。
选图器由 `comfyui_plugin/web/` 提供，通过插件路由读取目录并回填稳定 ID。
插件作为可选集成随源码提供，网页构建和 GitHub Pages 发布使用各自原有入口。
