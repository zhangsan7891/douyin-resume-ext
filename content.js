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

  /** 生成视频唯一 key：优先用 aweme_id，退回 URL */
  function getVideoKey() {
    const url = new URL(location.href);
    // 抖音视频页通常形如 /video/7xxxxxxxxxxxxxxxxxx
    const m = location.pathname.match(/\/video\/(\d+)/);
    if (m) return "aweme:" + m[1];
    // 部分页面用 modal_id 参数
    const mid = url.searchParams.get("modal_id");
    if (mid) return "aweme:" + mid;
    // 兜底：去掉易变参数
    url.hash = "";
    return "url:" + url.origin + url.pathname;
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
      url: location.href,
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

  let pendingResume = null; // {key, time}

  async function tryResume() {
    if (!pendingResume) return;
    const v = findVideo();
    if (!v) return;
    if (!isFinite(v.duration) || v.duration <= 0) return;

    const key = getVideoKey();
    if (key !== pendingResume.key) return;

    const target = Math.min(pendingResume.time, v.duration - 1);
    if (target <= 0) {
      pendingResume = null;
      return;
    }
    try {
      v.currentTime = target;
      pendingResume = null;
      toast("已跳到 " + fmtTime(target) + "，接着看吧");
    } catch (e) {
      /* 忽略 */
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
        if (r.url) {
          pendingResume = { key: r.key, time: target };
          location.href = r.url;
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
        if (!p || !p.key || !p.time) return;
        if (Date.now() - (p.at || 0) > 60000) return; // 超过 1 分钟作废
        pendingResume = { key: p.key, time: p.time };
      });
    } catch (e) {
      /* ignore */
    }
  }

  buildUI();
  checkPendingResume();

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
