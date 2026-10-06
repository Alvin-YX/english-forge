# fnOS `.fpk` 打包规范落地说明

> 🔴 **本文档是打包的权威依据。** 03 技术研发方案 §7.3 的 fpk 章节有 5 处与官方冲突，
> 已全部作废，以本文档 + 05 号核实报告为准。
>
> 核实报告：`//192.168.31.188/fs/1000/nfs/WorkBuddy/英语学习/forge-out/05-fnOS-fpk打包规范核实报告.md`
> 官方文档：https://developer.fnnas.com/docs/ （**公开可访问，无需登录**）

---

## 一、我方文档的 5 处硬错误（照抄会打包失败）

| # | 03 文档 §7.3 的写法 | 官方实际情况 | 后果 |
|---|---|---|---|
| 1 | `version` 强制三段式 `X.Y.Z`，且必须与镜像 tag 严格对齐 | ❌ **不强制三段式**。真实格式 `x[.y[.z]][-build]`，社区有 `lineage-20-1` 正常上架。fnOS **从不校验** manifest 与镜像 tag 的关系 | 我方"manifest unknown 报错"的结论是错的 —— 那是 Docker registry 的 tag 查找错误，与 fnOS manifest 无关 |
| 2 | `config/privilege` 用 bash 写 `run-as: package` | ✅ 官方是 **JSON**：`{"privileges":{"defaults":{"run-as":"package"}}}`。且官方明确：**Docker 应用不需要用它**（容器内身份由 compose 决定，与 fnOS root 无关） | 格式错误 |
| 3 | 声明 `config/resource` 的 `docker-project` | 🔴 **声明了会导致安装失败**。fnOS 的 `compose up` 发生在 `cmd/install_init` **之前**，离线镜像还没导入就报 `No such image` | 安装直接失败 |
| 4 | 用 `docker compose` 控制容器 | ⚠️ 走 `docker compose` 可行，但因放弃 `docker-project` 声明，**必须自己在 `cmd/main` 里完整实现 up/down/status** | 启停失效 |
| 5 | `apps` 目录下有 `config.wizard` | ❌ **目录结构无法验证**。wizard 是 `wizard/` 下 4 个独立脚本文件 | 结构错 |

**另需删除我方文档中编造的 manifest 字段**：`category`、`developer`、`website`、`privacy_policy`、`icon` —— 官方 manifest **无这些字段**，写上去会被忽略且误导维护者。分类是 `fnpack.json`（第三方源）的概念。

---

## 二、镜像分发方案：内置镜像 tar（零配置优先）

### 决策依据

| 方案 | 零配置 | 国内可用 | 结论 |
|---|---|---|---|
| **A 内置镜像 tar** | ✅ 完全零配置 | ✅ 不依赖网络 | **🏆 已选定** |
| B 公共 registry 拉取 | ❌ 需用户自己配加速源 | ❌ ghcr/Docker Hub 国内极慢 | 降级为可选 |
| C 私有 registry | ❌ 需预配凭据 | — | 排除 |
| D NAS 本地 build | — | — | ❌ fnOS 安装流程**无任何构建环节** |

依据：MAA-FnOS 实测 1.15GB 镜像 → 585MB tar.gz → 613MB fpk，已发布到 GitHub Release 并有用户实机跑通；MiBee NVR v0.10.1 同样思路。**两个独立社区项目验证过，不是无源之水。**

### 代价与应对

放弃 `docker-project` 声明 → 失去 fnOS 官方对 docker 应用的启停托管 → 自己在 `cmd/main` 实现 `up`/`down`/`status` + PID 判定 + 幂等镜像导入。

同时提供 `wizard/install` 的 `radio` 选项让用户选：
- `内嵌离线镜像（推荐）` → `docker load` 包内 tar
- `在线拉取镜像` → compose 直接 `image:` 拉取（需用户已配加速源）

---

## 三、完整目录结构（可直接照建）

```
englishforge/
├── manifest                    # 应用元数据（INI 风格 key=value）
├── ICON.PNG                    # 96x96 桌面图标（必须是 PNG，❌不支持 SVG）
├── ICON_256.PNG                # 256x256
├── README.md                   # 应用中心展示
├── LICENSE                     # AGPL-3.0
├── config/
│   ├── privilege               # JSON（非 root 声明）
│   └── resource                # JSON（data-share 声明，🔴 不声明 docker-project）
├── app/
│   ├── docker/
│   │   ├── docker-compose.yaml # 7 服务编排
│   │   ├── .env.template       # 无密码模板，由 wizard 生成 .env
│   │   ├── nginx/ef.conf
│   │   └── images/             # 镜像 tar.gz（🔴 体积大，不入 git）
│   ├── ui/
│   │   ├── config              # JSON，.url 网关入口
│   │   └── images/icon_{0}.png
│   └── scripts/
│       ├── precheck.sh         # 安装前：CPU/内存/架构/存储池校验
│       └── postinstall.sh      # 安装后：建目录 / 写权限 / 首次迁移
├── cmd/
│   ├── install_init            # 安装文件应用前
│   ├── install_callback        # 安装文件应用后（docker load 在此）
│   ├── main                    # start / stop / status
│   ├── upgrade_init
│   ├── upgrade_callback
│   ├── uninstall_init
│   ├── uninstall_callback
│   ├── config_init
│   └── config_callback         # 9 个脚本，官方要求幂等
├── wizard/
│   ├── install                 # 安装向导定义
│   ├── uninstall
│   ├── upgrade
│   └── config                  # 4 个向导
├── tools/
│   ├── fetch_models.py         # 模型下载（首次安装）
│   ├── verify_models.py        # 模型校验（sha256）
│   └── bench_speech.py         # 硬件档位自动探测
├── models/
│   └── manifest.json.template  # 模型清单（权重不入包）
└── changelog/
    └── 1.0.0.md
```

