---
name: xp-desktop-mv
description: 把一段 MV / 音乐视频剪辑重做成"粉色（或任意配色）Windows XP 桌面录屏"：人物从原片抠出来在桌面、窗口、任务栏上唱跳，所有界面用代码画，每次点击、弹窗、切换都卡在节拍上，界面文案里埋科技圈双关梗。一条龙完成节拍分析、镜头/黑边检测、BiRefNet 抠像、canvas 桌面引擎、按章写镜头脚本、子 Agent 美术总监审核循环、1080p 渲染与自检。只要用户提到把 MV / 歌曲片段 / 音乐视频做成 XP 桌面、Windows 录屏风格、"BLISS 那种"、桌面跳舞小人、报错弹窗轰炸、用代码画操作系统界面配音乐，或者拿来一个 BRIEF.md 说"按步骤做、每个检查点停下来"，就用这个 skill，哪怕没说 XP 或 skill。Turn a music-video clip into a beat-synced Windows XP desktop screen recording with code-drawn UI and cut-out performers.
---

# XP 桌面 MV 重制

把一段 MV 剪辑（几十秒）重做成"XP 桌面录屏"：原片里的人被抠出来，坐在任务栏上、贴满桌面、被报错框淹没；原片画面放进媒体播放器、记事本、视频通话窗口里同步播放；所有界面元素用 JavaScript + canvas 画出来，`drawFrame(t)` 是时间 t 的纯函数，可以任意跳帧重渲染。

参考作品是 @anabology 的 BLISS。第一次完整做出来的成品见 `examples/apt/`（APT. → Pinkdows XP，40.8 秒，约 2 小时、一个 Max 5 小时额度窗口的 26%）。

## 这个 skill 里有什么

| 路径 | 内容 | 什么时候读 |
|---|---|---|
| `scripts/` | 全部工具脚本（节拍、镜头、抠像、渲染、拼图、编码、自检） | 开工时整体复制到项目的 `tools/` |
| `engine/` | Pinkdows XP 桌面引擎（`engine.js` + `index.html`） | 开工时复制到项目的 `engine/` |
| `references/brief-template.md` | 给导演填的 BRIEF 模板（梗规则、镜头表、检查点） | 用户没有 BRIEF 时，先用它和用户一起写 |
| `references/shot-script.md` | 镜头脚本 JSON 格式、引擎支持的全部组件和字段 | 写 `shots/build.py` 之前 |
| `references/art-director.md` | 美术总监子 Agent 的提示词模板和打分规则 | 阶段四审核循环 |
| `references/pitfalls.md` | 第一次制作踩过的坑和对应解法 | 每个阶段开始前扫一眼对应小节 |
| `examples/apt/` | 完整实例：BRIEF、分镜生成器 `build.py`、定稿分镜、三轮审核记录、对比视频 | 写自己的 `build.py` 时照着改 |

## 工作方式

**按阶段做，每个检查点停下来给导演（用户）看。** 导演的意见通常很短（"继续""第 6 章要""贴纸乱贴"），拿不准的地方先做一个版本给他看，不要停下来问。每个检查点都把图/视频用文件发送工具发给用户，用户可能不在电脑前。

**所有文件都写在项目文件夹里**，包括 Python 虚拟环境、pip 缓存、抠像模型、Playwright 的临时目录。往项目外写文件会触发权限确认，整条流程可能因此停很久。`scripts/env.ps1` 把这些路径都指到项目里，每条命令前先 `. .\env.ps1`。给子 Agent 的提示词里也要写明"只读不写"。

**不下载任何素材**（图片、音效、字体），只装 Python 包和抠像模型。不用真实的 Windows logo / 旗标 / 系统音效：系统和公司名用戏仿（Pinkdows XP、Macrosoft），"开始"按钮用和 MV 呼应的图形。

**不写歌词。** 需要歌词的地方用原片自带的歌词画面。梗只放在界面文案里。

## 项目结构

```
project/
  BRIEF.md  source.mp4  env.ps1
  .venv/  .cache/  .tmp/  models/      ← 全部在项目内
  analysis/   节拍、镜头、黑边、响度、预览、审核拼图
  clips/src/  原片 30fps 全部帧（引擎播放窗口视频用）
  clips/<名>/ 需要抠像的片段帧（按全局帧号命名 f%05d.png）
  mattes/<名>/raw/  BiRefNet 原始 alpha；mattes/<名>/  清理后的 RGBA
  engine/     桌面引擎
  shots/      build.py → ch01.json … chNN.json，storyboard.md
  tools/      scripts/ 里的工具
  render/     成片帧；render/preview/ 960×540 预览帧
  out/        成片、手机版、拼图
```

## 阶段 0：环境

