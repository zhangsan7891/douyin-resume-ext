# GitHub 更新 · 从零开始的详细步骤

> 这次要更新的是 **v1.2.0**：展示格式改为 `作者名《视频标题》`
> 你的浏览器是 Edge，下面所有操作都在 Edge 里做

---

# 第 0 步：你的仓库情况（已确认）

我已经查过了，你的仓库**已经建好，并且已经传了 v1.1.0 的文件**：

```
仓库地址：https://github.com/zhangsan7891/douyin-resume-ext
分支：main
公开：是
许可证：MIT
```

**仓库里现在的文件（v1.1.0 状态）：**

| 文件 | 远程大小 | 说明 |
|---|---|---|
| `content.js` | 19315 字节 | 旧的，要更新 |
| `manifest.json` | 669 字节 | 旧的，版本号还是 1.1.0 |
| `README.md` | 5701 字节 | 旧的 |
| `content.css` | 3797 字节 | 没变，不用管 |
| `调试指南.md` | 1840 字节 | 没变，不用管 |
| `GitHub更新操作.md` | 3813 字节 | 可选更新（本地已扩写） |
| `icons/` | — | 没变 |
| `.github/` | **缺失** | 上次没传上去，不影响使用 |

**所以可以直接跳到【第 1 步】。**

> 顺带说明：`.github` 文件夹（里面是 Issue 模板）上次没传上去，因为以点开头的文件夹在 Windows 资源管理器里默认隐藏。要不要补传随你，不补也完全能用。

---

# 第 1 步：搞清楚要改哪几个文件

这次一共改了 **3 个文件**（必改）：

| 文件 | 变化 |
|---|---|
| `content.js` | 主要改动（作者名提取 + 展示格式） |
| `manifest.json` | 版本号 1.1.0 → 1.2.0 |
| `README.md` | 更新日志加了 v1.2.0 |

**可选更新 1 个**：

| 文件 | 变化 |
|---|---|
| `GitHub更新操作.md` | 扩写成了详细教程（就是本文档） |

**不用动**：`content.css`、`LICENSE`、`调试指南.md`、`icons/`

**文件在电脑的哪里：**

```
E:\douyin-resume-ext\content.js
E:\douyin-resume-ext\manifest.json
E:\douyin-resume-ext\README.md
```

---

# 高频疑问：能不能「全部文件一起传」，不用挑？

**可以，而且推荐这么干。** 不用挑那 3 个，整目录全传是安全的。

**为什么安全**：GitHub 上传时，Git 会逐字节比对文件内容——

- 内容变了 → 出现在本次提交里
- 内容没变（比如 `content.css`、`LICENSE`、`icons/`）→ 判定为「无变化」，**不会进提交**，不污染历史

所以你全选丢进去，最终那一笔提交里**只会显示真正改动的几个文件**，跟你精挑细选的结果一模一样，但省事得多、也不容易漏。

**唯一要注意的两件事：**

1. `.github` 是隐藏文件夹（以点开头），Windows 资源管理器默认看不见。
   要传它，先在资源管理器里点：**查看 → 显示 → 勾上「隐藏的项目」**。
   （不传也不影响插件使用，只是少了 Issue 模板）
2. `icons` 是普通文件夹，可以一起拖，GitHub 网页认文件夹。

**结论：Ctrl+A 全选 → 全部拖进去 → 写一句 commit → 提交。最省事、最不容易漏。**

---

# 另一种方式：在网页上「复制粘贴内容」

如果你不想拖文件，也可以在网页上直接改内容：

1. 进仓库 → 点开要改的文件（比如 `content.js`）
2. 点右上角 **✏️ 铅笔**（Edit this file）
3. **Ctrl + A 全选** → **Delete 删光**
4. 打开本地同名文件（记事本 / VS Code）→ **Ctrl + A 全选** → **Ctrl + C 复制** → 粘进网页
5. 底部填写 commit 说明 → 点绿色 **Commit changes**

⚠️ **关键：必须「全量替换」，不能只贴改动的那几行。** 只贴片段会把文件搞坏。

补充两点：

- 这种方式**只能改已有文件**，不能新建文件（新建要用 **Add file → Create new file**）
- `content.js` 有 20KB，粘贴时浏览器会卡 1~2 秒，是正常的，别以为死机了

---

# 第 2 步：上传（推荐用拖拽，最简单）

## 2.1 打开上传页面

1. 打开你的仓库主页
   ```
   https://github.com/zhangsan7891/douyin-resume-ext
   ```
2. 在文件列表**右上方**找到 **Add file** 按钮，点它
3. 弹出菜单里选 **Upload files**

> 如果看不到 Add file：确认你登录的是 `zhangsan7891` 这个账号。

## 2.2 拖文件进去

1. 打开文件资源管理器（Win + E）
2. 地址栏输 `E:\douyin-resume-ext`，回车
3. 选中这 3 个文件：
   - 点一下 `content.js`
   - 按住 **Ctrl** 再点 `manifest.json`
   - 按住 **Ctrl** 再点 `README.md`
4. 把这 3 个文件**拖到浏览器页面中间那个虚线框里**

**拖进去之后**，页面下方会列出这 3 个文件名。确认一下是不是这 3 个。

## 2.3 确认覆盖

如果文件列表里显示 `content.js already exists`（已存在）之类的小字，**不用管**，GitHub 会直接覆盖成新的——这正是我们要的。

## 2.4 提交

1. 拖到底部，找到 **Commit changes** 区域
2. 上面那个**短输入框**填这一行：

```
feat: 展示格式改为 作者名《视频标题》
```

3. 下面的**长输入框**（可选）填：

```
- 新增作者昵称提取
- 标题优先取视频描述，避免混入作者名
- 列表与续看提示改为 作者名《视频标题》
- 标题/作者抓取加缓存，避免频繁扫 DOM
```

