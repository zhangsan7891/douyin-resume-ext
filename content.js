/* ============================================================
 * 抖音续看 - content script
 * 记录抖音网页版长视频播放进度，提供悬浮球续看列表
 * ============================================================ */
(function () {
  "use strict";

  // 已经是顶层以外的 iframe 就不重复注入 UI（抖音有大量 iframe）
  const IS_TOP = window.top === window.self;

  const CONFIG = {
    MIN_DURATION: 30, // 少于 30 秒的视频不记录（短视频）
    MIN_WATCH_RATIO: 0.03, // 看超过 3% 才记
    FINISH_RATIO: 0.95, // 看到 95% 以上视为看完，自动清除
    SAVE_INTERVAL: 4000, // 每 4 秒存一次
    MAX_RECORDS: 100, // 最多保留 100 条
    RESUME_AHEAD: 3, // 续看时提前 3 秒，避免漏掉内容
  };

  const STORAGE_KEY = "dyrs_records";

  // 调试日志：排查「跳错视频」时打开。F12 控制台可看到每个视频实际挖到的 ID
  const DEBUG = true;

  /* ---------------- 工具函数 ---------------- */

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const p = (n) => String(n).padStart(2, "0");
    return h > 0 ? h + ":" + p(m) + ":" + p(s) : m + ":" + p(s);
  }

  /**
   * 从 URL 里挖 aweme_id（视频真实 ID）
   * 覆盖三种形态：
   *   /video/7123456789...
   *   /?modal_id=7123456789...
   *   /user/xxx?modal_id=7123456789...
   */
  function getAwemeIdFromUrl() {
    const url = new URL(location.href);
    const m = location.pathname.match(/\/video\/(\d+)/);
    if (m) return m[1];
    const mid =
      url.searchParams.get("modal_id") ||
      url.searchParams.get("aweme_id") ||
      url.searchParams.get("vid");
    if (mid && /^\d+$/.test(mid)) return mid;
    return null;
  }

  const DIGIT_ID = /^\d{15,25}$/;
  const LOOSE_ID = /^\d{10,}$/;

  // 抖音实际使用过的 aweme_id 属性名（data-e2e-aweme-id 对应 dataset.e2eAwemeId）
  const ATTR_NAMES = [
    "data-e2e-aweme-id",
    "data-aweme-id",
    "data-video-id",
    "data-item-id",
    "data-e2e-video-id",
    "data-id",
  ];

  // 视频卡片 / 播放器容器：命中后才在其内部安全地找 /video/ 链接
  const CONTAINER_SEL = [
    "xg-video-container",
    '[data-e2e="video-item"]',
    '[data-e2e="feed-video"]',
    '[data-e2e="recommend-list-item-container"]',
    ".video-item",
  ].join(",");

  /** 在对象里递归找形如 awemeId 的字段（用于读 React fiber 的 props） */
  function pickAwemeId(o, depth) {
    if (!o || typeof o !== "object" || depth > 3) return null;
    const names = [
      "awemeId", "aweme_id", "awemeid",
      "itemId", "item_id", "groupId", "group_id",
    ];
    for (const n of names) {
      const val = o[n];
      if (typeof val === "string" && DIGIT_ID.test(val)) return val;
      if (typeof val === "number" && String(val).length >= 15) return String(val);
    }
    const nest = [
      "awemeDetail", "aweme", "awemeInfo", "data", "item", "video", "props", "info",
    ];
    for (const n of nest) {
      if (o[n] && typeof o[n] === "object") {
        const hit = pickAwemeId(o[n], depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  }

  /**
   * 从 React fiber 树上挖 aweme_id —— 从「当前这个 video 元素」出发向上找，
   * 拿到的才是这个 video 自己的 id，而不是页面里第一个的 id。
   */
  function fiberAwemeId(node) {
    try {
      let fiber = null;
      for (const k in node) {
        if (
          k.indexOf("__reactFiber$") === 0 ||
          k.indexOf("__reactInternalInstance$") === 0
        ) {
          fiber = node[k];
          break;
        }
      }
      let depth = 0;
      while (fiber && depth < 40) {
        const hit = pickAwemeId(fiber.memoizedProps, 0);
        if (hit) return hit;
        fiber = fiber.return;
        depth++;
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  /** 读一个元素「自身」的 ID（属性 / href），绝不扫子元素 */
  function ownId(el) {
    if (!el || !el.getAttribute) return null;
    for (const a of ATTR_NAMES) {
      const val = el.getAttribute(a);
      if (val && LOOSE_ID.test(val.trim())) return val.trim();
    }
    const href = el.getAttribute("href");
    if (href) {
      const m = href.match(/\/video\/(\d{10,})/);
      if (m) return m[1];
    }
    return null;
  }

  /** 在一个「已确认属于当前视频」的容器内找 /video/ 链接 */
  function linkIdIn(root) {
    if (!root || !root.querySelector) return null;
    let link = null;
    try {
      link = root.querySelector('a[href*="/video/"]');
    } catch (e) {
      return null;
    }
    if (!link) return null;
    const m = (link.getAttribute("href") || "").match(/\/video\/(\d{10,})/);
    return m ? m[1] : null;
  }

  /**
   * 从 video 元素的祖先容器里挖（只在这一小片 DOM 里找，绝不扫全页）
   * 关键：逐级向上时只读元素「自身」的属性，不用 querySelector 扫子元素，
   *       否则会串到同页面其它视频卡片上去（这就是"跳错视频"的来源）。
   */
  function digFromContainer(v) {
    if (!v) return null;

    // 1. 命中抖音的播放器 / 卡片容器 → 容器内部可以安全地找链接
    let box = null;
    try {
      box = v.closest(CONTAINER_SEL);
    } catch (e) {
      box = null;
    }
    if (box) {
      const hit = ownId(box) || linkIdIn(box);
      if (hit) return hit;
    }

    // 2. 逐级向上，只读自身属性
    let node = v;
    for (let i = 0; i < 15 && node; i++) {
      const hit = ownId(node);
      if (hit) return hit;
      node = node.parentElement;
    }
    return null;
  }

  /** 从页面 SSR 内联数据里挖 ID（详情页可靠） */
  function ssrAwemeId() {
    const pats = [
      /"aweme_id"\s*:\s*"(\d{10,})"/,
      /"awemeId"\s*:\s*"(\d{10,})"/,
      /video_id\s*:\s*"(\d{10,})"/,
    ];
    // 新版：window._ROUTER_DATA
    try {
      if (window._ROUTER_DATA) {
        const s = JSON.stringify(window._ROUTER_DATA);
        for (const p of pats) {
          const m = s.match(p);
          if (m) return m[1];
        }
      }
    } catch (e) {
      /* ignore */
    }
    // 老版：#RENDER_DATA（URL 编码的 JSON）
    try {
      const el = document.getElementById("RENDER_DATA");
      if (el && el.textContent) {
        const txt = decodeURIComponent(el.textContent);
        for (const p of pats) {
          const m = txt.match(p);
          if (m) return m[1];
        }
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  /**
   * 算某个 video 对应的 aweme_id。顺序：最可靠 → 最不可靠。
   * 注意：URL 上的 modal_id 会「滞后」——首页点开某视频后继续往下滑，
   *       地址栏可能还停在上一个视频上，所以 DOM 渠道排在它前面。
   */
  function computeAwemeId(v) {
    // 1. 详情页 URL 里的 /video/<id>（绝对可靠）
    const m = location.pathname.match(/\/video\/(\d+)/);
    if (m) return m[1];

    // 2. 用接口数据 + 文案匹配。
    //    首页推荐流里这是唯一可行的办法——DOM 和 URL 都没有任何标识。
    const a = matchAweme(v);
    if (a && a.id) return a.id;

    // 3. 从「这个 video 元素」出发挖：fiber → 播放器容器 → 逐级向上的自身属性
    if (v) {
      const f = fiberAwemeId(v);
      if (f) return f;
      const d = digFromContainer(v);
      if (d) return d;
    }

    // 4. 页面 SSR 内联数据。
    //    只在「页面上只有一个 video」时用——详情页可信；
    //    信息流里 SSR 带着整条推荐列表，取到的可能是别的视频，宁可不要。
    if (document.querySelectorAll("video").length <= 1) {
      const s = ssrAwemeId();
      if (s) return s;
    }

    // 5. 最后才用 URL 上的 modal_id 等参数（可能滞后）
    return getAwemeIdFromUrl() || null;
  }

  /** 从 video src 算一个稳定指纹（剔除时效签名），作为拿不到 ID 时的兜底标识 */
  function srcFingerprint(v) {
    const s = (v && (v.currentSrc || v.src)) || "";
    if (!s) return null;
    try {
      const u = new URL(s, location.origin);
      const p = u.pathname || "";
      if (p.length < 12) return null;
      return p;
    } catch (e) {
      return null;
    }
  }

  /** 简单字符串 hash（用标题做兜底 key 时用） */
  function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
  }

  // 缓存：同一个 video 元素 + 同一个 src 只挖一次（fiber 遍历有开销）
  let idCache = { el: null, src: null, id: null };

  /** 拿到当前正在看的视频的 aweme_id */
  function getAwemeId(v) {
    const el = v || findVideo();
    if (!el) return computeAwemeId(null);
    const s = el.currentSrc || el.src || "";
    if (idCache.el === el && idCache.src === s) return idCache.id;
    const id = computeAwemeId(el);
    idCache = { el: el, src: s, id: id };
    if (DEBUG) {
      console.log(
        "[抖音续看] video.src=" + s.slice(0, 80) + " → awemeId=" + id
      );
    }
    return id;
  }

  /**
   * 生成视频唯一 key。
   * 铁律：绝不允许「识别不到就放弃记录」——拿不到 ID 也必须给一个稳定标识，
   *       否则整个功能会静默失效（v1.2.1 就栽在这里）。
   */
  function getVideoKey(v) {
    const id = getAwemeId(v);
    if (id) return "aweme:" + id;

    // 兜底 1：视频文案。
    //   首页推荐流里，文案是唯一「看得见且稳定」的东西——
    //   blob src 每次页面加载都换一个随机 UUID，URL 永远停在 ?recommend=1，都不能用。
    const a = matchAweme(v);
    const k = descKey((a && a.desc) || descNear(v));
    if (k) return "desc:" + hashStr(k);

    // 兜底 2：剥离易变参数后的 URL
    const url = new URL(location.href);
    url.hash = "";
    const junk = [
      "from", "from_ssr", "extra_params", "previous_page", "enter_from",
      "enter_method", "gid", "gd_ext_json", "video_share_track_ver",
      "schema_type", "share_token", "timestamp", "tt_from", "utm_source",
    ];
    junk.forEach((x) => url.searchParams.delete(x));
    const clean = url.origin + url.pathname + url.search;

    // 落在首页（URL 里没有任何可用信息）→ 退到 src 指纹，好歹给个标识
    if (/^https?:\/\/[^/]+\/?$/.test(clean)) {
      const fp = srcFingerprint(v);
      if (fp) return "src:" + hashStr(fp);
    }
    return "url:" + clean;
  }

  /** 生成可直接打开的视频详情页地址（干净的 /video/<id>） */
  function getCleanUrl(v) {
    const id = getAwemeId(v);
    if (id) return "https://www.douyin.com/video/" + id;
    return location.href;
  }

  /** 取作者昵称 */
  function getAuthor() {
    // 1. data-e2e 选择器（抖音网页版常用）
    const sels = [
      '[data-e2e="video-author-name"]',
      '[data-e2e="detail-video-author-name"]',
      '[data-e2e="video-author"] [data-e2e="user-name"]',
      '[data-e2e="user-name"]',
      '[data-e2e="user-info"] span',
      ".author-name",
      ".user-name",
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) continue;
      const t = (el.textContent || "").trim().replace(/^@/, "");
      if (t && t.length <= 30 && !/^\d+$/.test(t) && t !== "抖音") return t;
    }

    // 2. 从页面内联数据里扫 nickname
    try {
      const html = document.documentElement.innerHTML;
      const m =
        html.match(/"nickname"\s*:\s*"([^"\\]{1,30})"/) ||
        html.match(/"author"\s*:\s*\{[^}]*"nickname"\s*:\s*"([^"\\]{1,30})"/);
      if (m && m[1]) return m[1].trim();
    } catch (e) {
      /* ignore */
    }

    return "";
  }

  /** 取视频标题（优先用视频描述，避免混入作者名） */
  function getTitle() {
    // 1. 视频描述（最准）
    const desc = document.querySelector(
      '[data-e2e="video-desc"], [data-e2e="detail-video-desc"], [data-e2e="video-title"]'
    );
    if (desc) {
      const t = (desc.textContent || "").trim();
      if (t) return t.slice(0, 80);
    }

    // 2. og:title
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content && og.content.trim()) {
      return og.content.trim().slice(0, 80);
    }

    // 3. document.title，去掉尾部的"- 抖音"
    const t = (document.title || "").trim();
    if (t && t !== "抖音" && !/^抖音\s*[-—]/.test(t)) {
      return t.replace(/\s*[-—]\s*抖音.*$/, "").trim().slice(0, 80);
    }

    return "抖音视频";
  }

  /** 拼成 "作者名《视频标题》" 的展示文案 */
  function formatLabel(r) {
    const title = (r && r.title) || "抖音视频";
    const author = (r && r.author) || "";
    return author ? author + "《" + title + "》" : "《" + title + "》";
  }

  /** 元素是否在视口内且够大（抖音首页会预加载多个 video，必须挑到真正在看的那个） */
  function inViewport(v) {
    if (!v || !v.getBoundingClientRect) return false;
    const r = v.getBoundingClientRect();
    if (r.width < 60 || r.height < 60) return false;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    return r.bottom > 0 && r.top < vh;
  }

  function findVideo() {
    const vids = Array.from(document.querySelectorAll("video"));
    if (!vids.length) return null;

    // 1. 视口内 + 正在播放 → 最可能就是"我此刻在看的那一个"
    let v = vids.find((x) => inViewport(x) && !x.paused && x.currentTime > 0);
    if (v) return v;

    // 2. 视口内 + 有有效时长
    v = vids.find((x) => inViewport(x) && isFinite(x.duration) && x.duration > 0);
    if (v) return v;

    // 3. 退而求其次：任何正在播放的
    v = vids.find((x) => !x.paused && x.currentTime > 0);
    if (v) return v;

    // 4. 最后：时长最长的
    let best = null;
    for (const x of vids) {
      if (!isFinite(x.duration) || x.duration <= 0) continue;
      if (!best || x.duration > best.duration) best = x;
    }
    return best || vids[0];
  }

  /* ---------------- 接口数据索引（来自 inject.js 的网络拦截） ----------------
   *
   * 为什么需要它：首页推荐流（douyin.com/?recommend=1）里，
   *   video.src 是 blob:<随机UUID>（每次页面加载都变）
   *   URL 里永远没有视频标识，DOM 上也不挂 id
   * → 只有抖音自己的接口响应里才有权威的 aweme_id。
   *
   * inject.js 把接口里的 {id, desc, author} 送过来，这里建立索引；
   * 记录时用「页面上看得见的视频文案」去匹配，换回真实 aweme_id。
   * ------------------------------------------------------------------ */

  const DESC_SEL =
    '[data-e2e="video-desc"], [data-e2e="detail-video-desc"], [data-e2e="video-title"]';

  let awemeReady = false; // 注入脚本是否已就位
  let awemeGot = 0; // 累计收到多少条 aweme
  const awemeById = new Map(); // id        → {id, desc, author}
  const awemeByDesc = new Map(); // 文案关键词 → {id, desc, author}

  /** 把文案归一化成短关键词，用于 DOM 文案 ↔ 接口文案 的匹配 */
  function descKey(s) {
    s = String(s || "")
      .replace(/[\s\u200b\u00a0]/g, "")
      .replace(/[#＃]/g, "")
      .trim();
    if (s.length < 3) return "";
    return s.slice(0, 14);
  }

  function absorbAweme(items) {
    if (!Array.isArray(items)) return;
    for (const it of items) {
      if (!it || !it.id) continue;
      awemeGot++;
      awemeById.set(String(it.id), it);
      const k = descKey(it.desc);
      if (k && !awemeByDesc.has(k)) awemeByDesc.set(k, it);
    }
  }

  try {
    window.addEventListener("message", (ev) => {
      if (ev.source !== window) return;
      const d = ev.data;
      if (!d || d.__dyrs !== true) return;
      if (d.type === "ready") {
        awemeReady = true;
      } else if (d.type === "aweme") {
        absorbAweme(d.items);
      }
    });

    // 主动要一次：我们（document_idle）比注入脚本（document_start）晚启动，
    // 最早拦到的那批数据在监听器注册前就发过了，这里让它补发
    window.postMessage({ __dyrs: true, type: "want" }, "*");
  } catch (e) {
    /* ignore */
  }

  /** 取「和这个 video 同属一个卡片」的视频文案 */
  function descNear(v) {
    if (!v) return "";
    let node = v;
    let fallback = "";
    for (let i = 0; i < 14 && node; i++) {
      if (node.querySelectorAll) {
        let list = null;
        try {
          list = node.querySelectorAll(DESC_SEL);
        } catch (e) {
          list = null;
        }
        if (list && list.length) {
          const t = (list[0].textContent || "").trim();
          // 这一层只有它自己一条文案 → 最干净，直接采用
          if (list.length === 1 && t) return t;
          if (!fallback && t) fallback = t;
        }
      }
      node = node.parentElement;
    }
    return fallback;
  }

  /** 用文案把「当前这个 video」对上接口数据里的 aweme */
  function matchAweme(v) {
    if (!awemeByDesc.size) return null;

    // 1. 优先用同一卡片里的文案
    const near = descKey(descNear(v));
    if (near && awemeByDesc.has(near)) return awemeByDesc.get(near);

    // 2. 其次：页面上所有文案里，唯一能对上的那一个
    let hit = null;
    try {
      for (const el of document.querySelectorAll(DESC_SEL)) {
        const k = descKey((el.textContent || "").trim());
        if (!k) continue;
        const it = awemeByDesc.get(k);
        if (!it) continue;
        if (hit && hit.id !== it.id) return null; // 有歧义，宁可不用
        hit = it;
      }
    } catch (e) {
      /* ignore */
    }
    return hit;
  }

  /* ---------------- 存储读写 ---------------- */

  function readRecords() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(STORAGE_KEY, (res) => {
          if (chrome.runtime.lastError) return resolve([]);
          const arr = res && res[STORAGE_KEY];
          resolve(Array.isArray(arr) ? arr : []);
        });
      } catch (e) {
        resolve([]);
      }
    });
  }

  function writeRecords(records) {
    return new Promise((resolve) => {
      try {
        const obj = {};
        obj[STORAGE_KEY] = records;
        chrome.storage.local.set(obj, () => resolve());
      } catch (e) {
        resolve();
      }
    });
  }

  async function upsertRecord(key, patch, remove) {
    const records = await readRecords();
    const idx = records.findIndex((r) => r.key === key);
    if (remove) {
      if (idx >= 0) records.splice(idx, 1);
      await writeRecords(records);
      return records;
    }
    if (idx >= 0) {
      records[idx] = Object.assign({}, records[idx], patch);
    } else {
      records.push(Object.assign({ key: key }, patch));
    }
    // 按更新时间倒序
    records.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (records.length > CONFIG.MAX_RECORDS) {
      records.length = CONFIG.MAX_RECORDS;
    }
    await writeRecords(records);
    return records;
  }

  /* ---------------- 记录逻辑 ---------------- */

  let lastSavedAt = 0;
  let lastKey = null;

  // 标题/作者缓存：只在切换视频时重新抓取，避免每 4 秒扫一遍 DOM
  let metaKey = null;
  let metaVal = { title: "", author: "" };

  function getMeta(key, v) {
    if (metaKey !== key) {
      // 接口数据里的文案/作者最准；拿不到才去啃 DOM
      const a = matchAweme(v);
      metaVal = {
        title: a && a.desc ? String(a.desc).slice(0, 80) : getTitle(),
        author: a && a.author ? a.author : getAuthor(),
      };
      metaKey = key;
    }
    return metaVal;
  }

  async function tick() {
    const v = findVideo();
    if (!v) return;
    if (!isFinite(v.duration) || v.duration <= 0) return;
    if (v.currentTime <= 0) return;

    // 太短的视频不记
    if (v.duration < CONFIG.MIN_DURATION) return;

    // 拿不到 ID 也照记（退到 src 指纹兜底）。
    // 绝不能因为挖不到 ID 就跳过记录——那会让整个功能静默失效（v1.2.1 的教训）。
    const aid = getAwemeId(v);
    if (DEBUG && !aid) {
      console.warn(
        "[抖音续看] 未挖到 aweme_id，改用兜底标识记录（只影响跳转精度，不影响记录）"
      );
    }

    const key = getVideoKey(v);
    const ratio = v.currentTime / v.duration;

    // 快看完了 → 自动移除记录（不用再续看）
    if (ratio >= CONFIG.FINISH_RATIO) {
      const records = await readRecords();
      if (records.some((r) => r.key === key)) {
        await upsertRecord(key, null, true);
        if (IS_TOP) renderPanel();
      }
      return;
    }

    // 看得太少不记
    if (ratio < CONFIG.MIN_WATCH_RATIO) return;

    // 同一视频切换时立即存一次
    const now = Date.now();
    if (key === lastKey && now - lastSavedAt < CONFIG.SAVE_INTERVAL) return;

    const meta = getMeta(key, v);
    const patch = {
      title: meta.title,
      author: meta.author,
      url: getCleanUrl(v),
      awemeId: aid || "",
      currentTime: v.currentTime,
      duration: v.duration,
      updatedAt: now,
    };
    await upsertRecord(key, patch);
    lastKey = key;
    lastSavedAt = now;

    if (IS_TOP) renderPanel();
  }

  /* ---------------- 续看逻辑 ---------------- */

  let pendingResume = null; // {key, awemeId, time, at}

  async function tryResume() {
    if (!pendingResume) return;

    // 超时作废（1 分钟）
    if (pendingResume.at && Date.now() - pendingResume.at > 60000) {
      clearPending();
      return;
    }

    const v = findVideo();
    if (!v) return;
    if (!isFinite(v.duration) || v.duration <= 0) return;
    if (v.readyState < 1) return; // 还没加载元数据

    // 匹配：优先 awemeId，其次 key
    const curId = getAwemeId(v);
    const curKey = getVideoKey(v);
    const idMatch = pendingResume.awemeId && curId && pendingResume.awemeId === curId;
    const keyMatch = !pendingResume.awemeId && curKey === pendingResume.key;
    const fallbackKey = curKey === pendingResume.key;

    if (!idMatch && !keyMatch && !fallbackKey) return;

    const target = Math.min(pendingResume.time, Math.max(0, v.duration - 1));
    if (target <= 0) {
      clearPending();
      return;
    }
    try {
      v.currentTime = target;
      const label = pendingResume.label || "";
      clearPending();
      toast(
        (label ? label + " · " : "") + "已跳到 " + fmtTime(target) + "，接着看吧"
      );
    } catch (e) {
      /* 忽略 */
    }
  }

  function clearPending() {
    pendingResume = null;
    try {
      chrome.storage.local.remove("dyrs_pending");
    } catch (e) {
      /* ignore */
    }
  }

  /* ---------------- 记录迁移（修复旧版本存的坏数据） ---------------- */

  async function migrateRecords() {
    const records = await readRecords();
    if (!records.length) return;

    let changed = false;
    const seen = new Map();

    for (const r of records) {
      if (!r || !r.url) continue;

      // 1. 从 url 里补出 awemeId
      let aid = r.awemeId || "";
      if (!aid && r.url) {
        const m1 = r.url.match(/\/video\/(\d{10,})/);
        if (m1) aid = m1[1];
        if (!aid) {
          const m2 = r.url.match(/[?&](?:modal_id|aweme_id)=(\d{10,})/);
          if (m2) aid = m2[1];
        }
        if (aid) {
          r.awemeId = aid;
          r.key = "aweme:" + aid;
          changed = true;
        }
      }

      // 2. URL 是首页或带参数的，且已有 awemeId → 换成干净的详情页
      if (aid) {
        const clean = "https://www.douyin.com/video/" + aid;
        if (r.url !== clean) {
          r.url = clean;
          changed = true;
        }
      }

      // 3. 去重：同一个 awemeId 只保留进度最靠后（最近更新）的一条
      const dedupKey = aid ? "aweme:" + aid : r.key;
      if (seen.has(dedupKey)) {
        const prev = seen.get(dedupKey);
        const keep = (r.updatedAt || 0) > (prev.updatedAt || 0) ? r : prev;
        const drop = keep === r ? prev : r;
        const idx = records.indexOf(drop);
        if (idx >= 0) {
          records.splice(idx, 1);
          changed = true;
        }
        seen.set(dedupKey, keep);
        continue;
      }
      seen.set(dedupKey, r);
    }

    if (changed) {
      records.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      await writeRecords(records);
    }
  }

  /* ---------------- UI ---------------- */

  let ballEl = null;
  let panelEl = null;
  let listEl = null;
  let badgeEl = null;
  let toastEl = null;
  let toastTimer = null;
  let panelOpen = false;

  function botui(svgPath) {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="#f1f1f1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      svgPath +
      "</svg>"
    );
  }

  function buildUI() {
    if (!IS_TOP || document.getElementById("dyrs-ball")) return;

    // 悬浮球
    ballEl = document.createElement("div");
    ballEl.id = "dyrs-ball";
    ballEl.title = "抖音续看：记住看到哪了";
    ballEl.innerHTML =
      botui(
        '<circle cx="12" cy="12" r="9"></circle><path d="M10 8.5l6 3.5-6 3.5z"></path>'
      ) + '<div id="dyrs-badge"></div>';
    ballEl.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePanel();
    });
    document.documentElement.appendChild(ballEl);

    badgeEl = ballEl.querySelector("#dyrs-badge");

    // 面板
    panelEl = document.createElement("div");
    panelEl.id = "dyrs-panel";
    panelEl.innerHTML =
      '<div id="dyrs-head">' +
      '<span id="dyrs-title">接着看</span>' +
      '<span id="dyrs-head-right">' +
      '<span id="dyrs-diag" title="跑一次诊断，结果打印到控制台">诊断</span>' +
      '<span id="dyrs-clear" title="清空全部记录">清空</span>' +
      "</span>" +
      "</div>" +
      '<div id="dyrs-list"></div>';
    document.documentElement.appendChild(panelEl);

    listEl = panelEl.querySelector("#dyrs-list");

    panelEl.querySelector("#dyrs-clear").addEventListener("click", async (e) => {
      e.stopPropagation();
      const records = await readRecords();
      if (!records.length) return;
      if (!confirm("确定清空全部 " + records.length + " 条续看记录？")) return;
      await writeRecords([]);
      renderPanel();
      toast("已清空全部记录");
    });

    panelEl.querySelector("#dyrs-diag").addEventListener("click", (e) => {
      e.stopPropagation();
      runDiagnose();
    });

    // 点击面板外关闭
    document.addEventListener(
      "click",
      (e) => {
        if (!panelOpen) return;
        if (panelEl.contains(e.target) || ballEl.contains(e.target)) return;
        togglePanel(false);
      },
      true
    );

    renderPanel();
  }

  function togglePanel(force) {
    if (!panelEl) return;
    panelOpen = typeof force === "boolean" ? force : !panelOpen;
    panelEl.classList.toggle("dyrs-open", panelOpen);
    if (panelOpen) renderPanel();
  }

  async function renderPanel() {
    if (!listEl) return;
    const records = await readRecords();
    const valid = records.filter(
      (r) => r && r.duration > 0 && r.currentTime < r.duration
    );

    // 角标
    if (badgeEl) {
      if (valid.length > 0) {
        badgeEl.textContent = valid.length > 99 ? "99+" : String(valid.length);
        badgeEl.style.display = "block";
      } else {
        badgeEl.style.display = "none";
      }
    }

    if (!valid.length) {
      listEl.innerHTML =
        '<div id="dyrs-empty">还没有续看记录<br>看长视频时会自动记住进度</div>';
      return;
    }

    listEl.textContent = "";
    for (const r of valid) {
      const pct = Math.min(
        100,
        Math.round((r.currentTime / r.duration) * 100)
      );
      const item = document.createElement("div");
      item.className = "dyrs-item";

      const main = document.createElement("div");
      main.className = "dyrs-item-main";

      const title = document.createElement("div");
      title.className = "dyrs-item-title";
      title.textContent = formatLabel(r);
      title.title = formatLabel(r);

      const bar = document.createElement("div");
      bar.className = "dyrs-item-bar";
      const fill = document.createElement("div");
      fill.className = "dyrs-item-fill";
      fill.style.width = pct + "%";
      bar.appendChild(fill);

      const time = document.createElement("div");
      time.className = "dyrs-item-time";
      time.textContent =
        "看到 " + fmtTime(r.currentTime) + " / " + fmtTime(r.duration);

      main.appendChild(title);
      main.appendChild(bar);
      main.appendChild(time);

      const del = document.createElement("div");
      del.className = "dyrs-del";
      del.textContent = "×";
      del.title = "删除这条记录";
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        await upsertRecord(r.key, null, true);
        renderPanel();
        toast("已删除");
      });

      item.appendChild(main);
      item.appendChild(del);

      item.addEventListener("click", async () => {
        const recs = await readRecords();
        const cur = recs.find((x) => x.key === r.key) || r;
        const target = Math.max(0, (cur.currentTime || 0) - CONFIG.RESUME_AHEAD);
        const label = formatLabel(cur);

        // 判断"当前页面是不是就在放这条记录的视频"
        const nowVideo = findVideo();
        const nowId = getAwemeId(nowVideo);
        const nowKey = getVideoKey(nowVideo);
        const sameVideo =
          (!!cur.awemeId && !!nowId && cur.awemeId === nowId) ||
          (!!nowKey && nowKey === r.key);

        if (sameVideo && nowVideo) {
          // 就是这个视频，原地跳进度
          nowVideo.currentTime = target;
          nowVideo.play().catch(() => {});
          toast(label + " · 已跳到 " + fmtTime(target));
          togglePanel(false);
          return;
        }

        // 需要跳转到视频页：把续看信息写进 storage，供新页面读取
        let dest = cur.url || r.url;
        // 旧记录可能存的是带参数的首页地址，用 awemeId 兜底重建
        const aid = cur.awemeId || r.awemeId;
        if (aid) {
          dest = "https://www.douyin.com/video/" + aid;
        }
        if (!dest) {
          toast("这条记录没有可跳转的地址");
          return;
        }

        try {
          chrome.storage.local.set(
            {
              dyrs_pending: {
                key: r.key,
                awemeId: aid || "",
                time: target,
                label: label,
                at: Date.now(),
              },
            },
            () => {
              location.href = dest;
            }
          );
        } catch (e) {
          pendingResume = { key: r.key, time: target, label: label };
          location.href = dest;
        }
      });

      listEl.appendChild(item);
    }
  }

  /* ---------------- 诊断（出问题时点面板里的「诊断」） ---------------- */

  function collectDiagnose() {
    const L = [];
    const vids = Array.from(document.querySelectorAll("video"));

    // 清掉 ID 缓存，保证看到的是真实探测结果
    idCache = { el: null, src: null, id: null };

    L.push("时间：" + new Date().toLocaleString());
    L.push("页面：" + location.href);
    L.push("顶层frame：" + IS_TOP + "   video 元素数：" + vids.length);
    L.push("");

    vids.forEach((v, i) => {
      let size = "?";
      try {
        const r = v.getBoundingClientRect();
        size = Math.round(r.width) + "×" + Math.round(r.height);
      } catch (e) {
        /* ignore */
      }
      L.push(
        "video[" + i + "] " + size +
          " 视口内=" + inViewport(v) +
          " 播放中=" + !v.paused +
          " 时长=" + (isFinite(v.duration) ? Math.round(v.duration) + "s" : "NaN") +
          " 进度=" + Math.round(v.currentTime || 0) + "s"
      );
      L.push("    src=" + String(v.currentSrc || v.src || "").slice(0, 110));
    });
    L.push("");

    const cur = findVideo();
    L.push(
      "选中的 video：" + (cur ? "第 " + vids.indexOf(cur) + " 个" : "无（没找到可播放的视频）")
    );
    L.push("");
    L.push("—— 接口数据（inject.js 网络拦截）——");
    L.push("注入脚本就位：" + awemeReady + "   累计收到 aweme：" + awemeGot + " 条");
    L.push("可用于匹配的文案数：" + awemeByDesc.size);
    const nearDesc = descNear(cur);
    L.push(
      "当前 video 附近文案：" +
        (nearDesc ? "「" + nearDesc.slice(0, 40) + "」" : "（没读到）")
    );
    const matched = matchAweme(cur);
    L.push(
      "文案匹配结果：" +
        (matched
          ? matched.id + "   作者=" + (matched.author || "?")
          : "未匹配到")
    );
    L.push("");
    L.push("—— aweme_id 探测（按优先顺序）——");
    const rid = location.pathname.match(/\/video\/(\d+)/);
    L.push("① URL /video/<id>  : " + (rid ? rid[1] : "无"));
    L.push("② 接口+文案匹配    : " + (matched ? matched.id : "无"));
    L.push("③ React fiber      : " + (cur ? fiberAwemeId(cur) || "无" : "—"));
    L.push("④ 容器/祖先属性    : " + (cur ? digFromContainer(cur) || "无" : "—"));
    L.push(
      "⑤ SSR 内联数据     : " +
        (vids.length <= 1 ? ssrAwemeId() || "无" : "跳过（页面有多个 video）")
    );
    L.push("⑥ URL modal_id     : " + (getAwemeIdFromUrl() || "无"));
    L.push("");
    L.push("最终 aweme_id：" + (cur ? getAwemeId(cur) || "未挖到" : "—"));
    L.push("最终 key：" + (cur ? getVideoKey(cur) : "—"));

    // DOM 侦察：视频元素向上 8 层的结构，页面改版时靠这个判断
    if (cur) {
      L.push("");
      L.push("—— DOM 侦察（video 向上 8 层）——");
      let n = cur;
      for (let i = 0; i < 8 && n; i++) {
        let attrs = "";
        try {
          if (n.attributes) {
            attrs = Array.prototype.map
              .call(n.attributes, function (a) {
                return a.name + "=" + String(a.value).slice(0, 26);
              })
              .join(" ");
          }
        } catch (e) {
          /* ignore */
        }
        L.push(
          "  " +
            i +
            ". <" +
            String(n.tagName || "").toLowerCase() +
            "> " +
            attrs.slice(0, 170)
        );
        n = n.parentElement;
      }
    }

    return L.join("\n");
  }

  async function runDiagnose() {
    if (!listEl) return;
    const text = collectDiagnose();

    // 打印到控制台（方便主人截图）
    try {
      console.log("%c[抖音续看] 诊断报告", "color:#fe2c55;font-weight:bold");
      console.log(text);
    } catch (e) {
      /* ignore */
    }

    const recs = await readRecords();
    const recText = recs.length
      ? recs
          .slice(0, 8)
          .map(
            (r) =>
              "  · " + String(r.key || "").slice(0, 46) +
              "\n     进度 " + fmtTime(r.currentTime) + " / " + fmtTime(r.duration) +
              "   标题：" + String(r.title || "").slice(0, 24)
          )
          .join("\n")
      : "  （空）";

    listEl.textContent = "";
    const box = document.createElement("div");
    box.id = "dyrs-diag-box";
    box.textContent =
      text + "\n\n—— 已存记录（" + recs.length + " 条）——\n" + recText +
      "\n\n把这一屏截图发我即可。";

    listEl.appendChild(box);
    toast("诊断完成：结果已打印到控制台（F12）");
  }

  function toast(msg) {
    if (!IS_TOP) return;
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "dyrs-toast";
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("dyrs-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("dyrs-show");
    }, 1800);
  }

  /* ---------------- 启动 ---------------- */

  // 用 storage 里 pendingResume 跨页面跳转续看
  async function checkPendingResume() {
    try {
      chrome.storage.local.get("dyrs_pending", (res) => {
        const p = res && res.dyrs_pending;
        if (!p || !p.time) return;
        if (Date.now() - (p.at || 0) > 60000) {
          chrome.storage.local.remove("dyrs_pending");
          return;
        }
        pendingResume = {
          key: p.key || "",
          awemeId: p.awemeId || "",
          time: p.time,
          label: p.label || "",
          at: p.at,
        };
      });
    } catch (e) {
      /* ignore */
    }
  }

  buildUI();
  checkPendingResume();
  migrateRecords().then(() => renderPanel());

  // 抖音是 SPA，路由变化时要重新检查一次待续看并刷新列表
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      checkPendingResume();
      setTimeout(tryResume, 800);
      setTimeout(tryResume, 2000);
      setTimeout(tryResume, 4000);
    }
  }, 700);

  setInterval(tick, 1000);
  setInterval(tryResume, 1200);

  // 页面隐藏/离开时立刻存一次
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") tick();
  });
  window.addEventListener("pagehide", () => tick());

  // 监听 storage 变化，多标签同步列表
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[STORAGE_KEY] && IS_TOP) renderPanel();
    });
  } catch (e) {
    /* ignore */
  }
})();
