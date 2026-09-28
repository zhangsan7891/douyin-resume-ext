/* ============================================================
 * 抖音续看 - 页面注入脚本（跑在页面主世界 MAIN world）
 *
 * 为什么必须有这个文件：
 *   抖音首页推荐流（/ ?recommend=1）里，video.src 是
 *     blob:https://www.douyin.com/<随机UUID>
 *   每次加载页面都会变，URL 里也永远没有视频标识，DOM 上也不挂 id。
 *   → 光靠 DOM 和 URL，物理上拿不到任何视频 ID。
 *
 *   唯一的权威数据来源是抖音自己的接口响应，所以只能在这里拦截。
 *
 * 它只做一件事：把响应里的 aweme {id, desc, author} 通过 postMessage
 * 交给隔离世界的 content.js，由 content.js 用它算出真实视频 ID。
 *
 * 不发任何网络请求，不修改页面行为，只读取它自己已经收到的数据。
 * ============================================================ */
(function () {
  if (window.__dyrs_injected) return;
  window.__dyrs_injected = true;

  const MAX_ITEMS = 400;
  const seen = new Set();
  const cache = []; // 全量缓存：content.js 比我们晚启动，靠它补发

  /** 只关心抖音的 aweme 接口 */
  function isTargetUrl(u) {
    if (!u) return false;
    u = String(u);
    return u.indexOf("/aweme/v1/") >= 0;
  }

  /** 从一个 aweme 对象里抠出需要的字段 */
  function toItem(o) {
    const id = o.aweme_id || o.awemeId;
    if (!id) return null;
    let author = "";
    if (o.author) {
      author = o.author.nickname || o.author.nickName || "";
    }
    return {
      id: String(id),
      desc: typeof o.desc === "string" ? o.desc.slice(0, 120) : "",
      author: author || "",
    };
  }

  /** 递归扫描 JSON，收集所有 aweme 条目 */
  function harvest(obj, out, depth) {
    if (!obj || typeof obj !== "object" || depth > 7) return;
    if (out.length >= MAX_ITEMS) return;

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        harvest(obj[i], out, depth + 1);
        if (out.length >= MAX_ITEMS) return;
      }
      return;
    }

    if (obj.aweme_id || obj.awemeId) {
      const it = toItem(obj);
      if (it) out.push(it);
      return;
    }

    for (const k in obj) {
      const v = obj[k];
      if (v && typeof v === "object") {
        harvest(v, out, depth + 1);
        if (out.length >= MAX_ITEMS) return;
      }
    }
  }

  function send(items) {
    if (!items || !items.length) return;
    try {
      window.postMessage({ __dyrs: true, type: "aweme", items: items }, "*");
    } catch (e) {
      /* ignore */
    }
  }

  // content.js 启动后会发一条 want，我们把此前拦到的数据全量补发一次
  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__dyrs !== true || d.type !== "want") return;
    send(cache.slice());
    try {
      window.postMessage({ __dyrs: true, type: "ready" }, "*");
    } catch (e) {
      /* ignore */
    }
  });

  function handleText(text) {
    if (!text || typeof text !== "string") return;
    if (text.indexOf("aweme_id") < 0) return;

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return;
    }

    const out = [];
    harvest(json, out, 0);
    if (!out.length) return;

    const fresh = [];
    for (const it of out) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      fresh.push(it);
      cache.push(it);
      if (cache.length > MAX_ITEMS) cache.shift();
    }
    send(fresh);
  }

  /* ---------------- 拦截 fetch ---------------- */
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input) {
      const p = origFetch.apply(this, arguments);
      try {
        const u =
          (input && input.url) || (typeof input === "string" ? input : "");
        if (isTargetUrl(u)) {
          p.then(function (res) {
            try {
              res
                .clone()
                .text()
                .then(handleText)
                .catch(function () {});
            } catch (e) {
              /* ignore */
            }
          }).catch(function () {});
        }
      } catch (e) {
        /* ignore */
      }
      return p;
    };
  }

  /* ---------------- 拦截 XMLHttpRequest ---------------- */
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const origOpen = XHR.prototype.open;
    const origSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      try {
        this.__dyrs_url = url;
      } catch (e) {
        /* ignore */
      }
      return origOpen.apply(this, arguments);
    };

    XHR.prototype.send = function () {
      try {
        if (isTargetUrl(this.__dyrs_url)) {
          const self = this;
          this.addEventListener("load", function () {
            try {
              const rt = self.responseType;
              if (rt === "json" && self.response) {
                handleText(JSON.stringify(self.response));
              } else if (!rt || rt === "text") {
                handleText(self.responseText);
              }
            } catch (e) {
              /* ignore */
            }
          });
        }
      } catch (e) {
        /* ignore */
      }
      return origSend.apply(this, arguments);
    };
  }

  try {
    window.postMessage({ __dyrs: true, type: "ready" }, "*");
  } catch (e) {
    /* ignore */
  }
})();