```powershell
python -m venv .venv
. .\env.ps1
python -m pip install librosa soundfile numpy pillow opencv-python matplotlib playwright "rembg[cpu]"
# 有 NVIDIA 显卡：换成 GPU 运行库（CUDA 库从 pip 装进 .venv，不用装系统 CUDA）
python -m pip uninstall -y onnxruntime; python -m pip install "onnxruntime-gpu[cuda,cudnn]"
```

- 渲染用 **Python 版 Playwright + 本机 Edge**（`channel="msedge"`），不下载 Chromium，也不需要 Node。
- ffmpeg 需要已在 PATH 里。
- 项目路径有中文时，OpenCV 的 `imread/imwrite` 会失败，脚本里已经改用 `imdecode/imencode`；自己写新脚本时也要这样做。

## 检查点 0：梗库和分镜

梗比画面重要。BLISS 能火，靠的是界面和科技热点的双关。先找到这首歌的主梗（APT. = Linux 的 `apt` 命令），然后：

1. 列至少 20 条候选梗，每条标"秒懂 / 要想一下 / 看不懂"，只用秒懂的。
2. 每次出现的文字不超过 12 个汉字或 24 个英文字符。
3. 梗要卡在强拍上：报错弹出、终端回车、气泡出现。
4. 对照源视频每秒一帧的拼图提分镜调整。常见要调的：某一段动作太挤（按 1 拍 ≈ 0.4 秒去数，每个动作至少一拍）、结尾太赶、屏保/视频窗口会露出下一个镜头。

## 阶段一：分析（→ 检查点 1）

```powershell
python tools\beats.py      # analysis/beats.json + beats.png + beat_zoom.png（顺带抽出 audio.wav）
python tools\prep.py       # 镜头切点 scenes.txt、响度 rms.json、原片 30fps 全部帧 clips/src/
python tools\shots.py      # 每个镜头的黑边 → analysis/shots.json
python tools\grid.py       # analysis/grid.jpg，每秒一帧带时间码和小节/拍
```

- **节拍一定要按底鼓拟合，不要直接用 librosa 的 beat tracker。** 它会漂（第一次实测 147.8 BPM，40 秒内偏 ±50ms），`beats.py` 先用 tracker 估速度，再在半拍网格上拟合底鼓起音，最后用军鼓判断小节第一拍。看 `beat_zoom.png` 的开头、中间、结尾三段，网格线应该压在鼓的起音上。
- **黑边常常是深灰不是纯黑**（RGB 约 19），cropdetect 的 `limit` 要调到 40 以上，而且逐帧检测取中位数，否则手写歌词压到黑边上会把裁切框撑开。
- `rms.json` 给任务管理器的 CPU 曲线、视频通话的音量条用；`clips/src/` 是引擎在窗口里播放原片的帧源。
- 容器标的帧率可能是虚的（第一次标 59.94，实际 30fps）。

## 阶段二：抠像（→ 检查点 2）

1. 在 `tools/clips.py` 的 `CLIPS` 里列出要抠的片段（源时间范围），运行它导出帧。
2. `matte_compare.py` 先在几张代表帧上比较模型。**BiRefNet 通常最好**（身体实心、腿和脚完整、两个人都抠得出来），isnet / u2net_human_seg 容易在黑皮衣、腿上抠出洞。BiRefNet 在 CPU 上约 12 秒一帧，GPU（RTX 3060）约 1.5 秒。
3. `matte_raw.py` 只跑一次模型，存原始 alpha；之后清理怎么反复调都不用再跑模型。
4. `matte_clean.py` 的 `CFG` 按片段写保留区域和参数（这部分每个项目都要改）：
   - 保留区域：多边形 / 椭圆挖掉镜头里不要的东西（后面的鼓手、镲片）。**不要用直线硬切**，会在头发上切出直角缺口。
   - 镜头在动时用按关键帧移动的分割线 + `open`（开运算断开细支架）+ 连通区域筛选。
   - `lo`：去掉运动模糊里那层淡粉色的雾；`band/spill`：边缘去粉的宽度和强度；`global_spill`：整个人都被粉光染色时（比如金发）全身往中性拉。
   - 头像加 `stroke` 白描边做剪纸贴纸感。
5. `matte_sheet.py` 出棋盘格 / 深色底对比图；再在原尺寸下放大看头发和边缘。

抠像的局限要如实告诉导演：原片里的动态模糊、甩头盖住脸，抠像只能如实保留；可以用界面元素（对话框）挡住。

## 阶段三：桌面引擎（→ 检查点 3）

