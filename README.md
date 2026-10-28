# 姿态索引 · Pose Index

中文姿势参考图库：完整看图、五视角对照、收藏集合、备注与四图参考台。支持在线浏览，也可整库下载后完全离线使用。

**[打开在线演示](https://1581610.github.io/ai-pose-gallery-offline-zh/)** · [原作者网站](https://ai-pose-gallery.pages.dev/) · [项目结构](docs/architecture.md)

- **素材原作者：** [ギア（@giaaibusi）](https://x.com/giaaibusi)
- **中文整理与工具维护：** [1581610](https://github.com/1581610)

素材为 288 个姿势、1439 张原图及对应缩略图，包含成人向艺术参考分类。
姿势素材与日文原始数据归原作者ギア所有；本项目提供中文整理和独立实现的浏览界面与工具。

## 开始使用

**在线：** 打开上方演示链接即可浏览完整图库，图片由本站静态文件提供。

**离线：** 下载仓库 ZIP 并完整解压，双击根目录的 **`index.html`** 或 **`打开图库.cmd`**。
首次下载约数百 MB，解压后正常浏览不需要安装 Python、Node 或其他依赖。

一键入口在已有 Python 时启动仅监听 `127.0.0.1` 的本地服务；否则直接打开 HTML。
程序不会修改 PATH、Python、系统网络配置，也不会停止其他程序。

## 可以做什么

- 搜索中文、日文、编号和分类，支持空格分隔的多关键词与一组常用动作同义词。
- 按姿势、全图、五视角对照三种模式；缺失视角保留空位，避免错列。
- 主图和缩略图完整显示；大图适应窗口，支持滚轮／双指缩放、拖动与镜像。
- 原图加载完成后，未放大时可直接原生拖出；放大后拖动平移，按住 `Alt` 拖动可导出原图。
- 分别收藏整个姿势或某张图；创建参考集合，批量加入、移出、重命名。
- 为姿势写备注，返回最近浏览；四图参考台并排对照。
- 导出／合并导入个人资料 JSON，迁移收藏、集合、备注与参考台；兼容同一浏览器入口中的旧版 `pose_fav` 收藏。
- 导出筛选结果或所选图片的 CSV；复制实际图片路径。
- 分批生成卡片，记忆主题、卡片尺寸、筛选、视图和滚动位置。
- 浅深色主题、手机折叠筛选、键盘导航。无运行时框架、CDN、外部字体或统计脚本。

| 操作 | 快捷键 |
| --- | --- |
| 聚焦搜索 | `/` |
| 换视角 | `←` / `→` |
| 换姿势，尽量保留视角 | `↑` / `↓` |
| 适应窗口／原尺寸 | `空格` |
| 收藏整个姿势 | `F` |
| 关闭大图 | `Esc` |

卡片右上角勾选用于批量操作：按姿势与对照模式选择此组内命中当前筛选的图片，全图模式选单图。
五视角模式展示命中姿势的完整角度上下文，必要时单独注明实际对照张数。
镜像仅改变显示，保留原文件。手机可在右上角帮助中导入／导出个人资料。
拖出操作携带原尺寸图片的地址与下载信息，供支持图片拖放的目标程序接收；也可使用“保存原图”。
在线版与本地服务版会提前准备实际图片文件，拖放数据包含 `Files` 项，可供网页上传区接收。
直接双击 HTML 时，浏览器不允许程序自动读取本机文件字节：可用 `打开图库.cmd` 启动本地服务，
或在大图面板中“选择本机原图目录”，选择 `assets/images` 文件夹后启用文件拖放。
选择目录只在当前浏览器页面关联文件；拖到其他网站或软件后，由接收方按其自身流程处理。

整组收藏与单图收藏是独立开关：收藏姿势会使其所有视角出现在“我的收藏”，
但不会自动点亮每张图的单图收藏按钮。卡片会标明来自整组或单图的收藏关系。
支持最多 1000 个参考集合，导入超过限制会明确拒绝，不截断原资料。

**个人记录保存位置：** 浏览器本地存储。在线地址、本地 HTTP、直接打开的文件可能各自保存一份。
换入口、换电脑、搬文件夹或清理浏览器前，请先导出个人资料，再到新入口导入。

## 清晰的目录

```text
assets/    原图与缩略图
data/      原始元数据、汉化对照和中文索引
src/       HTML、CSS、JavaScript 源码
scripts/   构建、下载、压缩、启动和校验
tests/     隔离回归测试
docs/      使用和架构说明
index.html 双击可用的离线入口
```

历史抓取页面、一次性补丁与旧审计截图不放进公开源码树。详细说明见 [docs/architecture.md](docs/architecture.md)。

## 构建和维护

仅修改或重新构建时需要 Python 3.10+，普通下载、构建与发布工具只用标准库。

```powershell
# 修改 src/ 后生成可直接双击的离线入口
python -X utf8 scripts/build.py

# 生成在线页面，准备 GitHub Pages 发布目录 dist/
python -X utf8 scripts/build.py --hosted
python -X utf8 scripts/prepare_site.py

# 增量补齐缺失原素材；默认 8 并发，已有图片跳过
python -X utf8 scripts/download.py all --workers 8

# 重建中文 CSV / Markdown 索引
python -X utf8 scripts/build_index.py
```

原始数据保留 `img/` 与 `thumbs/` 字段，脚本会自动映射到当前 `assets/` 目录。
下载器会重试失败请求，下载中断后可重跑。原站脚本访问受限时，也可通过
`--source-html 原站页面.html` 使用在浏览器保存的原作者页面引导元数据。

## 压缩和校验

压缩和逐图解码需要 Pillow；安装只需在自己的开发环境执行 `python -m pip install Pillow`。

```powershell
# 只在内存抽样测算，不创建、移动或删除图片
python -X utf8 scripts/optimize_images.py

# 写入较小且校验通过的 WebP，更新映射并重建，保留原图
python -X utf8 scripts/optimize_images.py --apply

# 重建成功后，显式将已切换引用的原图移至 .archive/originals/
python -X utf8 scripts/optimize_images.py --apply --archive-originals

# 检查全部引用、图片头、解码和尺寸
python -X utf8 scripts/verify.py --decode
```

默认转换为 RGB 像素无损 WebP；`--lossy`、`--gray` 会改变像素。
比原文件大的结果不切换引用。归档仍占磁盘空间，但可以恢复；程序不会自动清空归档。
构建遇到重复 ID、非法路径或缺图会明确失败，保留已有页面。
公开发布时使用完整原素材，若在本地归档过原图，先运行下载器从本机归档恢复或补齐。

## 测试与部署

```powershell
python -m pip install -r requirements-dev.txt
python -X utf8 tests/test_gallery.py
```

完整回归使用隔离的 Microsoft Edge 无头实例，不接触个人浏览器配置，覆盖离线打开、
搜索、收藏、集合、备份、CSV、参考台、桌面／手机完整看图和压缩安全性。
只运行无需素材或浏览器的工具测试：`python -X utf8 tests/test_gallery.py --tools-only`。

组合操作与失败回退检查：

```powershell
python -X utf8 tests/test_review.py
python -X utf8 tests/test_tool_review.py
```

多标签页会合并已保存的收藏增删；导入备份不会静默丢弃超限集合。
压缩重建失败会保留已有页面及其正在使用的衍生图片，发布打包使用全新的白名单快照。

GitHub Actions 会检查源码、生成样本与 Chromium 浏览器回归，并将 `dist/` 发布到 GitHub Pages。
只有 `main` 推送的全部检查通过，发布任务才会启动；失败检查会保留浏览器截图供定位。
发布目录只包含编译页面与图片，不包含工具、测试、历史归档或个人记录。

## 版权与致谢

感谢 **ギア（@giaaibusi）** 提供原始姿势参考素材。
图片和日文原始数据来自 [POSE-DB-01 原站](https://ai-pose-gallery.pages.dev/)，
本项目所做的是中文整理、独立界面与离线参考工具的开发维护，不对原素材主张所有权。

| 内容 | 位置 | 归属与许可范围 |
| --- | --- | --- |
| 原图、缩略图 | `assets/images/`、`assets/thumbnails/` | 归原作者所有，不适用本项目 MIT |
| 日文原始数据 | `data/poses.json`、`data/meta.json` | 保留原作者来源和原始字段，不适用本项目 MIT |
| 浏览界面、工具与测试代码 | `src/`、`scripts/`、`tests/` 等 | 按 [MIT 许可证](LICENSE) 开放 |
| 中文对照与索引 | `data/translations.zh-CN.json`、`data/index.*` | 本项目整理维护，不改变对应原素材与日文内容的权利归属 |

**代码开源许可与素材使用许可分开适用。** 原站说明允许将素材用于作品制作、编辑和参考，
包括商业作品制作；同时禁止对图片数据本身再分发、转载或转售。
本项目的 MIT 许可证不替代这些条款，也不构成原作者对镜像、分发或其他素材用途的授权或背书。
具体使用以原作者当前说明为准，详细来源与条款整理见 [NOTICES.md](NOTICES.md)。

如果你是素材权利人，发现署名、使用范围或内容有需要处理之处，
请通过 [仓库 Issues](https://github.com/1581610/ai-pose-gallery-offline-zh/issues) 联系维护者，
并提供对应内容及权利说明。维护者将核实并处理更正、限制展示或移除等事项。
