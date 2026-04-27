let templates = [];
let stores = [];
let currentStoreId = "";
let currentStoreName = "";
let currentIssueWindow = null;
let currentConfig = null;
let latestInfo = null;
let rawVisible = false;

const LOCAL_API_BASE = "http://localhost:5174";
const IS_STATIC_PAGE = location.protocol.startsWith("http") && !["localhost", "127.0.0.1"].includes(location.hostname);
const API_BASE = IS_STATIC_PAGE ? LOCAL_API_BASE : "";

const $ = (id) => document.getElementById(id);

async function api(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || "API error");
    err.data = data;
    throw err;
  }
  return data;
}

function selectedIds() {
  return [...document.querySelectorAll("input[data-template-id]:checked")].map((el) => el.dataset.templateId);
}

function selectedStoreId() {
  const active = document.querySelector(".storeButton.active");
  return active?.dataset.storeId || currentStoreId;
}

function selectedStoreName() {
  return stores.find((s) => s.id === selectedStoreId())?.name || currentStoreName || selectedStoreId();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function xmlValue(xml, tag) {
  const match = String(xml || "").match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) return "";
  return match[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function parseIssueXml(xml) {
  return {
    systemStatus: xmlValue(xml, "systemStatus"),
    message: xmlValue(xml, "message"),
    requestId: xmlValue(xml, "requestId"),
    couponCode: xmlValue(xml, "couponCode"),
    pcGetUrl: xmlValue(xml, "pcGetUrl"),
    errorCode: xmlValue(xml, "code"),
    errorMessage: xmlValue(xml, "message")
  };
}

function formatShortPeriod(period) {
  if (!period) return "-";
  const s = period.startDateTime?.replace(/^\d{4}-/, "").replace(" ", "\n") || "-";
  const e = period.endDateTime?.replace(/^\d{4}-/, "").replace(" ", "\n") || "-";
  return `${s} ～ ${e}`;
}

function templateCondition(template) {
  const p = template.couponPayload || {};
  const discountType = Number(p.discountType);
  const discountFactor = Number(p.discountFactor);
  const other = p.otherConditions?.otherCondition || {};
  const conditionCode = other.conditionTypeCode;
  const startValue = Number(other.startValue);

  const discountText = discountType === 1
    ? `定額値引き：${discountFactor.toLocaleString()}円OFF`
    : discountType === 2
      ? `定率値引き：${discountFactor}%OFF`
      : `値引きタイプ：${discountType}`;

  const conditionText = conditionCode === "RS003"
    ? `${startValue.toLocaleString()}円以上購入`
    : conditionCode === "RS004"
      ? `${startValue}個以上購入`
      : `条件：${conditionCode || "-"}`;

  return { discountText, conditionText };
}

function renderStoreSegment() {
  const wrap = $("storeSegment");
  wrap.innerHTML = "";
  for (const store of stores) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `storeButton${store.id === currentStoreId ? " active" : ""}`;
    btn.dataset.storeId = store.id;
    btn.textContent = store.name;
    btn.addEventListener("click", async () => {
      if (store.id === currentStoreId) return;
      setRaw({ message: "店舗を切り替えました。内容確認してから実行してください。" });
      renderEmptyResult("店舗を切り替えました。次回期間と作成内容を確認してください。");
      await loadConfig(store.id);
    });
    wrap.appendChild(btn);
  }
}

function renderMode(config) {
  const modeChip = $("modeChip");
  const versionChip = $("versionChip");
  modeChip.textContent = config.dryRun ? "DRY RUN" : "LIVE";
  modeChip.className = `chip ${config.dryRun ? "chip-dry" : "chip-live"}`;
  versionChip.textContent = `${config.requestFormat} / ${config.version || ""}`;
  $("execMode").textContent = config.dryRun ? "DRY RUN" : "LIVE";
  $("issueBtn").textContent = config.dryRun ? "DRY RUNで確認" : "選択クーポンを作成";
}

function renderLocalApiStatus(ok, detail = "") {
  const el = $("localApiStatus");
  if (!el) return;
  if (!IS_STATIC_PAGE) {
    el.className = "localApiStatus hidden";
    return;
  }
  el.className = `localApiStatus ${ok ? "ok" : "ng"}`;
  el.innerHTML = ok
    ? `✅ ローカルAPIに接続済み <span>${escapeHtml(LOCAL_API_BASE)}</span>`
    : `⚠️ ローカルAPIに接続できません。PowerShellで <code>npm run api</code> を起動してください。<span>${escapeHtml(detail)}</span>`;
}

async function checkLocalApi() {
  if (!IS_STATIC_PAGE) return true;
  try {
    const res = await fetch(`${LOCAL_API_BASE}/api/health`, { method: "GET" });
    const data = await res.json();
    renderLocalApiStatus(Boolean(data.ok), data.version || "");
    return Boolean(data.ok);
  } catch (error) {
    renderLocalApiStatus(false, error instanceof Error ? error.message : String(error));
    return false;
  }
}

function renderIssueWindow(info) {
  currentIssueWindow = info || null;
  const el = $("issueWindowText");
  const card = $("summaryAvailabilityCard");
  const summary = $("summaryAvailability");
  if (!info) return;

  el.className = `availabilityBox ${info.ok ? "ok" : "ng"}`;
  card.className = `summaryCard panel ${info.ok ? "ok" : "ng"}`;

  if (info.ok) {
    el.textContent = `✅ 作成可能です。現在のAPI作成可能上限：${info.latestStartText} 開始分まで`;
    summary.textContent = "作成可能";
  } else if (info.reason === "too_far") {
    el.textContent = `⚠️ 作成不可：開始日が30日超です。${info.availableFromText} 以降に作成可能です。現在の作成可能上限：${info.latestStartText} 開始分まで`;
    summary.textContent = "30日超";
  } else if (info.reason === "too_soon") {
    el.textContent = "⚠️ 作成不可：開始日時が近すぎます。現在時刻の60分後以降を指定してください。";
    summary.textContent = "60分未満";
  } else {
    el.textContent = `作成可否不明：${info.message || "日時を確認してください。"}`;
    summary.textContent = "確認要";
  }
}

async function loadConfig(storeId) {
  const qs = storeId ? `?storeId=${encodeURIComponent(storeId)}` : "";
  const config = await api(`/api/config${qs}`);
  currentConfig = config;
  templates = config.templates;
  stores = config.stores;
  currentStoreId = config.currentStore.id;
  currentStoreName = config.currentStore.name;

  renderMode(config);
  renderStoreSegment();

  $("summaryStore").textContent = currentStoreName;
  $("execStore").textContent = currentStoreName;

  if (!$("startDate").value) {
    $("startDate").value = config.defaultStartDate;
  }

  renderTemplates();
  await updatePeriod();
}

async function updatePeriod() {
  const startDate = $("startDate").value;
  if (!startDate) return;
  try {
    const period = await api("/api/period", { startDate });
    $("periodText").textContent = `${period.startDateTime} ～ ${period.endDateTime}`;
    $("summaryPeriod").innerHTML = escapeHtml(formatShortPeriod(period)).replace("\n", "<br>");
    renderIssueWindow(period.issueWindow);
  } catch (e) {
    $("periodText").textContent = e.message;
    $("summaryPeriod").textContent = "-";
  }
}

function renderStoreTemplateNote() {
  const note = $("storeTemplateNote");
  const isKairy = currentStoreId === "kairy";
  if (isKairy) {
    note.innerHTML = `<strong>KAIRYテンプレート</strong><br>5点以上→20%OFF / 4点以上→15%OFF / 3点以上→10%OFF / 2点以上→5%OFF<br>API上は定率値引き、利用個数条件で作成します。`;
  } else {
    note.innerHTML = `<strong>ゆかい屋テンプレート</strong><br>10,000円以上→2,000円OFF / 7,500円以上→1,125円OFF / 5,000円以上→500円OFF / 2,500円以上→125円OFF<br>API上は定額値引き、利用金額条件で作成します。`;
  }
}

function renderTemplates() {
  renderStoreTemplateNote();
  const list = $("templateList");
  list.innerHTML = "";
  for (const t of templates) {
    const { discountText, conditionText } = templateCondition(t);
    const div = document.createElement("label");
    div.className = "templateCard";
    div.innerHTML = `
      <input type="checkbox" data-template-id="${escapeHtml(t.id)}" ${t.enabled ? "checked" : ""} />
      <span class="templateCardTitle">${escapeHtml(t.label)}</span>
      <span class="templateName">${escapeHtml(t.couponName)}</span>
      <span class="templateMeta">
        <span class="miniTag">${escapeHtml(discountText)}</span>
        <span class="miniTag">${escapeHtml(conditionText)}</span>
        <span class="miniTag">作成予定</span>
      </span>
    `;
    list.appendChild(div);
  }
  list.querySelectorAll("input[data-template-id]").forEach((el) => el.addEventListener("change", updateCounts));
  updateCounts();
}

function updateCounts() {
  const count = selectedIds().length;
  $("summaryCount").textContent = `${count}件`;
  $("execCount").textContent = `${count}件`;
}

function setRaw(data) {
  $("resultRaw").textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function renderEmptyResult(message) {
  $("resultLead").textContent = message;
  $("resultCards").className = "resultCards emptyState";
  $("resultCards").textContent = message;
}

function copyValue(value) {
  navigator.clipboard?.writeText(value).then(() => {
    // 静かにコピー。失敗時だけフォールバック。
  }).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = value;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  });
}

