import { env, getStoreCredentials } from "./config.js";
import { serializeIssuePayload, buildCouponSearchParams } from "./payload.js";
import type { CouponTemplate, SearchCoupon, StoreConfig } from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildAuthHeader(store: StoreConfig): string {
  const { serviceSecret, licenseKey } = getStoreCredentials(store);
  if (!serviceSecret || !licenseKey) {
    throw new Error(`${store.name} のAPIキーが未設定です。${store.serviceSecretEnv} / ${store.licenseKeyEnv} を .env に設定してください。`);
  }
  const token = Buffer.from(`${serviceSecret}:${licenseKey}`, "utf8").toString("base64");
  return `ESA ${token}`;
}

async function postXml(store: StoreConfig, url: string, body: string, contentType: string): Promise<{ status: number; text: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: buildAuthHeader(store),
      "Content-Type": contentType,
      Accept: "application/xml, text/xml, */*"
    },
    body
  });
  const text = await response.text();
  return { status: response.status, text };
}

async function getXml(store: StoreConfig, url: string, params: Record<string, string | number | boolean | undefined>): Promise<{ status: number; text: string; requestUrl: string }> {
  const requestUrl = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || String(value) === "") continue;
    requestUrl.searchParams.set(key, String(value));
  }

  const response = await fetch(requestUrl.toString(), {
    method: "GET",
    headers: {
      Authorization: buildAuthHeader(store),
      Accept: "application/xml, text/xml, */*"
    }
  });
  const text = await response.text();
  return { status: response.status, text, requestUrl: requestUrl.toString() };
}

