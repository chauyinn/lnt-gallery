# LNT Gallery

一个非官方的岭南通虚拟交通卡卡面图鉴，用于客户端通信研究、卡面展示和静态网页实践。

> 本项目与岭南通及相关版权方无隶属或合作关系。卡面图像、角色、商标及联名内容的权利归各自权利人所有。

## 功能

- 同步当前接口返回的卡面系列、详情和图片
- 仅保留当前卡面目录，自动清理失效资源
- 生成 WebP 大图和缩略图
- 提供系列搜索、亮暗主题、卡面预览和移动端布局
- 通过 GitHub Actions 定时更新并部署到 GitHub Pages

## 研究背景

请求签名逻辑来自对岭南通 Android 客户端的个人学习研究。研究时使用 Root Android 测试设备，通过 Frida 注入客户端调用的 Android 系统加密类，观察传入 MD5 运算前的文本，并据此复现卡面目录接口请求。

签名形式可概括为：

```text
MD5("body=" + 紧凑 JSON 请求体 + "&key=" + 客户端固定签名参数)
```

该实现依赖当前客户端行为，接口、签名方式或请求参数变更后可能需要同步调整。

## 数据范围

脚本同步以下条件中接口当前返回的全部系列：

```text
cityCode=01
ctp=05
suitChannel=4
```

这里的“全部”仅指该接口和请求条件的完整响应，不代表岭南通所有历史卡面或其他地区、渠道的数据。

同步时会校验分页、系列卡面数、ID 唯一性和本地资源完整性。若系列数量相对上次异常减少超过 20%，脚本会停止更新，避免错误覆盖数据。

## 目录结构

```text
.
├─ .github/workflows/sync-pages.yml  # 定时同步与 Pages 部署
├─ index.html                        # 页面结构
├─ styles.css                        # 页面样式
├─ app.js                            # 渲染、搜索与预览
├─ crawler.py                        # 卡面数据同步
├─ requirements.txt                 # Python 依赖
└─ public/
   ├─ data.json                     # 卡面目录数据
   ├─ cards/                        # WebP 大图
   └─ thumbs/                       # WebP 缩略图
```

## 本地运行

```powershell
python -m pip install -r requirements.txt
python crawler.py
python crawler.py --check
python -m http.server 8000
```

打开 `http://127.0.0.1:8000`。页面通过 `fetch()` 读取 JSON，不应直接使用 `file://` 打开。

## GitHub Pages

`.github/workflows/sync-pages.yml` 会在以下情况同步并部署站点：

- 推送到 `main`
- 每天香港时间 04:17
- 在 Actions 页面手动触发

使用前需在仓库 **Settings > Pages > Build and deployment** 中选择 **GitHub Actions**，并允许工作流写入仓库内容。

## 许可

项目源代码使用 MIT License。该许可仅适用于本项目编写的源代码，不授予任何卡面图像、商标、角色或其他第三方素材的权利。
