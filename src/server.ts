import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, getStore, loadStores, loadTemplates } from "./config.js";
import { buildNextPeriodFromLatestEnd, buildTwoWeekPeriod, defaultNextStartDate, getCouponIssueWindowInfo, parseCouponDateToUtc, validateCouponIssueWindow } from "./date.js";
import { buildCouponIssueObject } from "./payload.js";
import { issueCoupon, searchCouponsByTemplate } from "./rmsClient.js";
import { appendLog } from "./logger.js";
import type { CouponTemplate, IssueRequest, Period, SearchCoupon } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const APP_VERSION = "brand-assets-v6";

function selectedTemplates(all: CouponTemplate[], ids: string[]): CouponTemplate[] {
  return all.filter((t) => ids.includes(t.id));
}

function summarizeCoupon(coupon: SearchCoupon) {
  return {
    couponCode: coupon.couponCode || "",
    couponName: coupon.couponName || "",
    couponStartDate: coupon.couponStartDate || "",
    couponEndDate: coupon.couponEndDate || ""
  };
}

async function findLatestCouponPeriod(storeId: string, templates: CouponTemplate[]) {
  const store = await getStore(storeId);
  const searched = [];
  let latestEnd: Date | null = null;
  let latestEndRaw = "";
  let latestCoupon: ReturnType<typeof summarizeCoupon> | null = null;
  const parseTrials: Array<{ templateId: string; couponCode: string; raw: string; parsed: string | null }> = [];

  for (let i = 0; i < templates.length; i += 1) {
    const template = templates[i];
    const result = await searchCouponsByTemplate(store, template, i);
    const coupons = result.coupons.map(summarizeCoupon);
    searched.push({
      templateId: template.id,
      label: template.label,
      status: result.status,
      requestUrl: result.requestXml,
      matchedCount: result.coupons.length,
      rawCount: result.rawCoupons.length,
      coupons,
      rawCoupons: result.rawCoupons.map(summarizeCoupon),
      rawResponsePreview: result.text.slice(0, 2000)
    });

    for (const coupon of result.coupons) {
      const raw = String(coupon.couponEndDate || "").trim();
      const end = parseCouponDateToUtc(raw);
      parseTrials.push({
        templateId: template.id,
        couponCode: coupon.couponCode || "",
        raw,
        parsed: end ? end.toISOString() : null
      });

      if (end) {
        if (!latestEnd || end.getTime() > latestEnd.getTime()) {
          latestEnd = end;
          latestEndRaw = raw;
          latestCoupon = summarizeCoupon(coupon);
        }
      } else if (raw && (!latestEndRaw || raw > latestEndRaw)) {
        latestEndRaw = raw;
        latestCoupon = summarizeCoupon(coupon);
      }
    }
  }

  if (!latestEnd && latestEndRaw) {
    latestEnd = parseCouponDateToUtc(latestEndRaw);
  }

  if (!latestEnd) {
    const error = new Error("coupon.search は成功しましたが、既存クーポンの終了日時を取得できませんでした。debugを確認してください。") as Error & { debug?: unknown };
    error.debug = { version: APP_VERSION, store: { id: store.id, name: store.name }, searched, parseTrials };
    throw error;
  }

  const period = buildNextPeriodFromLatestEnd(latestEnd);
  return { version: APP_VERSION, store: { id: store.id, name: store.name }, period, issueWindow: getCouponIssueWindowInfo(period), latestEndRaw, latestEndIso: latestEnd.toISOString(), latestCoupon, searched };
}

async function findDuplicates(storeId: string, templates: CouponTemplate[], period: Period) {
  const store = await getStore(storeId);
  const duplicates = [];
  for (let i = 0; i < templates.length; i += 1) {
    const template = templates[i];
    const result = await searchCouponsByTemplate(store, template, i);
    const matched = result.coupons
      .filter((coupon) => !coupon.couponName || coupon.couponName === template.couponName)
      .filter((coupon) => {
        const start = parseCouponDateToUtc(coupon.couponStartDate || "");
        const end = parseCouponDateToUtc(coupon.couponEndDate || "");
        const expectedStart = parseCouponDateToUtc(period.couponStartDate);
        const expectedEnd = parseCouponDateToUtc(period.couponEndDate);
        return Boolean(start && end && expectedStart && expectedEnd && start.getTime() === expectedStart.getTime() && end.getTime() === expectedEnd.getTime());
      })
      .map(summarizeCoupon);

    if (matched.length > 0) {
      duplicates.push({ templateId: template.id, label: template.label, coupons: matched });
    }
  }
  return duplicates;
}