4. 点绿色的 **Commit changes** 按钮

**完成。** 回到仓库主页，点进 `content.js`，看内容是不是新的。

---

# 第 3 步：验证一下

在仓库主页确认这几点：

- [ ] `content.js` 文件大小变成 **21233 字节**（原来 19315）
- [ ] 点进 `manifest.json`，看到 `"version": "1.2.0"`
- [ ] 往下滚 README，能看到 **## 更新日志** 里有 **### v1.2.0**
- [ ] 仓库右侧的提交记录里，有"feat: 展示格式改为…"这一条

---

# 第 4 步：打版本标签（可选，但强烈建议）

**为什么要做**：GitHub 上会显示一个版本号，别人一看就知道你在认真维护。**面试官看仓库也会看这里。**

1. 在仓库主页**右侧栏**找到 **Releases**
2. 点 **Create a new release**
3. **Choose a tag** 输入框填：

```
v1.2.0
```

4. 填完后下面会出现 **Create new tag** 的提示，点它确认
5. **Release title** 填：

```
v1.2.0 展示格式改为 作者名《视频标题》
```

6. **Describe this release** 大输入框，粘贴：

```
记录与提示改为显示 作者名《视频标题》，更好辨认是哪条视频。

- 新增作者昵称提取（data-e2e 选择器 → 页面内联数据 nickname）
- 标题改为优先取视频描述，不再被 og:title 混入作者名
- 列表项、续看提示均按 作者名《视频标题》 展示
- 标题/作者只在切换视频时抓取一次（带缓存），避免每 4 秒扫 DOM
- 旧记录无作者字段时显示为 《视频标题》，重新看一次即可补全
```

7. 点绿色按钮 **Publish release**

---

# 方式二：给我一个临时令牌，我全自动更新

**适合**：你懒得手动传，或者以后想让我随时帮你更新。

## 步骤

1. 打开 https://github.com/settings/personal-access-tokens/new
2. **Token name** 填：`临时更新用`
3. **Expiration** 选：**7 days**（或最短的那个）
4. **Repository access** 选 **Only select repositories** → 勾选 `douyin-resume-ext`
5. 展开 **Repository permissions**，找到 **Contents**，右边下拉选 **Read and write**
6. 拉到底点 **Generate token**
7. 页面上会出现一串 `github_pat_` 开头的字符，**复制它**，发给我
8. 我立刻用它把 3 个文件推上去，推完告诉你
9. **你去 https://github.com/settings/tokens 把这串删掉**（或等 7 天自动过期）

## 安全说明

- 这个令牌**只能动这一个仓库**、**只能改文件内容**，不能删仓库、不能改设置
- 有效期你自己定，最短 1 天
- 用完立刻删，删了就失效
- 我不需要它做别的事，就是推这一次

> 如果你觉得给令牌不放心，就用手动拖拽，效果完全一样。

---

# 附录：如果拖拽怎么都不行

## 用网页直接改单个文件

1. 仓库主页点进 `content.js`
2. 点右上角的 **铅笔图标**（鼠标移上去显示 "Edit this file"）
3. 页面里**全选**（Ctrl + A）→ **删除**
4. 用记事本打开 `E:\douyin-resume-ext\content.js`，**全选 → 复制**
5. 回到浏览器，**粘贴**
6. 拉到底部，Commit changes 填说明，点提交

`manifest.json` 更简单——网页上直接把 `"version": "1.1.0"` 改成 `"version": "1.2.0"` 就行。

## 用 GitHub Desktop（要装软件，但以后最省事）

1. 下载安装 https://desktop.github.com
2. 登录 `zhangsan7891`
3. **File → Clone repository** → 选 `douyin-resume-ext` → 选一个本地目录（比如 `E:\github\douyin-resume-ext`）
4. 把 `E:\douyin-resume-ext` 里的新文件**复制覆盖**到刚克隆的目录
5. 打开 GitHub Desktop，左侧会自动列出变更文件
6. 左下角 **Summary** 填 `feat: 展示格式改为 作者名《视频标题》`
7. 点 **Commit to main**
8. 点右上角 **Push origin**

**以后每次改完，重复 4~8 步就行。**

---

# 附录：文件清单（复制粘贴用）

```
E:\douyin-resume-ext\content.js          ← 这次改了
E:\douyin-resume-ext\manifest.json       ← 这次改了
E:\douyin-resume-ext\README.md           ← 这次改了
E:\douyin-resume-ext\content.css         ← 没变
E:\douyin-resume-ext\LICENSE             ← 没变
E:\douyin-resume-ext\.gitignore          ← 没变
E:\douyin-resume-ext\调试指南.md          ← v1.1.0 新增
E:\douyin-resume-ext\GitHub更新操作.md    ← 本文档，不用上传
E:\douyin-resume-ext\icons\              ← 没变
E:\douyin-resume-ext\.github\            ← 没变
```

懒人版：直接解压 `E:\douyin-resume-ext-upload.zip`，整个文件夹里的东西全拖上去也行（会整体覆盖）。

---

# 最容易踩的 3 个坑

| 坑 | 表现 | 怎么办 |
|---|---|---|
| **拖了文件夹进去，结果里面是空的** | 上传后仓库里只有个空文件夹 | 改成拖**文件夹里面的文件** |
| **只改了 content.js，忘了 manifest.json** | 版本号还是旧的 | 回头单独再传一次 manifest.json |
| **提交时没填说明** | 提交记录显示 "Update xxx" | 不影响功能，但不专业，能填就填 |

---

# 做完之后

回到 `edge://extensions`，点「抖音续看」的**刷新**按钮，确认版本是 **1.2.0**，然后刷新抖音页面测试。
