/* ============================================================
 * 抖音续看 - 早期注入（document_start）
 *
 * 在页面开始加载时就执行，只有一个职责：
 *   把 inject.js 塞进页面的主世界，尽量早地挂上网络拦截，
 *   以免错过第一批接口请求。
 *
 * 为什么不在 manifest 里直接用 "world": "MAIN"？
 *   那个字段要 Chromium 111+ 才认，写错会导致整个扩展加载失败。
 *   用 script 标签注入兼容性更好，效果一样。
 * ============================================================ */
(function () {
  try {
    if (document.getElementById("dyrs-inject")) return;

    const s = document.createElement("script");
    s.id = "dyrs-inject";
    s.src = chrome.runtime.getURL("inject.js");
    s.onload = function () {
      s.remove();
    };

    const parent = document.head || document.documentElement;
    if (parent) parent.appendChild(s);
  } catch (e) {
    /* ignore */
  }
})();