function xmlValue(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) return undefined;
  return match[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function firstXmlValue(xml: string, tags: string[]): string | undefined {
  for (const tag of tags) {
    const value = xmlValue(xml, tag);
    if (value) return value;
  }
  return undefined;
}

function parseCouponsFromXml(xml: string): SearchCoupon[] {
  const coupons: SearchCoupon[] = [];
  const couponBlocks = [...xml.matchAll(/<coupon(?:\s[^>]*)?>([\s\S]*?)<\/coupon>/gi)];

  for (const block of couponBlocks) {
    const rawXml = block[0];
    coupons.push({
      couponCode: firstXmlValue(rawXml, ["couponCode", "couponCd", "code"]),
      couponName: firstXmlValue(rawXml, ["couponName", "name"]),
      couponStartDate: firstXmlValue(rawXml, ["couponStartDate", "couponStartDatetime", "couponStartDateTime", "startDate", "startDatetime", "startDateTime"]),
      couponEndDate: firstXmlValue(rawXml, ["couponEndDate", "couponEndDatetime", "couponEndDateTime", "endDate", "endDatetime", "endDateTime"]),
      rawXml
    });
  }

  if (coupons.length === 0 && /couponName|couponCode|couponEndDate|couponEndDatetime/i.test(xml)) {
    coupons.push({
      couponCode: firstXmlValue(xml, ["couponCode", "couponCd", "code"]),
      couponName: firstXmlValue(xml, ["couponName", "name"]),
      couponStartDate: firstXmlValue(xml, ["couponStartDate", "couponStartDatetime", "couponStartDateTime", "startDate", "startDatetime", "startDateTime"]),
      couponEndDate: firstXmlValue(xml, ["couponEndDate", "couponEndDatetime", "couponEndDateTime", "endDate", "endDatetime", "endDateTime"]),
      rawXml: xml
    });
  }

  return coupons;
}

function collectRmsErrors(text: string): Array<{ code: string; message: string }> {
  const errors: Array<{ code: string; message: string }> = [];
  const errorBlocks = [...text.matchAll(/<error(?:\s[^>]*)?>([\s\S]*?)<\/error>/gi)];
  for (const block of errorBlocks) {
    const rawXml = block[0];
    errors.push({
      code: xmlValue(rawXml, "code") || "",
      message: xmlValue(rawXml, "message") || rawXml.replace(/\s+/g, " ").trim()
    });
  }
  return errors;
}

function assertRmsOk(text: string, interfaceId: string): void {
  const systemStatus = xmlValue(text, "systemStatus");
  if (systemStatus && systemStatus !== "OK") {
    const message = xmlValue(text, "message") || text.slice(0, 500);
    throw new Error(`${interfaceId} failed: ${systemStatus} / ${message}`);
  }

  // CouponAPI は systemStatus=OK でも <errors> を返すことがある。
  // 例: couponStartDate.over_term。この場合は作成成功ではないためエラー扱いにする。
  const errors = collectRmsErrors(text);
  if (errors.length > 0) {
    const detail = errors.map((e) => [e.code, e.message].filter(Boolean).join(" / ")).join("; ");
    throw new Error(`${interfaceId} failed: API_ERROR / ${detail}`);
  }
}

function normalizeCouponName(name?: string): string {
  return (name || "").replace(/\s+/g, "").trim();
}

function isSameTemplateCoupon(coupon: SearchCoupon, template: CouponTemplate): boolean {
  const got = normalizeCouponName(coupon.couponName);
  const expected = normalizeCouponName(template.couponName);
  if (!got) return true;
  return got === expected || got.includes(expected) || expected.includes(got);
}

export async function issueCoupon(store: StoreConfig, payload: Record<string, unknown>, index: number): Promise<{ dryRun: boolean; status?: number; text: string }> {
  await sleep(index * 1100);

  const serialized = serializeIssuePayload(payload);

  if (env.dryRun) {
    return {
      dryRun: true,
      text: serialized.body
    };
  }

  if (!env.issueUrl) {
    throw new Error("RMS_COUPON_ISSUE_URL が未設定です。");
  }

  const result = await postXml(store, env.issueUrl, serialized.body, serialized.contentType);
  assertRmsOk(result.text, "coupon.issue");
  return { dryRun: false, status: result.status, text: result.text };
}

export async function getCouponByCode(store: StoreConfig, couponCode: string, index = 0): Promise<{ status: number; text: string; coupon?: SearchCoupon; requestUrl: string }> {
  await sleep(index * 1100);

  if (!env.getUrl) {
    throw new Error("RMS_COUPON_GET_URL が未設定です。");
  }

  const result = await getXml(store, env.getUrl, { couponCode });
  assertRmsOk(result.text, "coupon.get");
  const coupon = parseCouponsFromXml(result.text)[0];
  return { ...result, coupon };
}

export async function searchCouponsByTemplate(store: StoreConfig, template: CouponTemplate, index = 0): Promise<{ status: number; text: string; coupons: SearchCoupon[]; requestXml: string; rawCoupons: SearchCoupon[] }> {
  await sleep(index * 1100);

  if (!env.searchUrl) {
    throw new Error("RMS_COUPON_SEARCH_URL が未設定です。");
  }

  const params = buildCouponSearchParams(template);
  const result = await getXml(store, env.searchUrl, params);
  assertRmsOk(result.text, "coupon.search");

  const rawCoupons = parseCouponsFromXml(result.text);
  const coupons: SearchCoupon[] = [];

  for (let i = 0; i < rawCoupons.length; i += 1) {
    const coupon = rawCoupons[i];
    const basicMatch = isSameTemplateCoupon(coupon, template);
    if (!basicMatch) continue;

    if (!coupon.couponEndDate && coupon.couponCode) {
      try {
        const detail = await getCouponByCode(store, coupon.couponCode, i);
        if (detail.coupon && isSameTemplateCoupon(detail.coupon, template)) {
          coupons.push({ ...coupon, ...detail.coupon, rawXml: detail.coupon.rawXml || coupon.rawXml });
          continue;
        }
      } catch {
        // 詳細取得に失敗しても、デバッグ確認できるよう search の結果は残す。
      }
    }

    coupons.push(coupon);
  }

  return { ...result, coupons, rawCoupons, requestXml: result.requestUrl };
}
