# GitHub 更新 · 逐点击流程（v1.3.0）

> 你的浏览器：**Edge**
> 你的仓库：**https://github.com/zhangsan7891/douyin-resume-ext**
> 本次目标：把 v1.2.1 → **v1.3.0** 的更新传上去
>
> ⚠️ 这次**多了两个新文件**（`early.js`、`inject.js`）。漏传会导致扩展直接跑不起来。

---

# 第 0 步：先看明白差在哪（不用操作，看一眼就行）

## 你仓库现在有什么（我刚查过）

| 文件 | 仓库里 | 本地最新 | 要传吗 |
|---|---|---|---|
| `content.js` | 24766 | **38095** | ✅ 要 |
| `manifest.json` | 690 | **1050** | ✅ 要 |
| `README.md` | 7265 | **12662** | ✅ 要 |
| `content.css` | 3797 | **4197** | ✅ 要 |
| `调试指南.md` | 2951 | **5505** | ✅ 要 |
| `GitHub更新操作.md` | 10420 | **12260** | ✅ 要 |
| **`early.js`** | **没有** | 981 | 🆕 **新建** |
| **`inject.js`** | **没有** | 5440 | 🆕 **新建** |
| `LICENSE` | 1066 | 1066 | 不用（没变） |
| `icons/` | 有 | 有 | 不用（没变） |
| `.github/` | **没有** | 有 | 可选 |

**结论：7 个文件要传，其中 2 个是全新文件。**

## 别担心传错

GitHub 会**逐字节比对**。内容没变的文件（`LICENSE`、`icons/`）即使你一起拖上去，
Git 也会判定"无变化"，**根本不会进这次提交**。

**所以最简单也最稳的做法是：整个文件夹全选，一次全拖上去。**

---

# 第 1 步：打开上传页面

## 1.1 打开 Edge

## 1.2 地址栏输入下面这行，按 **回车**

```
https://github.com/zhangsan7891/douyin-resume-ext
```

## 1.3 确认你看到什么

页面顶部应该显示 **`zhangsan7891 / douyin-resume-ext`**，并带一个 **Public** 小标签。

**如果显示的是登录页** → 先登录你的 GitHub 账号（`zhangsan7891`），再回到这个网址。

## 1.4 找到「Add file」按钮

在文件列表的**右上方**，有一个深灰色的按钮，写着 **`Add file`**（旁边还有个向下的小三角）。

**点它** → 会弹出两个选项：

```
Create new file
Upload files
```

**点「Upload files」**。

> 找不到 Add file？确认你已经登录，并且这个页面上方没有黄色提示条。

---

# 第 2 步：把文件拖进去

## 2.1 打开文件夹窗口

1. 按键盘 **Win + E**（打开文件资源管理器）
2. 在**地址栏**（最上面那条）输入下面这行，按**回车**：

```
E:\douyin-resume-ext
```

## 2.2 先做一件事：显示隐藏文件

因为 `.gitignore` 和 `.github` 是以点开头的，Windows 默认**看不见**。

在资源管理器顶部点：**查看** → 把 **「隐藏的项目」** 前面的勾打上

> Win11 的话：「查看」→「显示」→「隐藏的项目」

## 2.3 全选

点一下文件夹里任意空白处，然后按 **Ctrl + A**（全选）。

**应该选中这些：**

```
📄 .gitignore
📄 content.css
📄 content.js
📄 early.js          ← 新增
📄 GitHub更新操作.md
📄 inject.js         ← 新增
📄 LICENSE
📄 manifest.json
📄 README.md
📄 调试指南.md
📁 .github
📁 icons
```

**数一下：10 个文件 + 2 个文件夹。** 少了就是没选全，重新 Ctrl + A。

## 2.4 拖过去

