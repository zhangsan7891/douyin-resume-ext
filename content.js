/* ============================================================
 * 抖音续看 - content script
 * 记录抖音网页版长视频播放进度，提供悬浮球续看列表
 * ============================================================ */
(function () {
  "use strict";

  // 已经是顶层以外的 iframe 就不重复注入 UI（抖音有大量 iframe）
  const IS_TOP = window.top === window.self;

  const CONFIG = {
    MIN_DURATION: 90, // 少于 90 秒的视频不记录（短视频）
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

  /** 从 video 元素的祖先容器里挖（只在这一小片 DOM 里找，绝不扫全页） */
  function digFromContainer(v) {
    let node = v;
    for (let i = 0; i < 12 && node; i++) {
      if (node.getAttribute) {
        for (const a of ["data-aweme-id", "data-video-id", "data-id"]) {
          const val = node.getAttribute(a);
          if (val && /^\d{10,}$/.test(val)) return val;
        }
        const href = node.getAttribute("href");
        if (href) {
          const m = href.match(/\/video\/(\d{10,})/);
          if (m) return m[1];
        }
      }
      if (node.querySelector) {
        const link = node.querySelector('a[href*="/video/"]');
        if (link) {
          const m = (link.getAttribute("href") || "").match(/\/video\/(\d{10,})/);
          if (m) return m[1];
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  /** 算某个 video 对应的 aweme_id */
  function computeAwemeId(v) {
    // 1. 详情页 URL 里的 /video/<id> 最可靠
    const m = location.pathname.match(/\/video\/(\d+)/);
    if (m) return m[1];

    // 2. 从「这个 video 元素」出发挖。
    //    优先于 URL 上的 modal_id —— 首页滑动切换视频时 URL 可能还停在上一个视频上
    if (v) {
      const f = fiberAwemeId(v);
      if (f) return f;
      const d = digFromContainer(v);
      if (d) return d;
    }

    // 3. 最后才用 URL 上的 modal_id 等参数
    return getAwemeIdFromUrl() || null;
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
   * 生成视频唯一 key
   * 有 aweme_id 就用它（最稳，与从哪进入无关）
   * 实在拿不到才退回 URL，此时尽量剥离易变参数
   */
  function getVideoKey(v) {
    const id = getAwemeId(v);
    if (id) return "aweme:" + id;

    const url = new URL(location.href);
    url.hash = "";
    // 移除已知的易变跟踪参数
    const junk = [
      "from", "from_ssr", "extra_params", "previous_page", "enter_from",
      "enter_method", "gid", "gd_ext_json", "video_share_track_ver",
      "schema_type", "share_token", "timestamp", "tt_from", "utm_source",
    ];
    junk.forEach((k) => url.searchParams.delete(k));
    return "url:" + url.origin + url.pathname + url.search;
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

  function getMeta(key) {
    if (metaKey !== key) {
      metaVal = { title: getTitle(), author: getAuthor() };
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

    // 定位不到视频 ID、又不在详情页 → 记了也跳不回来，宁可不记（避免又存一条跳错的）
    const aid = getAwemeId(v);
    if (!aid && !/\/video\/\d+/.test(location.pathname)) {
      if (DEBUG) {
        console.warn("[抖音续看] 定位不到视频 ID，本次不记录（避免记错视频）");
      }
      return;
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

    const patch = {
      title: getMeta(key).title,
      author: getMeta(key).author,
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
      '<span id="dyrs-clear" title="清空全部记录">清空</span>' +
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
