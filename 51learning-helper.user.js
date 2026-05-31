// ==UserScript==
// @name         51Learning Reading Workflow Helper
// @namespace    local.codex.51learning.workflow
// @version      1.1.0
// @description  51Learning 学习流程助手：收集文章队列、定时阅读、复制学习包、保存答案、一键填入已确认的答案（不自动提交）
// @match        http://reading.51learning.com.cn:8080/Reading/*
// @license      MIT
// @homepageURL  https://github.com/zhourunfaaaaaa/51learning-helper
// @supportURL   https://github.com/zhourunfaaaaaa/51learning-helper/issues
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const APP = "cl51wf";
  const STORE = `${APP}:`;

  const DEFAULT_CONFIG = {
    b: "7",
    u: "71",
    limit: 10,
    displayMode: "完整阅读",
    revealMode: "逐段",
    speedMode: "中(每分钟100个)",
    minMinutes: 5,
    maxMinutes: 7,
  };

  const state = {
    tickId: null,
  };

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function $$(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function clean(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function compact(text) {
    return clean(text).replace(/\s+/g, "");
  }

  function htmlEscape(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getConfig() {
    return { ...DEFAULT_CONFIG, ...loadJson(`${STORE}config`, {}) };
  }

  function saveConfig(config) {
    saveJson(`${STORE}config`, config);
  }

  function getParams() {
    const params = new URLSearchParams(location.search);
    return {
      b: params.get("b") || $("#bId")?.value || getConfig().b,
      u: params.get("u") || $("#pId")?.value || getConfig().u,
      passageId: params.get("passageId") || $("#id")?.value || "",
      page: Number(params.get("page") || 1),
      limit: Number(params.get("limit") || getConfig().limit),
    };
  }

  function unitKey(b, u) {
    return `${b}:${u}`;
  }

  function currentUnitKey() {
    const params = getParams();
    return unitKey(params.b, params.u);
  }

  function currentPassageKey() {
    const params = getParams();
    return `${currentUnitKey()}:${params.passageId}`;
  }

  function isArticlePage() {
    return /\/Reading\/ArticleItem/i.test(location.pathname);
  }

  function isListPage() {
    return /\/Reading\/Articles/i.test(location.pathname);
  }

  function queueKey(key = currentUnitKey()) {
    return `${STORE}queue:${key}`;
  }

  function doneKey(key = currentUnitKey()) {
    return `${STORE}done:${key}`;
  }

  function positionKey(key = currentUnitKey()) {
    return `${STORE}position:${key}`;
  }

  function answerDbKey() {
    return `${STORE}answerDb`;
  }

  function timerKey() {
    return `${STORE}timer:${currentPassageKey()}`;
  }

  function timerPausedKey() {
    return `${STORE}timerPaused:${currentPassageKey()}`;
  }

  function getQueue(key = currentUnitKey()) {
    return loadJson(queueKey(key), { unit: key, items: [], createdAt: null });
  }

  function saveQueue(queue) {
    saveJson(queueKey(queue.unit || currentUnitKey()), queue);
  }

  function getDone(key = currentUnitKey()) {
    return loadJson(doneKey(key), {});
  }

  function saveDone(done, key = currentUnitKey()) {
    saveJson(doneKey(key), done);
  }

  function savePosition(index, key = currentUnitKey()) {
    if (Number.isFinite(index) && index >= 0) localStorage.setItem(positionKey(key), String(index));
  }

  function readPosition(key = currentUnitKey()) {
    const value = Number(localStorage.getItem(positionKey(key)));
    return Number.isFinite(value) && value >= 0 ? value : -1;
  }

  function clearUnitData(key = currentUnitKey()) {
    localStorage.removeItem(queueKey(key));
    localStorage.removeItem(doneKey(key));
    localStorage.removeItem(positionKey(key));
    renderQueueSummary();
  }

  function getAnswerDb() {
    return loadJson(answerDbKey(), {});
  }

  function saveAnswerDb(db) {
    saveJson(answerDbKey(), db);
  }

  function currentAnswers() {
    const db = getAnswerDb();
    const id = getParams().passageId;
    return id ? db[id] : undefined;
  }

  function setCurrentAnswers(answers) {
    const id = getParams().passageId;
    if (!id) throw new Error("No passageId on this page.");
    const db = getAnswerDb();
    db[id] = answers;
    saveAnswerDb(db);
  }

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isHelperElement(el) {
    return Boolean(el.closest?.("#cl51-panel"));
  }

  function elementText(el) {
    return clean(el.value || el.innerText || el.textContent || el.getAttribute?.("title") || "");
  }

  function candidates() {
    return $$("button, a, input[type='button'], input[type='submit'], input[type='radio'], label, span, div, li, [role='button'], .btn, .btn-u, .layui-btn")
      .filter((el) => {
        if (isHelperElement(el) || !isVisible(el)) return false;
        return elementText(el);
      });
  }

  function actionCandidates() {
    return $$("button, a, input[type='button'], input[type='submit'], label, [role='button'], .btn, .btn-u, .layui-btn")
      .filter((el) => {
        if (isHelperElement(el) || !isVisible(el)) return false;
        return elementText(el);
      });
  }

  function findByText(labels, mode = "exact") {
    const wanted = labels.map(compact).filter(Boolean);
    return candidates().find((el) => {
      const text = compact(el.value || el.innerText || el.textContent || "");
      if (!text) return false;
      return wanted.some((label) => mode === "contains" ? text.includes(label) : text === label);
    });
  }

  function findActionByText(labels, mode = "exact") {
    const wanted = labels.map(compact).filter(Boolean);
    const actions = actionCandidates();
    const exact = actions.find((el) => {
      const text = compact(elementText(el));
      return wanted.some((label) => text === label);
    });
    if (exact) return exact;
    if (mode === "contains") {
      const contains = actions.find((el) => {
        const text = compact(elementText(el));
        return wanted.some((label) => text.includes(label));
      });
      if (contains) return contains;
    }
    const container = candidates().find((el) => {
      const text = compact(elementText(el));
      return wanted.some((label) => mode === "contains" ? text.includes(label) : text === label);
    });
    if (!container) return null;
    return actionCandidates().find((el) => container.contains(el)) || container;
  }

  function findDirectActionByText(labels, mode = "exact") {
    const wanted = labels.map(compact).filter(Boolean);
    return actionCandidates().find((el) => {
      const text = compact(elementText(el));
      if (!text) return false;
      return wanted.some((label) => mode === "contains" ? text.includes(label) : text === label);
    }) || null;
  }

  function findSiteStartButton() {
    return findDirectActionByText(["开始阅读"], "contains");
  }

  function findSiteFinishButton() {
    return findDirectActionByText(["完成阅读", "阅读完成"], "contains");
  }

  function findSiteSubmitButton() {
    return findDirectActionByText(["提交答案"], "contains");
  }

  function robustClick(el) {
    if (!el) return false;
    const target = el.closest?.("button, a, input, label, [role='button'], .btn, .btn-u, .layui-btn") || el;
    target.scrollIntoView?.({ block: "center", inline: "center" });
    for (const type of ["pointerdown", "mousedown", "mouseup", "pointerup", "click"]) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    if (typeof target.click === "function") target.click();
    return true;
  }

  function clickByText(label, mode = "exact") {
    const el = findActionByText([label], mode) || findByText([label], mode);
    if (!el) return false;
    return robustClick(el);
  }

  function configFromUi() {
    const config = {
      b: $("#cl51-b")?.value || getConfig().b,
      u: $("#cl51-u")?.value || getConfig().u,
      limit: Number($("#cl51-limit")?.value || getConfig().limit),
      displayMode: $("#cl51-display")?.value || getConfig().displayMode,
      revealMode: $("#cl51-reveal")?.value || getConfig().revealMode,
      speedMode: $("#cl51-speed")?.value || getConfig().speedMode,
    };
    saveConfig(config);
    return config;
  }

  function chooseMode() {
    const config = configFromUi();
    const clicked = {
      display: clickByText(config.displayMode),
      reveal: clickByText(config.revealMode),
      speed: clickByText(config.speedMode),
    };
    const total = Object.values(clicked).filter(Boolean).length;
    setStatus(`阅读模式选择完成：${total}/3`);
    return clicked;
  }

  function countArticleWords() {
    const text = articleText();
    if (!text) return 0;
    const words = text.split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
    return words.length;
  }

  function parseSpeedWpm(speedMode) {
    const match = (speedMode || "").match(/每分钟(\d+)个/);
    return match ? Number(match[1]) : 100;
  }

  function estimatedMinutes(config) {
    const wpm = parseSpeedWpm(config.speedMode || DEFAULT_CONFIG.speedMode);
    const words = countArticleWords();
    if (!words) return 5; // 取不到词数时默认5分钟
    const minutes = words / wpm;
    const jitter = 0.85 + Math.random() * 0.3; // ±15% 自然抖动
    return Math.max(2, Math.min(30, minutes * jitter));
  }

  function startReading() {
    if (!isArticlePage()) {
      setStatus("请先打开具体文章页。");
      return;
    }
    const config = configFromUi();
    localStorage.removeItem(timerPausedKey());
    const modeClicks = chooseMode();
    const start = findStartButton();
    if (!start) {
      setStatus(`没有找到“开始阅读”按钮。模式点击：${Object.values(modeClicks).filter(Boolean).length}/3。请截图给我看当前按钮区。`);
      return;
    }
    robustClick(start);
    const targetMinutes = estimatedMinutes(config);
    saveJson(timerKey(), {
      startedAt: Date.now(),
      targetMs: Math.round(targetMinutes * 60 * 1000),
      notified: false,
      pendingStartCheck: true,
    });
    startTicker();
    setTimeout(updateTimerUi, 3200);
    const wordCount = countArticleWords();
    const wpm = parseSpeedWpm(config.speedMode || DEFAULT_CONFIG.speedMode);
    setStatus(`已开始阅读（约 ${wordCount} 词，${wpm} 词/分钟），目标 ${targetMinutes.toFixed(1)} 分钟。`);
  }

  function findStartButton() {
    const byText = findSiteStartButton() || findActionByText(["开始阅读"], "contains");
    if (byText) return byText;
    const greenButtons = $$("button, a, input[type='button'], input[type='submit'], .btn, .btn-u, .layui-btn")
      .filter((el) => !isHelperElement(el) && isVisible(el))
      .filter((el) => {
        const text = elementText(el);
        const className = String(el.className || "").toLowerCase();
        const color = getComputedStyle(el).backgroundColor;
        return /start|read|success|green|btn-u/.test(className)
          || /开始|阅读/.test(text)
          || /rgb\((?:[0-9]+,\s*)?(?:1[2-9][0-9]|2[0-5][0-9]),\s*(?:[0-9]+)\)/.test(color);
      });
    return greenButtons[0] || null;
  }

  function readTimer() {
    return loadJson(timerKey(), null);
  }

  function clearTimer() {
    localStorage.removeItem(timerKey());
    localStorage.setItem(timerPausedKey(), "1");
    if (state.tickId) {
      clearInterval(state.tickId);
      state.tickId = null;
    }
    updateTimerUi();
  }

  function readSiteElapsedMs() {
    const text = pageTextWithoutHelper();
    const minSec = text.match(/阅读时间\s*[:：]?\s*(\d+)\s*[:：]\s*(\d+)\s*min/i);
    if (minSec) return (Number(minSec[1]) * 60 + Number(minSec[2])) * 1000;
    const seconds = text.match(/阅读时间\s*[:：]?\s*(\d+)\s*(?:\(|（)?\s*秒/i);
    if (seconds) return Number(seconds[1]) * 1000;
    const decimalMinutes = text.match(/阅读时间\s*[:：]?\s*(\d+(?:\.\d+)?)\s*min/i);
    if (decimalMinutes) return Number(decimalMinutes[1]) * 60 * 1000;
    return 0;
  }

  function siteReadingInProgress() {
    const pageStatus = detectCurrentPageSiteStatus();
    return pageStatus === "阅读中" || Boolean(findSiteFinishButton() || readSiteElapsedMs() > 0);
  }

  function adoptSiteTimerIfNeeded() {
    if (!isArticlePage() || readTimer() || localStorage.getItem(timerPausedKey()) === "1" || !siteReadingInProgress()) return false;
    const config = getConfig();
    const siteElapsed = readSiteElapsedMs();
    const targetMinutes = estimatedMinutes(config);
    saveJson(timerKey(), {
      startedAt: Date.now() - siteElapsed,
      targetMs: Math.round(Math.max(targetMinutes * 60 * 1000, siteElapsed + 1000)),
      notified: false,
      adoptedFromSite: true,
    });
    setStatus(`已同步网页阅读计时，目标约 ${targetMinutes.toFixed(1)} 分钟。`);
    return true;
  }

  function syncTimerWithSite(timer) {
    const siteElapsed = readSiteElapsedMs();
    if (!siteElapsed) return timer;
    const localElapsed = Date.now() - timer.startedAt;
    if (Math.abs(localElapsed - siteElapsed) < 2500) return timer;
    const synced = {
      ...timer,
      startedAt: Date.now() - siteElapsed,
      targetMs: Math.max(timer.targetMs || 0, siteElapsed + 1000),
      adoptedFromSite: timer.adoptedFromSite || true,
    };
    saveJson(timerKey(), synced);
    return synced;
  }

  function startTicker() {
    if (state.tickId) clearInterval(state.tickId);
    state.tickId = setInterval(updateTimerUi, 1000);
    updateTimerUi();
  }

  function formatTime(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function updateTimerUi() {
    const timerEl = $("#cl51-timer");
    if (!timerEl) return;
    const finishButton = $("#cl51-finish");
    const siteFinishAvailable = Boolean(findSiteFinishButton());
    let timer = readTimer();
    const pageStatusNow = detectCurrentPageSiteStatus();
    const justClickedStart = timer?.startedAt && timer.pendingStartCheck && Date.now() - timer.startedAt < 6000;
    if (pageStatusNow === "未开始" && !justClickedStart) {
      if (!timer?.startedAt) {
        timerEl.textContent = "计时：未开始";
        if (finishButton) finishButton.disabled = true;
        return;
      }
      // 有计时但页面回到未开始状态（可能切换了文章），清除旧计时
      localStorage.removeItem(timerKey());
      timerEl.textContent = "计时：未开始";
      if (finishButton) finishButton.disabled = true;
      renderQueueSummary();
      return;
    }
    if (pageStatusNow === "已读完" || pageStatusNow === "待提交" || pageStatusNow === "已完成") {
      if (state.tickId) {
        clearInterval(state.tickId);
        state.tickId = null;
      }
      const siteElapsed = readSiteElapsedMs();
      const finalElapsed = siteElapsed || (timer?.startedAt ? Date.now() - timer.startedAt : 0);
      localStorage.removeItem(timerKey());
      timerEl.textContent = finalElapsed ? `计时：${formatTime(finalElapsed)} 已结束` : "计时：已结束";
      if (finishButton) finishButton.disabled = true;
      renderQueueSummary();
      return;
    }
    if (localStorage.getItem(timerPausedKey()) === "1" && !readTimer()) {
      const siteElapsed = readSiteElapsedMs();
      if (pageStatusNow === "阅读中") {
        timerEl.textContent = siteElapsed ? `计时：已停止（网页 ${formatTime(siteElapsed)}）` : "计时：已停止";
        if (finishButton) finishButton.disabled = !siteFinishAvailable;
      } else {
        timerEl.textContent = "计时：未开始";
        if (finishButton) finishButton.disabled = true;
      }
      return;
    }
    adoptSiteTimerIfNeeded();
    timer = readTimer();
    if (!timer?.startedAt) {
      timerEl.textContent = "计时：未开始";
      if (finishButton) finishButton.disabled = !siteFinishAvailable;
      return;
    }
    timer = syncTimerWithSite(timer);
    const elapsed = Date.now() - timer.startedAt;
    const siteActive = siteReadingInProgress();
    const siteElapsed = readSiteElapsedMs();
    const startVisible = findSiteStartButton();
    if (isArticlePage() && elapsed > 6000 && startVisible && !siteActive && !siteElapsed) {
      localStorage.removeItem(timerKey());
      timerEl.textContent = "计时：未开始";
      if (finishButton) finishButton.disabled = true;
      setStatus("检测到页面仍在“开始阅读”状态，已清除旧计时。请重新点“选模式并开始”，或手动点网页绿色开始按钮。");
      return;
    }
    const ready = elapsed >= timer.targetMs;
    timerEl.textContent = `计时：${formatTime(elapsed)} / ${formatTime(timer.targetMs)}`;
    if (finishButton) finishButton.disabled = !(ready || siteFinishAvailable);
    if (ready && !timer.notified) {
      timer.notified = true;
      saveJson(timerKey(), timer);
      setStatus("计时到达，正在自动点击“完成阅读”...");
      setTimeout(() => {
        // 自动完成，不再弹窗确认
        if (clickSiteFinishButton()) {
          setStatus("已自动点击完成阅读。题目出现后可复制模板或填入答案。");
        } else {
          setStatus("没有找到完成阅读按钮。可能题目已经出现，或页面按钮文字不同。");
        }
      }, 100);
    }
  }

  function clickSiteFinishButton() {
    const finish = findSiteFinishButton() || findActionByText(["完成阅读", "阅读完成"], "contains");
    if (!finish) return false;
    return robustClick(finish);
  }

  function finishReading() {
    const timer = readTimer();
    const siteFinishAvailable = Boolean(findSiteFinishButton());
    if (timer?.startedAt && !siteFinishAvailable) {
      const elapsed = Date.now() - timer.startedAt;
      if (elapsed < timer.targetMs) {
        setStatus("网页还没有出现“完成阅读”按钮，计时也没到。");
        return;
      }
    } else if (!timer?.startedAt && !siteFinishAvailable) {
      setStatus("当前网页没有可点击的“完成阅读”按钮。");
      return;
    }
    if (!confirm("确认点击网站的“完成阅读”按钮？题目出现后请自己检查再提交。")) return;
    if (!clickSiteFinishButton()) {
      setStatus("没有找到完成阅读按钮。可能题目已经出现，或页面按钮文字不同。");
      return;
    }
    setStatus("已点击完成阅读。等待题目出现后可复制题目或填入已保存答案。");
  }

  function parseListDocument(doc, sourceUrl) {
    const items = [];
    const seen = new Set();
    for (const card of $$(".blog-grid", doc)) {
      const link = $("h3 a[href*='/Reading/ArticleItem']", card) || $("a[href*='/Reading/ArticleItem']", card);
      if (!link) continue;
      const url = new URL(link.getAttribute("href"), sourceUrl || location.href);
      const passageId = url.searchParams.get("passageId") || "";
      const id = passageId || url.href;
      if (seen.has(id)) continue;
      seen.add(id);
      items.push({
        passageId,
        title: clean(link.textContent),
        status: normalizeSiteStatus(clean($("h3 span", card)?.textContent || "")),
        url: url.href,
        intro: clean($("div[style*='text-align']", card)?.textContent || ""),
      });
    }
    const countText = clean(doc.body?.textContent || "");
    const countMatch = countText.match(/共\s*(\d+)\s*条/);
    const dataPages = $$("[data-page]", doc)
      .map((el) => Number(el.getAttribute("data-page")))
      .filter((value) => Number.isFinite(value) && value > 0);
    const inputPage = Number($(".layui-laypage-skip input", doc)?.value || 0);
    const visiblePages = $$(".layui-laypage a, .layui-laypage em", doc)
      .map((el) => Number(clean(el.textContent)))
      .filter((value) => Number.isFinite(value) && value > 0);
    const pageCount = Math.max(0, inputPage, ...dataPages, ...visiblePages);
    return {
      count: countMatch ? Number(countMatch[1]) : null,
      pageCount: pageCount || null,
      items,
    };
  }

  function currentPageList() {
    return parseListDocument(document, location.href);
  }

  function normalizeSiteStatus(status) {
    const text = clean(status).replace(/^\[|\]$/g, "");
    if (!text) return "";
    if (/已完成|完成练习|答题准确率|机会已用完/.test(text)) return "已完成";
    if (/未完成/.test(text)) return "未完成";
    return text;
  }

  function detectCurrentPageSiteStatus(doc = document) {
    const text = pageTextWithoutHelper(doc);
    if (doc !== document) {
      if (/已完成练习|答题准确率|机会已用完/.test(text)) return "已完成";
      if (/未完成/.test(text)) return "未完成";
      if (/完成日期\s*[:：]?/.test(text)) return /提交答案/.test(text) ? "待提交" : "已读完";
      if (/提交答案/.test(text)) return "待提交";
      if (/完成阅读/.test(text) || /阅读时间\s*[:：]?/.test(text)) return "阅读中";
      if (/开始阅读/.test(text)) return "未开始";
      return "";
    }
    const hasStart = Boolean(findSiteStartButton());
    const hasFinish = Boolean(findSiteFinishButton());
    const hasSubmit = Boolean(findSiteSubmitButton());
    const hasArticle = articleVisible();
    const hasElapsed = readSiteElapsedMs() > 0;
    if (/已完成练习|答题准确率|机会已用完/.test(text)) return "已完成";
    if (/完成日期\s*[:：]?/.test(text)) {
      if (hasSubmit) return "待提交";
      return "已读完";
    }
    if (hasSubmit) return "待提交";
    if (hasFinish || hasArticle || hasElapsed) return "阅读中";
    if (hasStart) return "未开始";
    if (/开始阅读/.test(text)) return "未开始";
    return "";
  }

  function articleVisible() {
    const article = $("#articleContent");
    return Boolean(article && isVisible(article) && clean(article.textContent).length > 80);
  }

  function pageTextWithoutHelper(doc = document) {
    const body = doc.body;
    if (!body) return "";
    if (doc !== document) return clean(body.textContent || "");
    return visiblePageTextWithoutHelper();
  }

  function visiblePageTextWithoutHelper() {
    const body = document.body;
    if (!body) return "";
    const pieces = [];
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const value = clean(node.nodeValue || "");
        const parent = node.parentElement;
        if (!value || !parent) return NodeFilter.FILTER_REJECT;
        if (isHelperElement(parent)) return NodeFilter.FILTER_REJECT;
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/i.test(parent.tagName || "")) return NodeFilter.FILTER_REJECT;
        if (!isVisible(parent)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) pieces.push(walker.currentNode.nodeValue || "");
    return clean(pieces.join(" "));
  }

  function updateCurrentQueueStatusFromPage() {
    if (!isArticlePage()) return "";
    const status = detectCurrentPageSiteStatus();
    const params = getParams();
    if (!status || !params.passageId) return status;
    const key = currentUnitKey();
    const queue = getQueue(key);
    const item = queue.items.find((entry) => entry.passageId === params.passageId);
    if (item && item.status !== status) {
      item.status = status;
      saveQueue(queue);
    }
    return status;
  }

  async function collectUnitQueue() {
    const config = configFromUi();
    const key = unitKey(config.b, config.u);
    const makeListUrl = (page) => {
      const url = new URL("/Reading/Articles", location.origin);
      url.searchParams.set("b", config.b);
      url.searchParams.set("u", config.u);
      url.searchParams.set("page", String(page));
      url.searchParams.set("limit", String(config.limit));
      return url;
    };
    const firstUrl = makeListUrl(1);

    setStatus("正在用当前登录状态读取列表页...");
    const first = await fetchDocument(firstUrl.href);
    const firstParsed = parseListDocument(first, firstUrl.href);
    if (!firstParsed.items.length && /登录|UserName|Password/.test(first.body?.textContent || "")) {
      setStatus("网站返回登录页。请先登录后再收集。");
      return;
    }
    const total = firstParsed.count || null;
    const pagesFromCount = total ? Math.ceil(total / config.limit) : 0;
    const pages = Math.max(1, firstParsed.pageCount || 0, pagesFromCount || 0);
    const all = [...firstParsed.items];
    const seen = new Set(all.map((item) => item.passageId || item.url));

    for (let page = 2; page <= pages; page += 1) {
      const pageUrl = makeListUrl(page);
      setStatus(`正在读取列表页 ${page}/${pages}...`);
      const doc = await fetchDocument(pageUrl.href);
      const parsed = parseListDocument(doc, pageUrl.href);
      if (!parsed.items.length && /登录|UserName|Password/.test(doc.body?.textContent || "")) {
        setStatus(`第 ${page} 页返回登录页。请确认登录状态后重试。`);
        return;
      }
      for (const item of parsed.items) {
        const id = item.passageId || item.url;
        if (!seen.has(id)) {
          seen.add(id);
          all.push(item);
        }
      }
    }

    if (!total && pages <= 1) {
      let emptyOrDuplicatePages = 0;
      for (let page = 2; page <= 12; page += 1) {
        const before = all.length;
        const pageUrl = makeListUrl(page);
        setStatus(`正在探测列表页 ${page}...`);
        const doc = await fetchDocument(pageUrl.href);
        const parsed = parseListDocument(doc, pageUrl.href);
        for (const item of parsed.items) {
          const id = item.passageId || item.url;
          if (!seen.has(id)) {
            seen.add(id);
            all.push(item);
          }
        }
        if (all.length === before) emptyOrDuplicatePages += 1;
        if (!parsed.items.length || emptyOrDuplicatePages >= 2) break;
      }
    }

    const queue = {
      unit: key,
      source: firstUrl.href,
      createdAt: new Date().toISOString(),
      items: all,
    };
    saveQueue(queue);
    renderQueueSummary();
    await copy(JSON.stringify(queue, null, 2));
    if (total && all.length < total) {
      setStatus(`已收集 ${all.length}/${total} 篇。还有分页未抓到，请刷新列表页后再点“收集本单元”。`);
    } else {
      setStatus(`已收集 ${all.length}/${total || "未知总数"} 篇文章，并复制队列 JSON。`);
    }
  }

  async function fetchDocument(url) {
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    const text = await response.text();
    return new DOMParser().parseFromString(text, "text/html");
  }

  function openNextArticle() {
    openQueueArticle(1);
  }

  function openPreviousArticle() {
    openQueueArticle(-1);
  }

  function openQueueArticle(direction) {
    const config = configFromUi();
    const key = unitKey(config.b, config.u);
    const queue = getQueue(key);
    if (!queue.items.length) {
      setStatus("还没有队列，请先点“收集本单元”。");
      return;
    }

    const current = getParams().passageId;
    const currentIndex = current
      ? queue.items.findIndex((item) => item.passageId === current)
      : -1;

    updateCurrentQueueStatusFromPage();

    const targetIndex = currentIndex >= 0
      ? currentIndex + direction
      : direction > 0 ? 0 : queue.items.length - 1;
    const target = queue.items[targetIndex];
    if (!target) {
      setStatus(direction > 0 ? "已经到队列最后一篇了。" : "已经到队列第一篇了。");
      return;
    }
    savePosition(targetIndex, key);
    location.href = target.url;
  }

  function getTitle() {
    const title = clean($("h1.blog-grid-title-lg, h2.blog-grid-title-lg, h1, h2, h3")?.textContent || "");
    return title || document.title;
  }

  function questionFields() {
    const fields = [];
    const seenNames = new Set();

    $$("input[type='hidden']").filter((input) =>
      /^questions\[\d+\]\.subQuestions\[\d+\]\.id$/.test(input.name || "")
    ).forEach((hidden) => {
      const match = hidden.name.match(/^questions\[(\d+)\]\.subQuestions\[(\d+)\]\.id$/);
      const taskIndex = match ? Number(match[1]) : 0;
      const subIndex = match ? Number(match[2]) : fields.length;
      const answerName = hidden.name.replace(/\.id$/, ".userAnswerText");
      seenNames.add(answerName);
      const block = hidden.closest("div[id^='question']") || hidden.parentElement || hidden;
      fields.push(buildQuestionField({
        index: fields.length + 1,
        taskIndex,
        subIndex,
        id: hidden.value,
        answerName,
        block,
      }));
    });

    for (const answerName of answerNamesOnPage()) {
      if (seenNames.has(answerName)) continue;
      const match = answerName.match(/^questions\[(\d+)\](?:\.subQuestions\[(\d+)\])?\.userAnswerText$/);
      if (!match) continue;
      const taskIndex = Number(match[1]);
      const subIndex = match[2] == null ? nextSubIndex(fields, taskIndex) : Number(match[2]);
      const field = answerFieldByName(answerName);
      if (!field) continue;
      const block = getQuestionBlockForField(field, taskIndex);
      fields.push(buildQuestionField({
        index: fields.length + 1,
        taskIndex,
        subIndex,
        id: "",
        answerName,
        block,
      }));
    }

    return fields;
  }

  function answerNamesOnPage() {
    const names = new Set();
    for (const field of $$("textarea[name*='questions'], input[type='text'][name*='questions'], input[type='radio'][name*='questions']")) {
      if (/\.userAnswerText$/.test(field.name || "")) names.add(field.name);
    }
    return Array.from(names);
  }

  function answerFieldByName(answerName) {
    return $$("textarea, input[type='text'], input[type='radio']").find((field) => field.name === answerName) || null;
  }

  function nextSubIndex(fields, taskIndex) {
    const indexes = fields.filter((field) => field.taskIndex === taskIndex).map((field) => field.subIndex);
    return indexes.length ? Math.max(...indexes) + 1 : 0;
  }

  function getQuestionBlockForField(field, taskIndex) {
    const questionDiv = field.closest("div[id^='question']");
    if (questionDiv && clean(questionDiv.textContent)) return questionDiv;
    const taskBlock = getTaskBlock(taskIndex, field);
    if (taskBlock && clean(taskBlock.textContent)) return taskBlock;
    return field.parentElement || field;
  }

  function buildQuestionField({ index, taskIndex, subIndex, id, answerName, block }) {
    const taskBlock = getTaskBlock(taskIndex, block);
    const taskTitle = getTaskTitle(taskBlock, taskIndex);
    const radios = $$("input[type='radio']").filter((input) => input.name === answerName);
    const textarea = $$("textarea").find((input) => input.name === answerName);
    const text = $$("input[type='text']").find((input) => input.name === answerName);
    const field = textarea || text || radios[0] || null;
    const type = radios.length ? "radio" : textarea ? "textarea" : text ? "text" : "unknown";
    const prompt = extractPrompt(block, answerName);
    const taskKey = inferTaskKey(taskTitle, taskIndex, type, prompt, radios);
    return {
      index,
      taskIndex,
      subIndex,
      taskKey,
      taskTitle,
      id,
      answerName,
      type,
      field,
      radios,
      block,
      prompt,
      options: radios.map((radio) => ({
        value: radio.value,
        text: clean(radio.parentElement?.textContent || radio.value),
      })),
    };
  }

  function getTaskBlock(taskIndex, fallback) {
    const taskInput = $(`input[type='hidden'][name="questions[${taskIndex}].id"]`);
    const sibling = taskInput?.nextElementSibling;
    if (sibling?.matches?.("div[id^='question']")) return sibling;
    return fallback.closest(".col-md-12") || fallback;
  }

  function getTaskTitle(taskBlock, taskIndex) {
    const strongs = $$("strong", taskBlock).map((el) => clean(el.textContent)).filter(Boolean);
    return strongs.find((text) => /task\s*\d+/i.test(text)) || strongs[0] || `Task ${taskIndex + 1}`;
  }

  function taskKeyFromTitle(title, taskIndex) {
    const text = title.toLowerCase();
    if (/vocabulary|word bank|fill in the blanks/.test(text)) return "vocabulary";
    if (/information matching|matching|paragraph/.test(text)) return "matching";
    if (/multiple choice|choose the best|choice/.test(text)) return "multiple_choice";
    if (/translation|translate/.test(text)) return "translation";
    if (/critical thinking|case study|answer the questions|questions for critical/.test(text)) return "critical_thinking";
    if (/writing practice|essay|write an essay|writing/.test(text)) return "writing";
    return `task${taskIndex + 1}`;
  }

  function inferTaskKey(title, taskIndex, type, prompt, radios) {
    const byTitle = taskKeyFromTitle(title, taskIndex);
    if (!/^task\d+$/.test(byTitle)) return byTitle;
    const text = `${title} ${prompt}`.toLowerCase();
    if (/critical thinking|case study|answer the questions|learning objectives/.test(text)) return "critical_thinking";
    if (/writing practice|write an essay|essay|at least \d+ words|no more than \d+ words/.test(text)) return "writing";
    if (/translate|translation|from chinese into english|[\u4e00-\u9fff].*(翻译|译)/.test(text)) return "translation";
    if (/paragraph|information matching|identify the paragraph|段落|匹配/.test(text)) return "matching";
    if (/choose the best|multiple choice|which of the following|what is|why is/.test(text) && (type === "radio" || radios.length)) {
      return "multiple_choice";
    }
    if (/fill in the blanks|word bank|blank|词汇|填空/.test(text)) return "vocabulary";
    if (type === "radio") return "multiple_choice";
    return byTitle;
  }

  function extractPrompt(block, answerName) {
    const clone = block.cloneNode(true);
    for (const field of $$("input, textarea, select, button", clone)) field.remove();
    let text = clean(clone.textContent);
    text = text.replace(new RegExp(answerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "");
    return text;
  }

  function articleText() {
    const article = $("#articleContent");
    if (article) return clean(article.textContent);
    return "";
  }

  function articleParagraphLabels() {
    const text = articleText();
    const labels = [];
    const seen = new Set();
    for (const match of text.matchAll(/\[([A-Z])\]/g)) {
      if (!seen.has(match[1])) {
        seen.add(match[1]);
        labels.push(match[1]);
      }
    }
    return labels;
  }

  function questionsPayload(includeArticle) {
    const params = getParams();
    const questions = questionFields().map((q) => ({
      index: q.index,
      taskKey: q.taskKey,
      taskTitle: q.taskTitle,
      numberInTask: q.subIndex + 1,
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      options: q.options,
    }));
    const payload = {
      passageId: params.passageId,
      title: getTitle(),
      url: location.href,
      copiedAt: new Date().toISOString(),
      questions,
    };
    if (includeArticle) payload.article = articleText();
    return payload;
  }

  function questionsPlainText(includeArticle) {
    const questions = questionFields();
    const lines = [];
    const title = getTitle();
    if (title) lines.push(title, "");
    if (includeArticle) {
      const article = articleText();
      if (article) lines.push("【文章】", article, "");
    }
    lines.push("【题目】");
    if (!questions.length) {
      lines.push("题目尚未显示。请先完成阅读。");
      return lines.join("\n");
    }
    for (const group of groupQuestionsByTask(questions)) {
      lines.push("", group.title || simpleTaskName(group.key));
      for (const question of group.questions) {
        lines.push(questionPlainLine(question));
      }
    }
    return lines.join("\n");
  }

  function questionPlainLine(question) {
    let text = clean(question.prompt);
    if (question.options.length) {
      for (const option of question.options) {
        if (!text.includes(option.text)) {
          text += ` ${option.text}`;
        }
      }
    }
    return `${question.subIndex + 1}. ${text}`;
  }

  async function copyQuestions() {
    const count = questionFields().length;
    if (!count) {
      setStatus("没有找到题目。请先完成阅读，让题目显示出来。");
      return;
    }
    await copy(questionsPlainText(false));
    setStatus(`已复制 ${count} 道题的纯文本。`);
  }

  async function copyStudyPacket() {
    const qCount = questionFields().length;
    await copy(questionsPlainText(true));
    setStatus(qCount ? `已复制文章和 ${qCount} 道题的纯文本。` : "已复制文章纯文本。题目可能还没显示。");
  }

  async function copyAnswerTemplate() {
    const qs = questionFields();
    if (!qs.length) {
      setStatus("没有题目，无法生成答案模板。");
      return;
    }
    const groups = groupQuestionsByTask(qs);
    const lines = [
      "51Learning答案模板",
      "填写方法：不要改【】标题；每题一行，把答案写在题号后面。",
      "填空/匹配/选择题写字母；翻译/问答题写完整句子。",
      "",
    ];
    const labels = articleParagraphLabels();
    if (labels.length) lines.push(`文章段落：${labels.join(" ")}`, "");
    for (const group of groups) {
      lines.push(`【${group.key} ${simpleTaskName(group.key)}】`);
      for (const question of group.questions) {
        lines.push(`${question.subIndex + 1}. `);
      }
      lines.push("");
    }
    await copy(lines.join("\n"));
    setStatus("已复制简易答案模板。按题号填好后粘回脚本框即可。");
  }

  async function copyJsonAnswerTemplate() {
    const qs = questionFields();
    if (!qs.length) {
      setStatus("没有题目，无法生成答案模板。");
      return;
    }
    const sections = {};
    const sectionMeta = {};
    const flatAnswers = {};
    const byId = {};
    for (const q of qs) {
      if (!sections[q.taskKey]) sections[q.taskKey] = [];
      if (!sectionMeta[q.taskKey]) {
        sectionMeta[q.taskKey] = {
          title: q.taskTitle,
          count: 0,
          type: q.type,
        };
      }
      sections[q.taskKey][q.subIndex] = "";
      sectionMeta[q.taskKey].count += 1;
      flatAnswers[String(q.index)] = "";
      byId[q.id] = q.type === "radio" ? "" : "";
    }
    const payload = {
      format: "51learning-answer-template-v2",
      passageId: getParams().passageId,
      title: getTitle(),
      guide: "Fill answers by section. vocabulary/matching/multiple_choice use option or paragraph letters; translation uses full English sentences. Counts follow this page, so shorter or longer translation/matching sets are OK.",
      paragraphLabels: articleParagraphLabels(),
      sectionMeta,
      answers: sections,
      flatAnswers,
      byQuestionId: byId,
    };
    await copy(JSON.stringify(payload, null, 2));
    setStatus("已复制 JSON 答案模板。填好后粘回脚本框即可。");
  }

  function groupQuestionsByTask(questions) {
    const order = [];
    const map = {};
    for (const question of questions) {
      if (!map[question.taskKey]) {
        map[question.taskKey] = { key: question.taskKey, title: question.taskTitle, questions: [] };
        order.push(question.taskKey);
      }
      map[question.taskKey].questions.push(question);
    }
    return order.map((key) => map[key]);
  }

  function simpleTaskName(key) {
    if (key === "vocabulary") return "词汇填空";
    if (key === "matching") return "段落匹配";
    if (key === "multiple_choice") return "选择题";
    if (key === "translation") return "翻译";
    if (key === "critical_thinking") return "开放问答";
    if (key === "writing") return "写作";
    return "开放问答";
  }

  function parseAnswers(raw) {
    const text = (raw || "").trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") {
        const passageId = getParams().passageId;
        if (passageId && parsed[passageId]) return normalizeAnswerObject(parsed[passageId]);
        if (parsed.answers || parsed.sections || parsed.flatAnswers || parsed.byQuestionId || parsed.answersByQuestionId) {
          return normalizeAnswerObject(parsed);
        }
        return parsed;
      }
    } catch {
      const simple = parseSimpleTemplate(text);
      if (simple) return simple;
      const keyed = {};
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      let keyedCount = 0;
      for (const line of lines) {
        const match = line.match(/^#?\s*(\d+)\s*[:=.)、]\s*(.+)$/);
        if (match) {
          keyed[match[1]] = match[2].trim();
          keyedCount += 1;
        }
      }
      if (keyedCount) return keyed;
      return text.split(/[\s,;，；]+/).filter(Boolean);
    }
    return null;
  }

  function parseSimpleTemplate(text) {
    const result = { sections: {}, flatAnswers: {} };
    let currentKey = null;
    let last = null;
    let count = 0;

    const lines = text.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/^51Learning答案模板/.test(line)) continue;
      if (/^(填写方法|填空\/匹配|文章段落)[:：]/.test(line)) continue;

      const header = line.match(/^【(.+?)】$/) || line.match(/^\[(.+?)\]$/);
      if (header) {
        currentKey = normalizeSimpleHeader(header[1]);
        if (!result.sections[currentKey]) result.sections[currentKey] = [];
        last = null;
        continue;
      }

      const numbered = line.match(/^#?\s*(\d+)\s*[.)、．）]\s*(.*)$/);
      if (numbered) {
        const index = Number(numbered[1]) - 1;
        const answer = numbered[2].trim();
        if (!answer) {
          last = null;
          continue;
        }
        if (currentKey) {
          result.sections[currentKey][index] = answer;
          last = { section: currentKey, index };
        } else {
          result.flatAnswers[String(index + 1)] = answer;
          last = { flat: String(index + 1) };
        }
        count += 1;
        continue;
      }

      if (last && currentKey && result.sections[currentKey][last.index]) {
        result.sections[currentKey][last.index] += ` ${line}`;
        continue;
      }
      if (last?.flat && result.flatAnswers[last.flat]) {
        result.flatAnswers[last.flat] += ` ${line}`;
      }
    }

    return count ? result : null;
  }

  function normalizeSimpleHeader(label) {
    const text = compact(label).toLowerCase();
    const task = text.match(/task\d+/)?.[0];
    if (task) return task;
    if (/vocabulary|word|blank|词汇|填空/.test(text)) return "vocabulary";
    if (/matching|paragraph|段落|匹配/.test(text)) return "matching";
    if (/multiple|choice|选择/.test(text)) return "multiple_choice";
    if (/translation|translate|翻译/.test(text)) return "translation";
    if (/critical|thinking|case|问答|开放/.test(text)) return "critical_thinking";
    if (/writing|essay|写作|作文/.test(text)) return "writing";
    return "task1";
  }

  function normalizeAnswerObject(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return value;
    if (value.answers || value.sections || value.flatAnswers || value.byQuestionId || value.answersByQuestionId) {
      return {
        sections: value.sections || value.answers || {},
        flatAnswers: value.flatAnswers || {},
        byQuestionId: value.byQuestionId || value.answersByQuestionId || {},
      };
    }
    return value;
  }

  function answerFor(question, answers) {
    if (Array.isArray(answers)) return answers[question.index - 1];
    if (answers && typeof answers === "object") {
      const sections = answers.sections || answers.answers || answers;
      const taskAnswers = sections?.[question.taskKey] || sections?.[`task${question.taskIndex + 1}`];
      const byQuestionId = answers.byQuestionId || answers.answersByQuestionId || {};
      const flatAnswers = answers.flatAnswers || {};
      if (Array.isArray(taskAnswers)) return taskAnswers[question.subIndex];
      if (taskAnswers && typeof taskAnswers === "object") {
        const taskValue = taskAnswers[question.id]
          ?? taskAnswers[String(question.subIndex + 1)]
          ?? taskAnswers[question.subIndex + 1]
          ?? taskAnswers[question.subIndex];
        if (taskValue != null) return taskValue;
      }
      return byQuestionId[question.id]
        ?? answers[question.id]
        ?? flatAnswers[String(question.index)]
        ?? flatAnswers[question.index]
        ?? answers[String(question.index)]
        ?? answers[question.index]
        ?? answers[question.answerName]
        ?? answers[question.index - 1];
    }
    return undefined;
  }

  function fillAnswers(answers) {
    const qs = questionFields();
    if (!qs.length) {
      setStatus("没有找到可填写题目。请先完成阅读。");
      return;
    }
    let filled = 0;
    const missing = [];
    for (const q of qs) {
      const rawValue = answerFor(q, answers);
      if (rawValue == null || String(rawValue).trim() === "") {
        missing.push(q.index);
        continue;
      }
      const value = String(rawValue).trim();
      if (q.type === "radio") {
        const normalized = value.match(/^[A-Za-z]/)?.[0]?.toUpperCase() || value;
        const radio = q.radios.find((input) => String(input.value).toUpperCase() === normalized);
        if (!radio) {
          missing.push(q.index);
          continue;
        }
        radio.checked = true;
        radio.dispatchEvent(new Event("input", { bubbles: true }));
        radio.dispatchEvent(new Event("change", { bubbles: true }));
        radio.click();
        filled += 1;
      } else if (q.field) {
        q.field.value = value;
        q.field.dispatchEvent(new Event("input", { bubbles: true }));
        q.field.dispatchEvent(new Event("change", { bubbles: true }));
        filled += 1;
      } else {
        missing.push(q.index);
      }
    }
    setStatus(`已填写 ${filled}/${qs.length}。未填：${missing.join(", ") || "无"}。请检查，不会自动提交。`);
  }

  function fillPasted() {
    const answers = parseAnswers($("#cl51-answers")?.value || "");
    if (!answers) {
      setStatus("请先粘贴你确认过的答案。");
      return;
    }
    fillAnswers(answers);
  }

  function savePastedAnswers() {
    const answers = parseAnswers($("#cl51-answers")?.value || "");
    if (!answers) {
      setStatus("请先粘贴你确认过的答案。");
      return;
    }
    try {
      setCurrentAnswers(answers);
      setStatus(`已保存 passageId=${getParams().passageId} 的答案。`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  function fillSavedAnswers() {
    const answers = currentAnswers();
    if (!answers) {
      setStatus("本篇没有保存答案。");
      return;
    }
    fillAnswers(answers);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
  }

  function selectHtml(id, values, selected) {
    return `<select id="${id}">${values.map((value) =>
      `<option value="${htmlEscape(value)}"${value === selected ? " selected" : ""}>${htmlEscape(value)}</option>`
    ).join("")}</select>`;
  }

  function renderQueueSummary() {
    const el = $("#cl51-queue");
    if (!el) return;
    const config = getConfig();
    const key = unitKey(config.b, config.u);
    const queue = getQueue(key);
    const current = getParams().passageId;
    let currentIndex = current ? queue.items.findIndex((item) => item.passageId === current) : -1;
    if (currentIndex >= 0) savePosition(currentIndex, key);
    if (currentIndex < 0) currentIndex = readPosition(key);
    const currentItem = currentIndex >= 0 ? queue.items[currentIndex] : null;
    const pageStatus = isArticlePage() ? detectCurrentPageSiteStatus() : "";
    if (pageStatus && currentItem && currentItem.status !== pageStatus) {
      currentItem.status = pageStatus;
      saveQueue(queue);
    }
    const positionText = currentIndex >= 0 ? `${currentIndex + 1}/${queue.items.length}` : `0/${queue.items.length}`;
    const siteStatus = normalizeSiteStatus(pageStatus || currentItem?.status || "");
    const siteText = siteStatus ? ` | 网站：${siteStatus}` : "";
    el.textContent = `队列：${positionText}${siteText}${currentItem ? " | 当前：" + currentItem.title : ""}`;
  }

  function setStatus(message) {
    const el = $("#cl51-status");
    if (el) el.textContent = message;
  }

  function injectStyle() {
    if ($(`#${APP}-style`)) return;
    const style = document.createElement("style");
    style.id = `${APP}-style`;
    style.textContent = `
      #cl51-panel {
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 2147483647;
        width: 360px;
        max-width: calc(100vw - 24px);
        max-height: calc(100vh - 24px);
        overflow: auto;
        color: #172033;
        background: #f8fafc;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18);
        padding: 10px;
        font: 13px/1.35 Arial, "Microsoft YaHei", sans-serif;
      }
      #cl51-panel * { box-sizing: border-box; }
      #cl51-panel .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 2px 2px 8px;
      }
      #cl51-panel .head strong {
        font-size: 15px;
      }
      #cl51-panel .section {
        padding: 8px;
        margin: 7px 0;
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
      }
      #cl51-panel .section-title {
        margin-bottom: 6px;
        color: #0f172a;
        font-weight: 700;
        font-size: 12px;
      }
      #cl51-panel .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }
      #cl51-panel label {
        display: flex;
        flex-direction: column;
        gap: 3px;
        color: #475569;
        font-size: 12px;
      }
      #cl51-panel input,
      #cl51-panel select,
      #cl51-panel textarea {
        width: 100%;
        border: 1px solid #cbd5e1;
        border-radius: 4px;
        padding: 5px 6px;
        color: #172033;
        background: #fff;
        font: inherit;
      }
      #cl51-panel .pair {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
      }
      #cl51-panel textarea {
        min-height: 82px;
        resize: vertical;
        margin: 4px 0;
      }
      #cl51-panel .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 6px;
      }
      #cl51-panel button {
        border: 1px solid #2563eb;
        border-radius: 4px;
        background: #3b82f6;
        color: #fff;
        padding: 5px 8px;
        cursor: pointer;
        font: inherit;
        line-height: 1.25;
      }
      #cl51-panel button.primary {
        border-color: #15803d;
        background: #16a34a;
      }
      #cl51-panel button.secondary {
        border-color: #64748b;
        background: #64748b;
      }
      #cl51-panel button.warn {
        border-color: #ca8a04;
        background: #d97706;
      }
      #cl51-panel button.danger {
        border-color: #b91c1c;
        background: #dc2626;
      }
      #cl51-panel button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      #cl51-panel #cl51-close {
        width: 24px;
        height: 24px;
        padding: 0;
        color: #0f172a;
        background: #e2e8f0;
        border-color: #cbd5e1;
      }
      #cl51-panel #cl51-timer,
      #cl51-panel #cl51-queue,
      #cl51-panel #cl51-status {
        color: #475569;
        margin-top: 5px;
      }
      #cl51-panel .status-box {
        font-size: 12px;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function injectUi() {
    if ($("#cl51-panel")) return;
    const config = getConfig();
    const params = getParams();
    const panel = document.createElement("div");
    panel.id = "cl51-panel";
    panel.innerHTML = `
      <div class="head">
        <strong>51Learning助手</strong>
        <button id="cl51-close" type="button" title="隐藏">x</button>
      </div>
      <div class="section">
        <div class="section-title">单元</div>
        <div class="grid">
          <label>b <input id="cl51-b" value="${htmlEscape(params.b || config.b)}"></label>
          <label>u <input id="cl51-u" value="${htmlEscape(params.u || config.u)}"></label>
          <label>每页 <input id="cl51-limit" type="number" min="1" max="50" value="${Number(params.limit || config.limit)}"></label>
        </div>
        <div class="actions compact">
          <button id="cl51-collect" type="button" class="primary">收集单元</button>
          <button id="cl51-prev" type="button">上一篇</button>
          <button id="cl51-next" type="button">下一篇</button>
        </div>
        <div class="actions compact">
          <button id="cl51-clear-unit" type="button" class="danger">删本单元</button>
        </div>
      </div>
      <div class="section">
        <div class="section-title">阅读</div>
        <div class="grid">
          <label>显示 ${selectHtml("cl51-display", ["出现不消失", "消失不出现", "完整阅读"], config.displayMode)}</label>
          <label>单位 ${selectHtml("cl51-reveal", ["逐行", "逐词", "逐段"], config.revealMode)}</label>
          <label>速度 ${selectHtml("cl51-speed", ["慢(每分钟70个)", "中(每分钟100个)", "快(每分钟120个)"], config.speedMode)}</label>
        </div>
        <div class="actions compact">
          <button id="cl51-start" type="button" class="primary">选模式并开始</button>
          <button id="cl51-finish" type="button" class="warn" disabled>完成阅读</button>
          <button id="cl51-clear-timer" type="button" class="secondary">清除计时</button>
        </div>
      </div>
      <div class="section">
        <div class="section-title">题目与答案</div>
        <div class="actions compact">
          <button id="cl51-copy-packet" type="button">复制文章+题目</button>
          <button id="cl51-copy-q" type="button">复制题目</button>
          <button id="cl51-template" type="button">复制模板</button>
        </div>
        <textarea id="cl51-answers" placeholder='先点“复制模板”，在每个题号后写答案，再整段粘回这里。'></textarea>
        <div class="actions compact">
          <button id="cl51-fill" type="button" class="primary">填入答案</button>
          <button id="cl51-save-answers" type="button" class="secondary">保存本篇</button>
          <button id="cl51-fill-saved" type="button" class="secondary">填入已存</button>
        </div>
      </div>
      <div class="section status-box">
        <div id="cl51-timer">计时：未开始</div>
        <div id="cl51-queue">队列：未读取</div>
        <div id="cl51-status">准备好了。脚本不会自动生成答案或自动提交。</div>
      </div>
    `;
    document.documentElement.appendChild(panel);
    injectStyle();

    $("#cl51-close").addEventListener("click", () => panel.remove());
    $("#cl51-collect").addEventListener("click", () => collectUnitQueue().catch((err) => setStatus(err.message)));
    $("#cl51-prev").addEventListener("click", openPreviousArticle);
    $("#cl51-next").addEventListener("click", openNextArticle);
    $("#cl51-clear-unit").addEventListener("click", () => {
      const key = unitKey($("#cl51-b")?.value || getConfig().b, $("#cl51-u")?.value || getConfig().u);
      if (!confirm(`确定删除单元 ${key} 的本地队列吗？这会清掉本地保存的这组文章列表。`)) return;
      clearUnitData(key);
      setStatus(`已删除单元 ${key} 的本地队列。需要时可重新点“收集单元”。`);
    });
    $("#cl51-start").addEventListener("click", startReading);
    $("#cl51-finish").addEventListener("click", finishReading);
    $("#cl51-clear-timer").addEventListener("click", () => {
      clearTimer();
      setStatus("已清除并停止本篇插件计时。再次点击“选模式并开始”才会重新计时。");
    });
    $("#cl51-copy-packet").addEventListener("click", () => copyStudyPacket().catch((err) => setStatus(err.message)));
    $("#cl51-copy-q").addEventListener("click", () => copyQuestions().catch((err) => setStatus(err.message)));
    $("#cl51-template").addEventListener("click", () => copyAnswerTemplate().catch((err) => setStatus(err.message)));
    $("#cl51-fill").addEventListener("click", fillPasted);
    $("#cl51-save-answers").addEventListener("click", savePastedAnswers);
    $("#cl51-fill-saved").addEventListener("click", fillSavedAnswers);
    for (const id of ["cl51-b", "cl51-u", "cl51-limit", "cl51-display", "cl51-reveal", "cl51-speed"]) {
      const el = $(`#${id}`);
      if (el) el.addEventListener("change", () => {
        configFromUi();
        renderQueueSummary();
      });
    }

    renderQueueSummary();
    startTicker();
    if (isListPage()) setStatus("列表页：可以收集本单元或复制本页列表。");
    if (isArticlePage()) setStatus("文章页：可以选择模式并开始计时。");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectUi);
  } else {
    injectUi();
  }
})();