---

## 四、manifest 必填字段（fnpack 强制）

```ini
[appname]
appname           = englishforge
version           = 1.0.0
display_name      = 英语学习工作台
display_name_en   = English Forge
desc              = 覆盖小学到大学的全学段英语课程与口语练习，语音评测全部在 NAS 本地完成。
maintainer        = EnglishForge Team
maintainer_url    = https://github.com/your-org/english-forge
distributor       = your-org
source            = thirdparty
platform          = all
os_min_version    = 1.1.3100
desktop_uidir     = ui
desktop_applaunchname = englishforge.main
service_port      = 8443
checkport         = true
ctl_stop          = true
```

**`os_min_version = 1.1.3100`** 是硬要求 —— 统一网关功能需要该版本以上。

---

## 五、数据目录（🔴 我方文档约定错误）

**正确约定**是 fnOS 的软链矩阵，`n` 由用户选择的存储空间决定：

| 软链 | 目标 | 环境变量 | 用途 |
|---|---|---|---|
| `target` | `/vol{n}/@appcenter/englishforge` | `TRIM_APPDEST` | 应用文件（只读） |
| `etc` | `/vol{n}/@appconf/englishforge` | `TRIM_PKGETC` | 配置（.env 放这里，chmod 600） |
| `var` | `/vol{n}/@appdata/englishforge` | `TRIM_PKGVAR` | **重启后保留的运行数据** |
| `tmp` | `/vol{n}/@apptemp/englishforge` | `TRIM_PKGTMP` | 临时文件 |
| `home` | `/vol{n}/@apphome/englishforge` | `TRIM_PKGHOME` | 应用用户数据 |
| `shares/` | `config/resource` 声明的共享目录 | — | 用户可见 |

我方文档的 `/vol1/1000/EnglishForge/` 说法不准确。`install_type` 留空时**存储空间由用户在安装时选择**（官方行为），但目录内具体路径不能由用户在向导中任意指定。

⚠️ **官方强调：这些目录用 Windows ACL 权限模型，不是 POSIX ACL。** 脚本里 `chmod` 可能无效。

---

## 六、生命周期脚本约定

| 脚本 | 时机 |
|---|---|
| `install_init` | 安装文件应用**前** |
| `install_callback` | 安装文件应用**后**（🔴 `docker load` 放这里） |
| `main` | 处理 `start` / `stop` / `status` |
| `upgrade_init` / `upgrade_callback` | 升级前后 |
| `uninstall_init` / `uninstall_callback` | 卸载前后 |
| `config_init` / `config_callback` | 配置变更前后 |

**退出码语义**：`0` 成功（status 中表示运行中）· `1` 失败 · `3` 未运行 · 其他 → `exit 1`

🔴 **官方要求脚本尽量幂等** —— 安装/升级/配置流程在开发和恢复过程中都可能被重复执行。

**用户可见错误**：失败前把信息写入 `$TRIM_TEMP_LOGFILE`，这些会展示给用户。

---

## 七、WebUI 入口（统一网关）

走网关而非端口直连，理由：跟读打分需 WebSocket、家长后台需用户隔离。

```json
{
  ".url": {
    "englishforge.main": {
      "title": "EnglishForge",
      "icon": "images/icon_{0}.png",
      "type": "iframe",
      "protocol": "",
      "gatewayPrefix": "/app/englishforge",
      "gatewaySocket": "app.sock",
      "url": "/app/englishforge",
      "allUsers": true
    }
  }
}
```

关键机制：
1. `gatewaySocket` **只填文件名**（如 `app.sock`），socket 必须放在 `target` 目录下 → 宿主路径 `/var/apps/englishforge/target/app.sock`
2. Docker 用法：把 `${TRIM_APPDEST}` 挂进容器，让容器内服务在该目录创建 socket
3. 网关会**先校验 NAS 登录态**，再通过 Header 传身份：`X-Trim-Userid` / `X-Trim-Isadmin` / `X-Trim-Username`
4. 🔴 **不要信任客户端传入的用户 ID，只用网关转发的 Header**
5. ⚠️ **socket 权限 0600，探活必须用 package 用户身份**，否则健康应用会被误判失败
6. ⚠️ `gatewayPrefix` 公开路径中不要用点号

---

## 八、待验证项（打包时必须实测）

以下项在官方文档中**未找到权威来源**，社区做法与官方文档有出入，打包时需实测确认：

| 项 | 状态 |
|---|---|
| fpk 二进制格式（双层 tar.gz，`app/` → `app.tgz`） | ⚠️社区双项目互证，官方无文档 |
| `manifest.checksum` = `app.tgz` 的 MD5 | ⚠️同上 |
| fnpack 实际输出 `{appname}.fpk`（非 `{appname}-{version}-{arch}.fpk`） | ⚠️官方三处案例一致 |
| `changelog` vs `change_log` 字段名 | ❌官方自相矛盾，两个都不依赖 |
| 私有 registry 支持 | ❓官方完全未提及 |
| privilege 中指定 uid/gid | ❌官方不提供，用 `TRIM_UID` 读 |

---

## 九、官方上架流程

⚠️ **官方上架目前是人工流程**，无自助平台：
微信群 → 社区主理人 → 开发者先锋交流群

官方明确："**手动安装不应作为公开分发方式**"。若仅自用，用 fnpack 手动打包 + 应用中心手动导入即可。