`engine/engine.js` 已经包含：粉色 Luna 主题、程序化 Bliss 壁纸（山坡、积云、草地颗粒）、开机 / 欢迎 / 注销 / 关机 / 屏保全屏画面、窗口（媒体播放器、记事本、终端、错误对话框、任务管理器、视频通话）、任务栏（开始按钮、窗口按钮、合并分组按钮、托盘时钟）、托盘气泡、开始菜单、鼓棒助手（Office 助手戏仿）、抠像图层（同步播放 / 冻结帧贴纸 / 落地对齐 / 分段偏移）、鼠标。

- 桌面按 960×540 逻辑尺寸布局，放大 2 倍渲染到 1920×1080。放梗的文字比原版 XP 大一号，重点弹窗再放大 1.15–1.5 倍，手机上才读得清。
- 换配色：改 `C` 主题常量、壁纸渐变和 `icon()` 里的颜色。换歌：开机标题 `base.title`、用户名、"开始"按钮图形。
- 先写一个 `shots/_stills.json` 渲染 5 张静帧（开机、桌面、播放器、报错、关机）给导演看配色和质感：
  `python tools\render.py --script shots/_stills.json --times 0.5,1.5,2.5,3.5,4.5 --names 1_boot,2_desktop,3_media,4_error,5_shutdown --out analysis/stills`

字段和组件的完整说明见 `references/shot-script.md`。

## 阶段四：分章制作 + 美术总监审核（→ 检查点 4）

1. **用 Python 生成镜头脚本**，不要手写 JSON：`shots/build.py` 产出 `ch01.json…`，时间一律写成拍子引用（`bar:K` = 第 K 小节开头，小数 = 拍/4，可带 `±秒`），引擎会换算并对齐到帧。几何辅助函数（对话框按钮中心、标题栏抓取点、图标中心）和引擎布局保持一致，鼠标才能精确落在按钮上。照着 `examples/apt/build.py` 改。
2. 渲染 960×540 预览：`python tools\render.py --script "shots/ch01.json,…" --start 0 --end <时长> --scale 0.5 --fmt jpeg --out render/preview`（约 0.03 秒一帧）。
3. 每章出每 0.25 秒一帧的拼图：`python tools\contact.py --frames render/preview --start A --end B --step 0.25 --out analysis/review/chNN_rK.jpg`。
4. **审核前自己先看一遍拼图**，把明显的 bug 修掉（露出下一个镜头、帧号越界、东西重叠），别浪费一轮审核。
5. 每章派一个全新的美术总监子 Agent（并行），提示词模板在 `references/art-director.md`。它只看 BRIEF、`shots/storyboard.md` 和拼图，5 项打分，写出哪一帧、什么问题、怎么改。
6. 改完再派新的美术总监复核。通过线：平均 ≥ 8 且单项不低于 6，最多 3 轮。3 轮不过就停，把剩下的问题和需要拍板的取舍交给导演。
7. 分数和意见记在 `review_log.md`；审核意见里不成立的（比如在 960 预览里把白字看成灰字）要复核后写明。
8. 每轮改动同步更新 `shots/storyboard.md`，下一轮的美术总监以它为准。
9. 检查章与章的衔接：每个切点前后各看 3 帧。
10. 出 480p 草稿（`tools/encode.py --height 480`）给导演看节奏。

**关于审核结果的预期**：每轮换新人，标准会浮动，后一位可能推翻前一位（"脸不要互相遮挡" → "太整齐像壁纸"）。遇到互相矛盾的意见，不要来回改，记下来交给导演选方向。

## 阶段五：音效（可选）

主音轨永远是原片原声，不做任何改动。界面音效（点击"嗒"、弹窗"叮咚"、报错"咚"）用代码合成，音量比原声低约 12dB。先做无音效版，导演看过草稿再决定。

## 阶段六：渲染与检查（→ 检查点 5）

```powershell
python tools\render.py --script "shots/ch01.json,…" --start 0 --end <时长> --scale 1 --fmt png --out render   # 约 0.14 秒一帧
python tools\encode.py --frames render --out out/APT_XP_v1.mp4 --crf 16
python tools\qa.py      # 时长、音轨对齐、成片硬切点对照节拍、out/contact_sheet.jpg
```

- 只改了某一段时，只重渲染那一段的帧再重新编码。
- 自检清单：时长与原片一致；音轨偏移 0；成片里的硬切点和节拍偏差在一帧以内（窗口最大化这类带动画的切换会偏一点，正常）；窗口里的视频没被拉伸；没有真实 Windows 标志。
- 成片 1080p 往往 20MB 以上，用户在手机上可能加载不了，另压一个 720p 手机版一起发。

## 交付时告诉导演

用时、各章最终分数、哪些意见复核后不成立、哪些是素材本身的局限、哪些取舍需要他拍板。用量可以用会话用量工具读 5 小时 / 每周额度百分比；token 只报能确认的部分，不编累计数。
