# GitHub 更新操作 · 手把手

> 前提：你已经建好了仓库（假设叫 `douyin-resume-ext`）
> 本次更新：v1.0.0 → **v1.1.0**（修复"重进找不到原视频"）

---

## 一、先搞清楚这次改了哪几个文件

一共 **4 个文件**有变化：

| 文件 | 状态 | 说明 |
|---|---|---|
| `content.js` | **已修改** | 核心 bug 修复 |
| `manifest.json` | **已修改** | 版本号 1.0.0 → 1.1.0 |
| `README.md` | **已修改** | 加了更新日志 + 排查问题章节 |
| `调试指南.md` | **新增** | 之前没有这个文件 |

**没变的**：`content.css`、`LICENSE`、`.gitignore`、`icons/`、`.github/`

---

## 二、更新方法（选一种）

### 方法 A：网页直接改（最省事，推荐）

**适合：改动文件少的情况。**

#### 更新 `content.js`（最重要的一个）

1. 打开你的仓库主页
2. 点进 `content.js`
3. 点右上角的 **✏️ 铅笔图标**（Edit this file）
4. **全选**（Ctrl+A）→ **删除** → 把本地新的 `content.js` 内容**全部粘贴进去**
5. 拉到底部，Commit changes 填：`fix: 修复重进找不到原视频的问题`
6. 点 **Commit changes**

> 文件比较大（19KB），网页粘贴可能会卡一下，耐心等。

#### 更新 `manifest.json`

同样操作，改版本号那行：`"version": "1.1.0"`

#### 更新 `README.md`

同样操作，粘贴新的 README 内容。

#### 新增 `调试指南.md`

1. 仓库主页点 **Add file** → **Create new file**
2. 文件名填 `调试指南.md`
3. 粘贴内容
4. Commit

---

### 方法 B：拖拽上传（文件多的话更快）

1. 仓库主页点 **Add file** → **Upload files**
2. 把本地这 4 个文件（`content.js`、`manifest.json`、`README.md`、`调试指南.md`）**一起拖进去**
3. 下面 Commit changes 填说明
4. 点 Commit

> ⚠️ 拖拽时如果文件夹里已有同名文件，GitHub 会**直接覆盖**，这是我们要的效果。

---

### 方法 C：如果用 GitHub Desktop（最规范）

如果你电脑上装了 GitHub Desktop：

1. 把仓库 Clone 到本地
2. 把新的 4 个文件**替换**进去
3. Desktop 里会自动显示变更
4. 填 commit message → Commit → Push

**以后都用这个方式最省事。**

---

## 三、建议：打个 Tag（可选，但显得专业）

更新完之后，给这个版本打个标签：

1. 仓库主页右侧找 **Releases** → 点 **Create a new release**
2. **Choose a tag** 填：`v1.1.0`
3. **Release title** 填：`v1.1.0 修复重进找不到原视频`
4. **描述**填（复制用）：

```
修复「重进之后找不到原视频」的问题。

修复内容：
- 存记录时改存干净的详情页地址，不再存带参数的推荐流地址
- 新增 aweme_id 识别，避免首页刷到的视频互相覆盖
- 续看改为跨页面传递，跳转后能正确续播
- 启动时自动修复旧记录
- 新增 SPA 路由监听
```

5. 点 **Publish release**

**好处**：GitHub 上会显示一个版本记录，别人一看就知道你在维护。**面试官看仓库也看这个。**

---

## 四、更新完检查一下

打开仓库主页，确认：

- [ ] `content.js` 显示的是新内容
- [ ] `manifest.json` 里版本号是 `1.1.0`
- [ ] 多了 `调试指南.md` 这个文件
- [ ] README 里有「更新日志」这一段
- [ ] （可选）Releases 里有 v1.1.0

---

## 五、本地文件位置（复制粘贴用）

```
E:\douyin-resume-ext\content.js        ← 改过的
E:\douyin-resume-ext\manifest.json     ← 改过的（版本号）
E:\douyin-resume-ext\README.md         ← 改过的（加了更新日志）
E:\douyin-resume-ext\调试指南.md        ← 新增的
```

如果嫌一个个复制麻烦，用这个打包好的压缩包解压后一起拖：

```
E:\douyin-resume-ext-upload.zip
```
