const JST_OFFSET_MINUTES = 9 * 60;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parseYmd(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("開始日は YYYY-MM-DD 形式で指定してください。");
  }
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

function toJstParts(dateUtc: Date) {
  const jst = new Date(dateUtc.getTime() + JST_OFFSET_MINUTES * 60 * 1000);
  return {
    y: jst.getUTCFullYear(),
    m: pad2(jst.getUTCMonth() + 1),
    d: pad2(jst.getUTCDate()),
    hh: pad2(jst.getUTCHours()),
    mm: pad2(jst.getUTCMinutes()),
    ss: pad2(jst.getUTCSeconds())
  };
}

function formatYmdHmJst(dateUtc: Date): string {
  const p = toJstParts(dateUtc);
  return `${p.y}-${p.m}-${p.d} ${p.hh}:${p.mm}`;
}

function formatYmdJst(dateUtc: Date): string {
  const p = toJstParts(dateUtc);
  return `${p.y}-${p.m}-${p.d}`;
}

function formatCouponDateJst(dateUtc: Date): string {
  const p = toJstParts(dateUtc);
  return `${p.y}-${p.m}-${p.d}T${p.hh}:${p.mm}:${p.ss}+09:00`;
}

export function parseCouponDateToUtc(value: string): Date | null {
  if (!value) return null;
  const normalized = value.trim().replace(/\//g, "-").replace(" ", "T");
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:([+-])(\d{2}):?(\d{2})|Z)?$/
  );
  if (!match) return null;
  const [, y, mo, d, h, mi, sec = "00", sign, offH = "09", offM = "00"] = match;
  const baseUtcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec));
  if (normalized.endsWith("Z")) return new Date(baseUtcMs);
  const offsetMinutes = Number(offH) * 60 + Number(offM);
  const direction = sign === "-" ? -1 : 1;
  const utcMs = baseUtcMs - direction * offsetMinutes * 60 * 1000;
  const date = new Date(utcMs);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildTwoWeekPeriod(startDate: string) {
  const startUtc = parseYmd(startDate);
  const jstStartAsUtc = new Date(startUtc.getTime() - JST_OFFSET_MINUTES * 60 * 1000);
  const endUtc = new Date(jstStartAsUtc.getTime() + 14 * 24 * 60 * 60 * 1000 - 1000);
  return {
    startDate,
    startDateTime: formatYmdHmJst(jstStartAsUtc),
    endDateTime: formatYmdHmJst(endUtc),
    couponStartDate: formatCouponDateJst(jstStartAsUtc),
    couponEndDate: formatCouponDateJst(endUtc)
  };
}

export function buildNextPeriodFromLatestEnd(latestEnd: Date) {
  const nextStartUtc = new Date(latestEnd.getTime() + 1000);
  return buildTwoWeekPeriod(formatYmdJst(nextStartUtc));
}

export function defaultNextStartDate(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + JST_OFFSET_MINUTES * 60 * 1000);
  const day = jst.getUTCDay();
  const diff = (4 - day + 7) % 7 || 14;
  jst.setUTCDate(jst.getUTCDate() + diff);
  return `${jst.getUTCFullYear()}-${pad2(jst.getUTCMonth() + 1)}-${pad2(jst.getUTCDate())}`;
}

export function getCouponIssueWindowInfo(period: { couponStartDate: string }) {
  const start = parseCouponDateToUtc(period.couponStartDate);
  if (!start) {
    return { ok: false, reason: "parse_error", message: `開始日時を解析できません: ${period.couponStartDate}` };
  }

  const now = new Date();
  const minStart = new Date(now.getTime() + 60 * 60 * 1000);
  const maxStart = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const availableFrom = new Date(start.getTime() - 30 * 24 * 60 * 60 * 1000);

  const common = {
    start: formatCouponDateJst(start),
    earliestStart: formatCouponDateJst(minStart),
    latestStart: formatCouponDateJst(maxStart),
    availableFrom: formatCouponDateJst(availableFrom),
    availableFromText: formatYmdHmJst(availableFrom),
    latestStartText: formatYmdHmJst(maxStart)
  };

  if (start.getTime() < minStart.getTime()) {
    return {
      ok: false,
      reason: "too_soon",
      message: "クーポン開始日時が近すぎます。CouponAPIでは現在時刻の60分後以降を指定してください。",
      ...common
    };
  }

  if (start.getTime() > maxStart.getTime()) {
    return {
      ok: false,
      reason: "too_far",
      message: "クーポン開始日時が先すぎます。CouponAPIでは現在日時から30日以内の開始日時のみ登録できます。",
      note: `このクーポンは ${formatYmdHmJst(availableFrom)} 以降に作成可能です。`,
      ...common
    };
  }

  return {
    ok: true,
    reason: "ok",
    message: "この開始日はCouponAPIの作成可能範囲内です。",
    ...common
  };
}

export function validateCouponIssueWindow(period: { couponStartDate: string }): void {
  const info = getCouponIssueWindowInfo(period);
  if (!info.ok) {
    const extra = info.reason === "too_far" && "availableFromText" in info
      ? ` 作成可能になる日時: ${info.availableFromText}`
      : "";
    throw new Error(`${info.message} 指定: ${period.couponStartDate}${extra}`);
  }
}
