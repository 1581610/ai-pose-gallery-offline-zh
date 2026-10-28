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
│   ├── index.csv               中文图片索引，路径指向当前 assets 目录
│   └── index.md                按系列和姿势分组的目录
├── src/
│   ├── shell.html              页面骨架和编译占位符
│   ├── style.css               主题、布局和响应式样式
│   └── app.js                  搜索、浏览、收藏、备份和参考台
├── scripts/
│   ├── _paths.py               可搬移路径与原路径到 assets 的映射
│   ├── build.py                校验数据，生成离线或在线单页
│   ├── build_index.py          生成中文 CSV 和 Markdown 索引
│   ├── download.py             增量下载和补齐原素材
│   ├── optimize_images.py      默认内存测算；显式转换与可恢复归档
│   ├── prepare_site.py         仅将公开页面及图片放入发布目录
│   ├── serve.py                只监听本机，验证服务身份和占用端口
│   ├── translations.py         重建汉化对照表
│   └── verify.py               图片魔数、解码与尺寸检查
├── tests/
│   └── test_gallery.py         隔离浏览器与生成样本回归测试
├── docs/                       项目文档
├── .github/workflows/          代码检查和 GitHub Pages 自动发布
├── index.html                  可直接双击的离线构建产物
├── 打开图库.cmd                 Windows 入口
├── README.md
├── NOTICES.md
└── LICENSE
```

## 数据流

`poses.json + translations.zh-CN.json + src/* → build.py → index.html`

- 原始数据中的 `img/...` 和 `thumbs/...` 不直接更改，路径层将它们映射到 `assets/images/...` 和 `assets/thumbnails/...`。
- 离线单页包含全部检索数据，图片以相对路径读取，不需要 fetch、框架、CDN 或联网。
- `--hosted` 生成 `dist/index.html`，使用同源 `assets/` 图片；`prepare_site.py` 为 GitHub Pages 准备公开文件。
- `--online` 可生成直接引用原作者图片地址的备用配置，不是默认发布模式。
- `dist/`、测试截图、临时文件、压缩归档和个人备份不进入 Git。
- 界面运行时只在浏览器中保存个人记录。导出 JSON 是跨入口、跨设备迁移的方法。

## 修改边界

页面改动从 `src/` 开始，修改后重建 `index.html`；不手工修改编译产物。
原素材更新先下载、校验，再构建。图片压缩先生成和验证 WebP，再更新映射与构建，最后才允许显式归档原图。
发布只选取页面与图片，不把代码、测试、归档和个人记录复制进站点产物。