app.get("/api/config", async (req, res) => {
  try {
    const storesFile = await loadStores();
    const storeId = String(req.query.storeId || storesFile.defaultStoreId);
    const store = await getStore(storeId);
    const templates = await loadTemplates(store.id);
    res.json({
      version: APP_VERSION,
      dryRun: env.dryRun,
      requestFormat: env.requestFormat,
      defaultStartDate: defaultNextStartDate(),
      defaultStoreId: storesFile.defaultStoreId,
      currentStore: { id: store.id, name: store.name },
      stores: storesFile.stores.map((s) => ({ id: s.id, name: s.name })),
      templates: templates.templates
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/period", (req, res) => {
  try {
    const startDate = String(req.body.startDate || "");
    const period = buildTwoWeekPeriod(startDate);
    res.json({ ...period, issueWindow: getCouponIssueWindowInfo(period) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/next-period", async (req, res) => {
  try {
    const body = req.body as Partial<IssueRequest>;
    const storeId = String(body.storeId || "");
    const templatesFile = await loadTemplates(storeId);
    const ids = body.templateIds?.length ? body.templateIds : templatesFile.templates.filter((t) => t.enabled).map((t) => t.id);
    const selected = selectedTemplates(templatesFile.templates, ids);
    if (selected.length === 0) {
      res.status(400).json({ error: "検索対象のクーポンが選択されていません。" });
      return;
    }
    const result = await findLatestCouponPeriod(storeId, selected);
    res.json(result);
  } catch (error) {
    const anyError = error as Error & { debug?: unknown };
    res.status(400).json({ error: error instanceof Error ? error.message : String(error), debug: anyError.debug });
  }
});

app.post("/api/dry-run", async (req, res) => {
  try {
    const body = req.body as IssueRequest;
    const storeId = String(body.storeId || "");
    const store = await getStore(storeId);
    const period = buildTwoWeekPeriod(body.startDate);
    const templatesFile = await loadTemplates(store.id);
    const selected = selectedTemplates(templatesFile.templates, body.templateIds);
    const payloads = selected.map((t) => ({
      templateId: t.id,
      label: t.label,
      payload: buildCouponIssueObject(t, period)
    }));
    const duplicateCheck = env.dryRun ? null : await findDuplicates(store.id, selected, period);
    res.json({ store: { id: store.id, name: store.name }, period, issueWindow: getCouponIssueWindowInfo(period), duplicateCheck, payloads });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/issue", async (req, res) => {
  try {
    const body = req.body as IssueRequest;
    const storeId = String(body.storeId || "");
    const store = await getStore(storeId);
    const period = buildTwoWeekPeriod(body.startDate);
    const templatesFile = await loadTemplates(store.id);
    const selected = selectedTemplates(templatesFile.templates, body.templateIds);

    if (selected.length === 0) {
      res.status(400).json({ error: "作成対象のクーポンが選択されていません。" });
      return;
    }

    if (!env.dryRun) {
      validateCouponIssueWindow(period);
    }

    const duplicates = env.dryRun ? [] : await findDuplicates(store.id, selected, period);
    const duplicateIds = new Set(duplicates.map((d) => d.templateId));

    const results = [];
    const logRows = [];
    for (let i = 0; i < selected.length; i += 1) {
      const template = selected[i];

      if (duplicateIds.has(template.id)) {
        const message = "同じクーポン名・同じ期間のクーポンが既に存在するためスキップしました。";
        results.push({ templateId: template.id, label: template.label, ok: true, skipped: true, message, duplicates: duplicates.find((d) => d.templateId === template.id)?.coupons || [] });
        logRows.push({ time: new Date().toISOString(), storeId: store.id, storeName: store.name, templateId: template.id, label: template.label, start: period.startDateTime, end: period.endDateTime, dryRun: env.dryRun, status: "SKIPPED", result: message });
        continue;
      }

      const payload = buildCouponIssueObject(template, period);
      try {
        const result = await issueCoupon(store, payload, i);
        results.push({ templateId: template.id, label: template.label, ok: true, ...result });
        logRows.push({ time: new Date().toISOString(), storeId: store.id, storeName: store.name, templateId: template.id, label: template.label, start: period.startDateTime, end: period.endDateTime, dryRun: result.dryRun, status: result.status ?? "", result: result.text.slice(0, 500) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ templateId: template.id, label: template.label, ok: false, error: message });
        logRows.push({ time: new Date().toISOString(), storeId: store.id, storeName: store.name, templateId: template.id, label: template.label, start: period.startDateTime, end: period.endDateTime, dryRun: env.dryRun, status: "ERROR", result: message });
      }
    }
    const logFile = await appendLog(logRows);
    res.json({ store: { id: store.id, name: store.name }, period, issueWindow: getCouponIssueWindowInfo(period), dryRun: env.dryRun, duplicateCheck: duplicates, logFile, results });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.listen(env.port, () => {
  console.log(`CouponBridge: http://localhost:${env.port}`);
  console.log(`DRY_RUN=${env.dryRun} / FORMAT=${env.requestFormat} / VERSION=${APP_VERSION}`);
});