1. 把**浏览器窗口**和**文件夹窗口**并排放（或者让浏览器占大半屏，文件夹窗口拖到右下角）
2. 按住选中的文件，**拖到浏览器页面中间那个虚线框里**
3. 看到虚线框变色、出现 **「Drop your files here」** 的字样时**松手**

## 2.5 等它传完

页面下方会出现文件列表，每个文件名旁边有个进度条。

**传完后**，文件名左侧会变成一个绿色的对勾 ✅。

> ⚠️ 如果文件列表里出现橙色/红色的提示（比如 `content.js already exists`），
> **不用管**，GitHub 会自动覆盖 —— 这正是我们要的。

---

# 第 3 步：填写提交信息

## 3.1 拖到页面最底部

找到 **「Commit changes」** 区域（外面有个灰色边框的方框）。

## 3.2 上面的短输入框

框里默认写着 `Add files via upload`，**把它删掉**，改成：

```
feat: 改用接口拦截识别视频，修复首页推荐流不记录
```

## 3.3 下面的长输入框（写着 "Add an optional extended description..."）

点进去，粘贴这段：

```
- 新增 inject.js：注入页面主世界，只读截获抖音 /aweme/v1/ 接口响应，
  从中提取 aweme_id / 文案 / 作者
- 新增 early.js：在 document_start 注入，避免错过第一批请求；
  content.js 启动后主动补拉历史数据
- 用视频文案做桥梁：DOM 读文案 → 在接口数据里匹配 → 换回真实视频 ID
- 修复首页推荐流完全无法识别的问题：
  URL 永远是 ?recommend=1、video.src 是随机 blob、DOM 上不挂视频 id
- 记录门槛从 90 秒降到 30 秒
- 诊断报告新增「接口数据」与「DOM 侦察」两段
```

## 3.4 确认下面的单选按钮

选 **「Commit directly to the `main` branch」**（通常默认就是它）。

## 3.5 点绿色按钮

点 **「Commit changes」**。

**完成。** 页面会自动跳回仓库主页。

---

# 第 4 步：验证（一定要看）

回到仓库主页，确认这 4 点：

- [ ] 文件列表里出现了 **`early.js`** 和 **`inject.js`** ← **最关键**
- [ ] 点进 `manifest.json`，看到 `"version": "1.3.0"`
- [ ] 点进 `content.js`，文件大小是 **38095 Bytes**（页面上会显示）
- [ ] 往下滚 README，能看到 **### v1.3.0** 这段更新日志

**只要 `early.js` 和 `inject.js` 在，就算成功。**

---

# 第 5 步：打个版本标签（建议做，约 1 分钟）

**为什么做**：GitHub 右侧会显示版本记录，别人（包括面试官）一看就知道你在认真维护。

## 5.1 找到 Releases

仓库主页 **右侧栏**，找到 **「Releases」**，点右边的小字 **「Create a new release」**。

## 5.2 填 tag

**Choose a tag** 输入框里填：

```
v1.3.0
```

填完后下方会出现绿色小字 **「Create new tag: v1.3.0 on publish」**，**点它**。

## 5.3 填标题

**Release title** 填：

```
v1.3.0 改用接口拦截，首页推荐流可以记了
```

## 5.4 粘贴说明

**Describe this release** 大输入框里粘贴：

```
修复「首页推荐流里完全记不到视频」的问题。这是架构级改动。

根因：
首页推荐流（douyin.com/?recommend=1）里，三条常规识别路径全部走不通——
1. URL 永远停在 ?recommend=1，滑动切换视频时地址栏不变
2. video.src 是 blob:https://www.douyin.com/<随机UUID>，每次加载页面都重新生成
3. 视频卡片的 DOM 上不挂 aweme_id，也没有 /video/ 链接
所以光靠 DOM 和 URL，物理上拿不到任何视频标识。

修复：
- 新增 inject.js：注入页面主世界，只读地截获抖音自己的 /aweme/v1/ 接口响应，
  提取 aweme_id / 文案 / 作者（不发任何网络请求，不修改页面行为）
- 新增 early.js：在 document_start 就注入，避免错过第一批请求；
  content.js 启动后主动补拉一次历史数据
- 用视频文案做桥梁：DOM 上读文案 → 在接口数据里匹配 → 换回真实 ID
- 记录门槛从 90 秒降到 30 秒
- 诊断报告新增「接口数据」与「DOM 侦察」两段
```

