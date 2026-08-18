# LNT Gallery

一个非官方的岭南通虚拟交通卡卡面图鉴，用于客户端通信研究、卡面展示和静态网页实践。

🌐 **在线预览**：[LNT Gallery - 岭南通卡面](https://chauyinn.github.io/lnt-gallery/)

> [!NOTE]
> 本项目与岭南通及相关版权方无隶属或合作关系。卡面图像、角色、商标及联名内容的权利归各自权利人所有。

---

## 功能特性

- **数据同步**：自动抓取接口返回的卡面系列、卡面详情及图片资源
- **资源管理**：仅保留当前有效卡面目录，自动清理失效与冗余资源
- **图像优化**：自动转换并生成 WebP 高清原图及缩略图
- **前端交互**：采用轻盈清透的毛玻璃设计、系列与卡面即时检索、高清大图模态预览与全端自适应布局
- **自动部署**：基于 GitHub Actions 实现定时数据同步与 GitHub Pages 自动化持续部署

---

## 本地运行

> 提示：页面前端通过 `fetch()` 读取数据，受浏览器同源策略限制，请通过本地 Web 服务器访问，**不应直接使用 `file://` 协议打开**。

```powershell
# 1. 安装 Python 依赖
python -m pip install -r requirements.txt

# 2. 同步卡面数据与图片
python crawler.py

# 3. （可选）校验本地数据完整性
python crawler.py --check

# 4. 启动本地 Web 服务器
python -m http.server 3000 -b 127.0.0.1
```

启动后在浏览器中访问：`http://127.0.0.1:3000`

---

## 目录结构

```text
.
├─ .github/workflows/sync-pages.yml  # 定时同步与 Pages 部署工作流
├─ index.html                        # 页面结构
├─ styles.css                        # 页面样式（极简毛玻璃风格）
├─ app.js                            # 页面渲染、即时搜索与大图预览
├─ crawler.py                        # 数据爬取与图片同步脚本
├─ requirements.txt                 # Python 依赖清单
└─ public/
   ├─ data.json                     # 卡面目录结构化数据
   ├─ cards/                        # WebP 高清卡面大图
   └─ thumbs/                       # WebP 缩略图
```

---

## 研究背景

请求签名逻辑来自对岭南通 Android 客户端的学习与通信协议逆向分析。研究时使用已 Root 的 Android 测试设备，通过 Frida 注入客户端调用的系统加密类，观察传入 MD5 运算前的原始文本，并据此复现卡面目录接口请求。

接口签名格式概括如下：

```text
MD5("body=" + 紧凑 JSON 请求体 + "&key=" + 客户端固定签名密钥)
```

> 该实现依赖当前客户端版本通信逻辑，若服务端接口、签名算法或请求参数发生变更，可能需要同步更新脚本。

---

## 数据范围与安全校验

脚本默认同步以下请求条件中接口当前返回的全部系列：

```text
cityCode=01
ctp=05
suitChannel=4
```

> 这里的“全部”指该特定请求参数下的完整响应数据，不代表岭南通所有历史卡面或其他地区、渠道的数据。

**安全校验机制**：
同步过程中会严格校验接口分页完整性、系列卡面数量、ID 唯一性及本地图片资源完整性。若检测到系列数量较上次异常减少超过 20%，脚本将主动中止更新，防止因接口异常错误覆盖已有数据。

---

## GitHub Pages 自动化部署

仓库配置了 `.github/workflows/sync-pages.yml` 工作流，会在以下场景自动同步数据并重新部署：

- 推送代码至 `main` 分支时
- 每天香港时间（UTC+8）04:17 定时触发
- 在 GitHub 仓库 Actions 页面手动触发（`workflow_dispatch`）

**启用前配置**：
在仓库 **Settings > Pages > Build and deployment** 中将 **Source** 选择为 **GitHub Actions**，并确保 Actions 工作流具备对仓库的写入权限（`Read and write permissions`）。

---

## 许可协议

本项目源代码基于 [MIT License](LICENSE) 开源。该许可仅适用于本项目编写的代码部分，不授予任何卡面图像、商标、角色或其他第三方素材的知识产权。
