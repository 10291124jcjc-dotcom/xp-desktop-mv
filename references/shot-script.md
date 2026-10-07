# 镜头脚本格式（engine.js）

引擎加载 `index.html?script=shots/ch01.json,shots/ch02.json,…&scale=1`，把所有脚本合并成一份时间线，`drawFrame(t)` 只依赖这份时间线和 `analysis/` 里的 `beats.json`、`shots.json`、`rms.json`。

渲染：`tools/render.py` 起一个本地 HTTP 服务（项目根目录），用无头 Edge 逐帧调用 `Pinkdows.render(t)` 再截图。帧 `f` 对应 `t = f/30`，和原片帧号一一对应。

## 坐标和时间

- 坐标是 960×540 的逻辑像素，任务栏占底部 30（y = 510–540）。
- 时间可以写秒，或者写拍子引用：
  - `"bar:8"`：第 8 小节开头（第 0 小节 = 第一个底鼓重拍）
  - `"bar:8.25"`：第 8 小节第 2 拍（小数 = 拍 / 4）
  - `"bar:8.5-0.066"`：再偏移若干秒（点击前两帧按下之类）
  - `"b:23"`：全局第 23 拍
- 引擎把拍子引用对齐到最近的 30fps 帧，所以写在拍子上的硬切永远落在最近的那一帧。

## 顶层字段（每个 ch*.json 都可以有）

| 字段 | 说明 |
|---|---|
| `base` | 全屏底层，`[{t0,t1,type,…}]`。`type`：`boot`（`title`）、`welcome`（`users`、`userScale`、`hint`）、`desktop`、`screensaver` / `video`（`srcOffset` 或 `srcKeys` 把屏保拉伸到只用一个镜头）、`logoff`（`video`、`dim`、`msgKeys`、`showWindows`）、`shutdown`（`ubuntu` 时间点出现结尾小字） |
| `windows` | 窗口列表，见下 |
| `icons` | 桌面图标覆盖：同 `id` 的后一条替换前一条（`t0` 生效）。`morph:true` 变身时弹一下；`selectedFrom/selectedTo` 选中高亮 |
| `stickers` / `mattes` | 抠像图层，见下 |
| `ground` | 接触阴影椭圆 `{t0,t1,x,y,w,h,a}`，画在人物下面 |
| `balloons` | 托盘气泡 `{t0,t1,title,text,icon,textSize,bold,scale}` |
| `startmenu` | 开始菜单 `{t0,t1,user,avatar:{clip,frame},left:[{icon,label,sub}],hoverOff,pressOff}` |
| `overlays` | `assistant`（鼓棒助手：`x,y,scale,say,sayAt,button,hoverAt,press`）、`flash`、`text` |
| `clock` | `{t0,t1,blink:true}` 托盘时钟跟拍闪 |
| `taskExtras` | 任务栏里额外的按钮 `{t0,t1,label,x,w}`（比如躲进任务栏的"拒绝"） |
| `cursor` | `{keys:[{t,x,y,ease}], clicks:[t], hide:[[t0,t1]]}`；`ease`：`linear/in/out/inOut/back/step` |

## 窗口

公共字段：`id,type,t0,t1,x,y,w,h,title,icon,z`。

- `z` 越大越靠前；`zKeys:[{t,z}]` 随时间改层级（拖动时置顶）。最上层的窗口显示为激活色。
- `moves:[{t,x,y,w,h,ease}]` 拖动 / 最大化；`shake:[t…]` 在这些时间抖一下；`minimized:[[t0,t1]]` 最小化（开头 4 帧缩向任务栏）。
- `scale`：整窗放大（放梗的重点弹窗用 1.15–1.5）。
- `taskbar:false` 不进任务栏；`group:"APT."` 多个窗口在任务栏合并成"N APT."。
- 打开是不透明的 4 帧缩放，关闭是硬切（XP 没有半透明淡入淡出）。

按 `type`：

| type | 专有字段 |
|---|---|
| `media` | `srcOffset` 或 `srcKeys:[{t,ts}]`（源视频时间映射）、`playing`、`status` |
| `notepad` | 同上；视频区宽高比要设成歌词镜头自己的比例，`cover` 裁切 |
| `videocall` | `names`、`timerFrom`、`fit:'contain'`（保持原比例补黑边）、`pulse:[t…]`（画面在强拍上轻推）、`notes:[{t,t1,s}]`（底栏提示） |
| `terminal` | `fontSize`；`lines:[{prompt,chunks:[{t,s}],color,dimAt,flash}]`——每个 chunk 在拍子上整块出现 |
| `error` | `text`（字符串或多行数组）、`glyph`（`error/warn/question/info/camera`）、`buttonsList`、`default`、`hover:[{btn,t0,t1}]`、`press:[{btn,t}]`、`dodge:[{btn,keys:[{t,dx,dy}]}]`（会逃跑的按钮，可以逃出对话框） |
| `taskmgr` | `procs:[{t,name,cpu,mem,user,until,selFrom,killFrom,hl}]`（`cpu:'ramp'` 跟总 CPU 一起涨）、`cpuRamp:[t0,t1]`、`cpuFull`、`press:[{t}]`（结束进程按钮）、`status:[{t,t1,s}]` |

## 抠像图层

两种模式：

**整帧模式**（坐在任务栏上、跳舞的人）：`{t0,t1,clip,first,last,x,y,h,layer}`
- 帧号 = `round((t + srcOffset) * 30)`，夹在 `first..last` 之间，和音乐同步。
- `layer`：`back`（窗口后面）、`front`（窗口前面）、`top`（任务栏前面）。
- `groundY`：每帧把 alpha 最低点（膝盖、鞋底）对齐到这条线上，`sink` 再往下压几像素。
- `parts:[{x0,x1,dx,dy,bounce}]`：把源帧切成竖条分别偏移（例如把大鼓单独往下移到任务栏上，每拍弹一下）。
- `keys:[{t,x,y,h}]`：位置 / 大小动画（"冲到前面"）；`skip:[帧号]`：跳过不能用的帧；`bounce`：每拍缩放。

**贴纸模式**（头像轰炸）：加 `bbox:true`
- `x,y` 是主体中心，`h` 是主体高度；自动裁到 alpha 范围。
- `frame` 固定一帧（挑清晰、表情不同的帧），或 `freeze:true` 冻结在弹出那一刻。
- `stroke`：固定屏幕宽度的白色描边（逻辑像素），缩放后不会变细。
- `rot`、`shadow`、`pulseAt/pulseAmp`（全体同时放大一下）、`lift:[t0,t1]`（被鼠标拖起时放大加深投影）、`keys`（拖动路径，`ease:'back'` 弹回）。

## 生成器的写法（examples/apt/build.py）

- 时间一律用 `bar(k, off)` 生成字符串；需要秒数时用 `sec(k)`。
- `dialog_button(win, i, corner=True)` 算按钮在屏幕上的位置（已考虑 `scale`）；`corner=True` 让箭头停在按钮右下角，不挡字。
- `Cursor.click(t)` 会在点击时刻自动插一个"停住"关键帧，保证按下时鼠标还在按钮上。之前漏了这一步，鼠标会提前滑向下一个目标，审核时被抓到。
- `Cursor.wiggle(...)`：屏保唤醒、犹豫这类左右晃动。
- 所有梗文案写在生成器里，改完重跑 `build.py` 再渲染。