function metaRow(label, value, copy = false, isUrl = false) {
  if (!value) return "";
  const display = isUrl ? `<a href="${escapeHtml(value)}" target="_blank" rel="noreferrer">${escapeHtml(value)}</a>` : `<code>${escapeHtml(value)}</code>`;
  const button = copy ? `<button class="btn btn-small btn-ghost copyBtn" data-copy="${escapeHtml(value)}" type="button">コピー</button>` : "";
  return `<div class="resultMeta"><span>${escapeHtml(label)}</span><span>${display}</span>${button}</div>`;
}

function renderResults(data) {
  setRaw(data);
  const box = $("resultCards");
  box.className = "resultCards";

  if (data.error) {
    $("resultLead").textContent = "エラーが発生しました。";
    box.innerHTML = `<div class="resultSummary error"><strong>❌ ${escapeHtml(data.error)}</strong></div>`;
    return;
  }

  if (data.payloads) {
    $("resultLead").textContent = "作成予定内容を確認しました。";
    const cards = data.payloads.map((item) => {
      const template = templates.find((t) => t.id === item.templateId);
      const { discountText, conditionText } = template ? templateCondition(template) : { discountText: "", conditionText: "" };
      return `<div class="resultItem">
        <div class="resultTitle"><strong>📝 ${escapeHtml(item.label)}</strong><span class="chip">作成予定</span></div>
        ${metaRow("クーポン名", template?.couponName || item.label)}
        ${metaRow("値引き", discountText)}
        ${metaRow("利用条件", conditionText)}
      </div>`;
    }).join("");
    const duplicateText = Array.isArray(data.duplicateCheck) && data.duplicateCheck.length ? `<div class="resultSummary error"><strong>⚠️ 重複候補があります。</strong></div>` : "";
    box.innerHTML = `<div class="resultSummary"><strong>${escapeHtml(data.store?.name || selectedStoreName())}</strong> / ${escapeHtml(data.period?.startDateTime || "")} ～ ${escapeHtml(data.period?.endDateTime || "")}</div>${duplicateText}${cards}`;
    return;
  }

  if (data.period && data.latestEndRaw) {
    $("resultLead").textContent = "最新クーポンから次回期間を取得しました。";
    box.innerHTML = `<div class="resultSummary ${data.issueWindow?.ok ? "success" : "error"}">
      <strong>${data.issueWindow?.ok ? "✅" : "⚠️"} 次回期間を自動設定しました</strong><br>
      最新終了日時：${escapeHtml(data.latestEndRaw)}<br>
      次回期間：${escapeHtml(data.period.startDateTime)} ～ ${escapeHtml(data.period.endDateTime)}
    </div>`;
    return;
  }

  if (Array.isArray(data.results)) {
    const success = data.results.filter((r) => r.ok && !r.skipped).length;
    const skipped = data.results.filter((r) => r.skipped).length;
    const failed = data.results.filter((r) => !r.ok).length;
    $("resultLead").textContent = `実行結果：成功 ${success}件 / スキップ ${skipped}件 / 失敗 ${failed}件`;
    const summaryClass = failed ? "error" : "success";
    const summary = `<div class="resultSummary ${summaryClass}"><strong>${failed ? "⚠️" : "✅"} ${data.store?.name || selectedStoreName()}：成功 ${success}件 / スキップ ${skipped}件 / 失敗 ${failed}件</strong><br>${escapeHtml(data.period?.startDateTime || "")} ～ ${escapeHtml(data.period?.endDateTime || "")}</div>`;
    const cards = data.results.map((r) => {
      const parsed = parseIssueXml(r.text || "");
      const statusClass = r.skipped ? "skipped" : r.ok ? "success" : "error";
      const chip = r.skipped ? `<span class="chip chip-warn">スキップ</span>` : r.ok ? `<span class="chip chip-ok">成功</span>` : `<span class="chip chip-ng">失敗</span>`;
      return `<div class="resultItem ${statusClass}">
        <div class="resultTitle"><strong>${r.skipped ? "⚠️" : r.ok ? "✅" : "❌"} ${escapeHtml(r.label || r.templateId)}</strong>${chip}</div>
        ${r.error ? metaRow("エラー", r.error) : ""}
        ${r.message ? metaRow("メッセージ", r.message) : ""}
        ${parsed.requestId ? metaRow("Request ID", parsed.requestId) : ""}
        ${parsed.couponCode ? metaRow("クーポンコード", parsed.couponCode, true) : ""}
        ${parsed.pcGetUrl ? metaRow("獲得URL", parsed.pcGetUrl, true, true) : ""}
      </div>`;
    }).join("");
    box.innerHTML = summary + cards;
    box.querySelectorAll("[data-copy]").forEach((btn) => btn.addEventListener("click", () => copyValue(btn.dataset.copy || "")));
    return;
  }

  box.className = "resultCards emptyState";
  box.textContent = "詳細ログを確認してください。";
}

