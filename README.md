# dsh-ExitOnClose

中文 | [English](README.en.md)

DSH 桌面端点关闭按钮只会把窗口缩到系统托盘，官方没有开关能改。本插件让它直接退出：

```text
之前   点 ×  →  窗口隐藏，托盘图标还在，DSH 继续运行
之后   点 ×  →  窗口关闭，DSH 全部进程结束
```

装上即生效，无需配置。

## 安装

在桌面端**插件**页面粘贴本仓库的 GitHub 链接即可：

```text
https://github.com/xia0x1/dsh-ExitOnClose
```

也可以用命令行安装，`#` 后面跟分支或 tag 可固定版本：

```powershell
dsh plugin --profile desktop add https://github.com/xia0x1/dsh-ExitOnClose
dsh plugin --profile desktop add https://github.com/xia0x1/dsh-ExitOnClose#v0.1.0
```

本地开发时，直接把上面链接换成你的本地目录路径即可。

唯一依赖 `koffi` 自带预编译二进制、不执行安装脚本，因此不会触发 pnpm 的构建脚本审批。

## 停用与卸载

- **停用**：插件页关闭 `dsh-exit-on-close` 即可
- **卸载**：插件页直接点击 `dsh-exit-on-close` 卸载即可

## 行为

- **关闭按钮** → 结束 Electron 壳层及其整棵进程树，包括插件自己所在的宿主进程。窗口、托盘图标、agent 轮次、后台任务、终端子进程一起消失。
- **是强制终止，不是优雅退出。** 已落盘的会话、附件、日志都在（DSH 边跑边落盘），进行中的模型输出与正在跑的子进程会丢失。
- **仅 Windows 桌面端生效。** 其他平台或浏览器里的 `dsh web` 还未兼容。
- 首次点关闭可能先弹一次官方的"任务会继续，可从托盘打开"提示，确认一次后不再出现。

## 原理

桌面端由两个进程组成：处理关闭按钮的 Electron 壳层，以及运行插件的宿主子进程。壳层只接受固定几种 IPC 消息，插件无法请它退出；按钮又是原生窗口控件，页面里也观察不到。能跨越这个边界的只有窗口本身——插件用 `koffi` 每秒 4 次查询应用自己的顶层窗口是否可见，捕获"曾经上屏 → 全部不可见"这一个跃迁，然后依次终止壳层、其进程树、自己。选轮询而不是 Win32 钩子，是为了不留下任何需要长期持有的状态。

## 开发

```text
src/index.js         插件本体：挂载、生命周期、关闭时做什么
src/desktop.js       Win32 层：窗口观察与进程树终止
src/process-tree.js  纯进程关系计算（不依赖系统 API 与 Node API）
test/                纯逻辑单元测试
tools/dry-run.mjs    手动探针：只打印"关闭会结束什么"，不真的结束
cordis.patch.yml     bundle 层：挂载插件的那一行
locale/              插件页显示用的名称与描述
```

```powershell
node --test "test/*.test.mjs"     # 零依赖，不需要安装任何东西
```

已安装的插件本身也支持安全模式：设置 `DSH_EXIT_ON_CLOSE_DRY_RUN=1` 后再启动桌面端，关闭按钮只记录、不结束进程。

## 兼容性

不声明任何 `@deepseek-ai/dsh*` peer 依赖，不注入或消费任何服务，不注册工具、Slot、路由或服务，不修改任何共享对象；`apply` 不抛异常也不 await，`koffi` 懒加载，拿不到时只记一行日志并保持惰性，不会影响其他插件或 profile 启动。

已在 DSH 桌面版 `0.2.0-rc.2`（Electron 44 / Node 24 / Windows x64）验证。

## 许可证

[MIT](LICENSE)