## 5.5 发布

点绿色按钮 **「Publish release」**。

---

# 附录 A：如果拖拽不灵（网页逐个改）

**适合情况**：拖拽没反应、浏览器不支持。

**改已有文件**（`content.js`、`manifest.json`、`README.md`、`content.css`、`调试指南.md`、`GitHub更新操作.md`）：

1. 仓库主页点进要改的文件（比如 `content.js`）
2. 点右上角的 **✏️ 铅笔图标**（鼠标悬停会显示 "Edit this file"）
3. 页面变成编辑器。**全选**（Ctrl + A）→ **删光**（Delete）
4. 用记事本打开本地文件（`E:\douyin-resume-ext\content.js`）→ **Ctrl + A 全选 → Ctrl + C 复制**
5. 回到浏览器 → **Ctrl + V 粘贴**
6. 拉到底部，Commit changes 填 `feat: 改用接口拦截识别视频` → 点 **Commit changes**

> ⚠️ **必须整篇替换，不能只贴改动的那几行**，只贴片段会把文件搞坏。
> `content.js` 有 38KB，粘贴时浏览器卡一两秒是正常的，别以为死机了。

**新建文件**（`early.js`、`inject.js`）：

1. 仓库主页点 **Add file** → **Create new file**
2. 文件名那里填 `early.js`
3. 大编辑框里粘贴内容
4. 拉到底部 → 点 **Commit changes**
5. 再重复一次，建 `inject.js`

---

# 附录 B：如果用 GitHub Desktop（以后最省事）

1. 装 [GitHub Desktop](https://desktop.github.com/)，用 `zhangsan7891` 登录
2. 仓库主页点绿色 **Code** 按钮 → **Open with GitHub Desktop**
3. 选一个本地目录克隆下来（比如 `E:\github\douyin-resume-ext`）
4. 把 `E:\douyin-resume-ext` 里的文件**全部复制覆盖**到克隆出来的目录
5. 打开 GitHub Desktop，左侧会自动列出变更文件
6. 左下角 **Summary** 填：`feat: 改用接口拦截识别视频`
7. 点 **Commit to main**
8. 点右上角 **Push origin**

**以后每次更新都走这个流程，是最规范的。**

---

# 附录 C：常见卡住的地方

| 情况 | 原因 | 怎么办 |
|---|---|---|
| 找不到 `Add file` 按钮 | 没登录 / 没进对页面 | 确认网址是 `github.com/zhangsan7891/douyin-resume-ext`，且已登录 |
| 拖进去只有几个文件 | `.gitignore`、`.github` 是隐藏的，没选中 | 资源管理器「查看」→ 勾「隐藏的项目」 |
| 提示 `already exists` | 正常，会覆盖 | 不用管 |
| 传完发现少了 `early.js` | 拖漏了 | 单独再拖一次那个文件 |
| 网页编辑器粘贴后格式乱 | 粘贴了片段而非全文 | 重新整篇替换 |
| 想撤销这次提交 | — | 仓库主页点 **Commits** → 找到那次 → 点 **Revert** |

---

# 附录 D：上传完，本地要做什么

1. 打开 `edge://extensions`
2. 找到「抖音续看」→ 点 **🔄 刷新**
3. 确认版本号变成 **1.3.0**
4. **如果功能异常**：移除扩展，再「加载解压缩的扩展程序」重新选 `E:\douyin-resume-ext`
5. 刷新抖音页面 → 点悬浮球 → **诊断** → 看「累计收到 aweme」是不是大于 0