async function nextPeriod() {
  const ids = selectedIds();
  if (ids.length === 0) {
    alert("検索対象を選択してください。");
    return;
  }
  $("nextPeriodBtn").disabled = true;
  try {
    const data = await api("/api/next-period", { storeId: selectedStoreId(), templateIds: ids });
    latestInfo = data;
    $("startDate").value = data.period.startDate;
    await updatePeriod();
    $("latestBox").classList.remove("hidden");
    $("latestBox").innerHTML = `最新終了日時：<strong>${escapeHtml(data.latestEndRaw || "-")}</strong><br>次回期間：<strong>${escapeHtml(data.period.startDateTime)} ～ ${escapeHtml(data.period.endDateTime)}</strong>`;
    renderResults(data);
  } catch (e) {
    renderResults(e.data || { error: e.message });
    alert(e.message);
  } finally {
    $("nextPeriodBtn").disabled = false;
  }
}

async function dryRun() {
  const body = { storeId: selectedStoreId(), startDate: $("startDate").value, templateIds: selectedIds() };
  const data = await api("/api/dry-run", body);
  renderResults(data);
}

async function issue() {
  const ids = selectedIds();
  if (ids.length === 0) {
    alert("作成対象を選択してください。");
    return;
  }

  if (currentIssueWindow && !currentIssueWindow.ok) {
    alert(`${currentIssueWindow.message || "この期間は作成できません。"}\n${currentIssueWindow.note || ""}`);
    return;
  }

  const storeName = selectedStoreName();
  const ok = confirm(`作成対象店舗：${storeName}\n作成期間：${$("periodText").textContent}\n作成件数：${ids.length}件\n\n${currentConfig?.dryRun ? "DRY RUNで確認します。" : "LIVEのため実際にAPI送信します。"}\n同じクーポン名・同じ期間が既にある場合はスキップします。続行しますか？`);
  if (!ok) return;
  $("issueBtn").disabled = true;
  try {
    const data = await api("/api/issue", { storeId: selectedStoreId(), startDate: $("startDate").value, templateIds: ids });
    renderResults(data);
  } catch (e) {
    renderResults(e.data || { error: e.message });
    alert(e.message);
  } finally {
    $("issueBtn").disabled = false;
  }
}

async function init() {
  await checkLocalApi();
  await loadConfig();
  renderEmptyResult("実行後、成功・失敗・スキップの結果をカードで表示します。");
}

$("startDate").addEventListener("change", updatePeriod);
$("nextPeriodBtn").addEventListener("click", () => nextPeriod());
$("dryRunBtn").addEventListener("click", () => dryRun().catch((e) => renderResults(e.data || { error: e.message })));
$("issueBtn").addEventListener("click", () => issue());
$("toggleRawBtn").addEventListener("click", () => {
  rawVisible = !rawVisible;
  $("resultRaw").classList.toggle("hidden", !rawVisible);
  $("toggleRawBtn").textContent = rawVisible ? "詳細ログを隠す" : "詳細ログを表示";
});

init().catch((e) => {
  $("modeChip").textContent = "ERROR";
  $("modeChip").className = "chip chip-ng";
  setRaw(e.stack || e.message);
  renderResults({ error: e.message });
});
