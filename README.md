<div align="center">

<img src="icons/icon128.png" width="96" alt="抖音续看">

# 抖音续看

**记住抖音网页版长视频看到哪了，下次点一下接着看。**

一个不起眼的右下角悬浮球，安静记录你的播放进度。不联网、不上传，数据全部留在本地。

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-2ea44f?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome-%E2%9C%93-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](#)
[![Edge](https://img.shields.io/badge/Edge-%E2%9C%93-0078D7?style=flat-square&logo=microsoftedge&logoColor=white)](#)

</div>

---

## 这是个什么问题

抖音的长视频没有播放进度记忆。

一个 40 分钟的讲透类视频，你看了一半关上，下次再刷到——**从第 0 秒开始**。抖音的「浏览历史」只记「你看过这条」，不记「你看到第 3 分 20 秒」。官方也没有第三方播放器接口（流加密 + 防盗链），没法拿来做「内置抖音的播放器」。

这个扩展做的是一件很朴素的事：**替你把进度记下来，点一下帮你接上。**

## 效果

- 右下角一个半透明小圆球，平时不打扰
- 点开是「接着看」列表，每条带标题、进度条、`看到 23:14 / 61:02`
- 点某一条 → 打开视频并**自动跳到上次位置**（提前 3 秒，防止漏内容）
- 鼠标悬停某条 → 右侧出现 `×`，**点一下删除**
- 面板右上角「清空」，二次确认后清空全部

## 安装

**方式一：直接下载**

1. 点右上角 `Code` → `Download ZIP`，解压到一个固定目录（比如 `D:\douyin-resume-ext`）
2. 浏览器打开 `chrome://extensions`（Edge 是 `edge://extensions`）
3. 打开右上角 **开发者模式**
4. 点 **加载已解压的扩展程序**，选择解压出的**文件夹本身**
5. 完成。打开 [douyin.com](https://www.douyin.com) 即可

> 选文件夹本身，不要进去选里面的文件。

**方式二：克隆**

```bash
git clone https://github.com/zhangsan7891/douyin-resume-ext.git
```

然后同样按上面的 2~5 步加载。

## 记录规则

不想让列表变成垃圾堆，所以有几条自动规则：

| 规则 | 阈值 | 原因 |
|---|---|---|
| 只记长视频 | ≥ 90 秒 | 短视频刷过去的没必要记 |
| 看够才记 | ≥ 3% | 一进去就划走的不记 |
| 看完自动清 | ≥ 95% | 都看完了，不需要续看 |
| 存储上限 | 100 条 | 超出自动淘汰最旧的 |
| 落盘频率 | 每 4 秒 | 关页面 / 切后台会立刻补存 |
| 续看提前量 | 3 秒 | 防止跳过头漏内容 |

## 隐私

- 数据存在浏览器本地 `chrome.storage.local`，**不上传、不联网**
- 扩展只申请了 `storage` 一个权限
- 没有统计、没有埋点、没有远程代码
- 卸载扩展即清除全部数据

## 已知限制

- **只支持电脑浏览器**。手机抖音 App 是原生应用，任何浏览器扩展都伸不进去，这是物理限制。
- 抖音网页版偶尔改版，若出现不记录 / 标题为空，欢迎提 Issue。
- 暂不支持拖动悬浮球位置。
- 悬浮球在抖音全屏播放时可能被遮挡。

## 文件结构

```
douyin-resume-ext/
├── manifest.json     扩展配置（Manifest V3）
├── content.js        核心逻辑：进度记录 + 悬浮球 UI
├── content.css       样式
├── icons/            图标
├── README.md         本文件
└── LICENSE           MIT
```

改完文件后，去 `chrome://extensions` 点该扩展的**刷新**，再刷新抖音页面即生效。

## 参与贡献

欢迎 Issue 和 PR。特别是：

- 抖音改版后的选择器适配
- 更多站点支持（B站、YouTube 等，其实用原生进度记忆就够了）
- 悬浮球交互优化

## 为什么不做的事

- **不解析抖音视频流**。违反服务条款，而且随时失效。
- **不做云端同步**。一个人看视频的进度，没必要上传到任何服务器。

## License

[MIT](LICENSE)
