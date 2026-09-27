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

  /**
   * 从页面 DOM 里挖 aweme_id
   * 抖音会在页面里挂大量 data-e2e 属性和脚本数据
   */
  function getAwemeIdFromDom() {
    // 1. 常见属性
    const attrs = [
      "[data-e2e=\"feed-video\"]",
      "[data-e2e=\"video-item\"]",
      "[data-e2e=\"recommend-list-item-container\"]",
      "div[data-video-id]",
      "[data-aweme-id]",
    ];
    for (const sel of attrs) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const id =
        el.getAttribute("data-video-id") ||
        el.getAttribute("data-aweme-id") ||
        el.getAttribute("data-id");
      if (id && /^\d{10,}$/.test(id)) return id;
    }

    // 2. 当前播放器所在的容器往上找
    const v = document.querySelector("video");
    if (v) {
      let node = v;
      for (let i = 0; i < 12 && node; i++) {
        const id =
          node.getAttribute &&
          (node.getAttribute("data-video-id") ||
            node.getAttribute("data-aweme-id"));
        if (id && /^\d{10,}$/.test(id)) return id;
        node = node.parentElement;
      }
    }

    // 3. 从页面内联脚本里扫 aweme_id（抖音会把数据挂 window 上）
    try {
      const html = document.documentElement.innerHTML;
      let mm = html.match(/"aweme_id"\s*:\s*"(\d{10,})"/);
      if (mm) return mm[1];
      mm = html.match(/"awemeId"\s*:\s*"(\d{10,})"/);
      if (mm) return mm[1];
      mm = html.match(/\/video\/(\d{15,})/);
      if (mm) return mm[1];
    } catch (e) {
      /* ignore */
    }

    return null;
  }

  /** 拿到当前视频的 aweme_id（URL 优先，其次 DOM） */
  function getAwemeId() {
    return getAwemeIdFromUrl() || getAwemeIdFromDom() || null;
  }

  /**
   * 生成视频唯一 key
   * 有 aweme_id 就用它（最稳，与从哪进入无关）
   * 实在拿不到才退回 URL，此时尽量剥离易变参数
   */
  function getVideoKey() {
    const id = getAwemeId();
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
  function getCleanUrl() {
    const id = getAwemeId();
    if (id) return "https://www.douyin.com/video/" + id;
    return location.href;
  }

  function getTitle() {
    // 1. 抖音视频页标题一般在 og:title 或 document.title
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content && og.content.trim()) return og.content.trim();

    const t = (document.title || "").trim();
    if (t && t !== "抖音" && !/^抖音\s*[-—]/.test(t)) {
      return t.replace(/\s*[-—]\s*抖音.*$/, "").trim();
    }

    // 2. 找页面里的描述文本
    const desc = document.querySelector(
      '[data-e2e="video-desc"], [data-e2e="detail-video-desc"]'
    );
    if (desc && desc.textContent.trim()) {
      return desc.textContent.trim().slice(0, 60);
    }

    if (t) return t.replace(/\s*[-—]\s*抖音.*$/, "").trim() || "抖音视频";
    return "抖音视频";
  }
  function findVideo() {
    const vids = Array.from(document.querySelectorAll("video"));
    if (!vids.length) return null;
    // 选正在播放的，其次选时长最长的
    const playing = vids.find((v) => !v.paused && v.currentTime > 0);
    if (playing) return playing;
    let best = null;
    for (const v of vids) {
      if (!isFinite(v.duration) || v.duration <= 0) continue;
      if (!best || v.duration > best.duration) best = v;
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

  async function tick() {
    const v = findVideo();
    if (!v) return;
    if (!isFinite(v.duration) || v.duration <= 0) return;
    if (v.currentTime <= 0) return;

    // 太短的视频不记
    if (v.duration < CONFIG.MIN_DURATION) return;

    const key = getVideoKey();
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
      title: getTitle(),
      url: getCleanUrl(),
      awemeId: getAwemeId() || "",
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
    const curId = getAwemeId();
    const curKey = getVideoKey();
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
      clearPending();
      toast("已跳到 " + fmtTime(target) + "，接着看吧");
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
      title.textContent = r.title || "抖音视频";
      title.title = r.title || "";

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

        if (getVideoKey() === r.key) {
          // 当前就是这个视频，直接跳
          const v = findVideo();
          if (v) {
            v.currentTime = target;
            v.play().catch(() => {});
            toast("已跳到 " + fmtTime(target));
            togglePanel(false);
            return;
          }
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
                at: Date.now(),
              },
            },
            () => {
              location.href = dest;
            }
          );
        } catch (e) {
          pendingResume = { key: r.key, time: target };
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
