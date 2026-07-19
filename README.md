# PlanThrough

> 一张图，无限穿透。

PlanThrough 是一个把时间轴、分层任务、流程连线和节点审批放在同一张画布上的项目设计与执行工具。用户可以先像画流程图一样设计项目，再启动项目并按照逻辑线逐节点执行。

## 当前功能

- 新项目从空白画布开始，只显示起点、终点、事件分类和时间轴。
- 支持自定义 Thinking、Doing、Acting 等事件分类。
- 支持一级、二级、三级递归节点；子节点在父节点的半透明区域中展开。
- 节点按开始时间自动编号，例如 `A2`、`A2-B1`、`A2-B1-C1`；拖动时间后立即重新排序。
- 节点可横向拖动修改日期、纵向拖动修改分类，也可拖动左右边缘修改开始或结束时间。
- 支持有方向的逻辑线和虚线关系线；只允许同一父节点下的同级节点连接。
- 逻辑线决定执行顺序；多个前置节点全部完成后才会解锁后续节点。
- 时间重叠的同级节点会显示贯穿画布的黄色并发虚线，悬停可查看说明。
- 项目支持设计、运行、暂停和完成状态。运行期间锁定时间和结构，暂停后可继续调整。
- 红灯表示未执行，黄灯闪烁表示正在执行，绿灯表示已完成；深层执行状态会向父级归并。
- Working 面板支持执行原则、执行内容、验收标准、团队姓名、审批步骤、成果说明和附件。
- 验收通过后节点自动变为 100%，并解锁符合条件的下一节点。
- 删除当前节点后不会自动跨越流程，管理者必须重新建立逻辑线才能继续。
- 只有全部末端一级逻辑节点完成后终点才可点击；点击后终点变绿并播放完成动画。
- 项目总览展示各层级数量、完成率、当前执行路径和图例。
- 支持项目库、项目 JSON 导入导出，以及本机附件上传、下载和删除。

## 环境要求

- Git
- Node.js `22.13.0` 或更高版本
- npm（随 Node.js 安装）

检查版本：

```powershell
git --version
node --version
npm --version
```

## 克隆并启动

```powershell
git clone https://github.com/gohmadein/PlanThrough.git
cd PlanThrough
npm install
npm run dev
```

终端会显示本地访问地址，通常是：

```text
http://localhost:3000
```

请以终端实际显示的 Local 地址为准，在浏览器中打开即可使用。

停止服务：回到正在运行服务的终端，按 `Ctrl + C`。

## 生产模式

```powershell
npm install
npm run build
npm run start
```

修改代码后需要重新执行 `npm run build`。

## 验证项目

```powershell
npm run lint
npm test
```

## 数据保存说明

- 新版项目数据保存在浏览器 `localStorage` 的独立 V2 数据空间中，旧测试数据不会自动进入新版。
- 附件保存在当前浏览器的 `IndexedDB` 中。
- 更换电脑、浏览器或清除浏览器数据后，本地项目和附件不会自动同步。
- 建议定期使用顶部“导出”备份项目 JSON。
- JSON 包含项目结构和附件信息，但不包含附件文件本身；附件需要单独保存和传输。
- GitHub 仓库只包含源代码，不包含用户在浏览器中创建的项目数据。

## 项目结构

```text
app/PlanTool.tsx        核心画布、节点、连线、执行和 Working 逻辑
app/ProjectLibrary.tsx  项目库
app/globals.css         主界面样式
app/extras.css          补充组件样式
tests/                  自动化测试
public/                 静态资源
```

## 常见问题

### `npm run dev` 无法启动

先确认 Node.js 版本，再重新安装依赖：

```powershell
node --version
Remove-Item -Recurse -Force node_modules
npm install
npm run dev
```

不要随意执行 `npm audit fix --force`，它可能升级关键依赖并造成不兼容。

### 其他电脑看不到我创建的项目

这是正常现象。项目数据保存在当前浏览器中，不会随 Git 仓库下载。需要分享项目内容时，请导出项目 JSON；附件文件需另外发送。
