import type { CouponTemplate, Period } from "./types.js";

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function objectToXml(obj: Record<string, unknown>, indent = "  "): string {
  return Object.entries(obj)
    .map(([key, value]) => {
      if (value === undefined || value === null) return "";
      if (Array.isArray(value)) {
        return value
          .map((v) => {
            if (typeof v === "object" && v !== null) {
              return `${indent}<${key}>\n${objectToXml(v as Record<string, unknown>, indent + "  ")}\n${indent}</${key}>`;
            }
            return `${indent}<${key}>${escapeXml(v)}</${key}>`;
          })
          .join("\n");
      }
      if (typeof value === "object") {
        return `${indent}<${key}>\n${objectToXml(value as Record<string, unknown>, indent + "  ")}\n${indent}</${key}>`;
      }
      return `${indent}<${key}>${escapeXml(value)}</${key}>`;
    })
    .filter(Boolean)
    .join("\n");
}

export function buildCouponIssueObject(template: CouponTemplate, period: Period): Record<string, unknown> {
  // coupon.issue は XML POST。
  // RMS画面HTMLの内容に合わせ、%表記のクーポン名でも実体は定額値引きで作成する。
  return {
    couponIssueRequest: {
      coupon: {
        couponName: template.couponName,
        couponCaption: template.couponCaption,
        couponStartDate: period.couponStartDate,
        couponEndDate: period.couponEndDate,
        ...template.couponPayload
      }
    }
  };
}

export function serializeIssuePayload(payload: Record<string, unknown>): { body: string; contentType: string } {
  return {
    body: `<?xml version="1.0" encoding="UTF-8"?>\n<request>\n${objectToXml(payload)}\n</request>`,
    contentType: "text/xml; charset=utf-8"
  };
}

export function buildCouponSearchParams(template: CouponTemplate): Record<string, string> {
  // coupon.search は GET API。
  // まずはクーポン名で定番クーポンを探す。
  return {
    couponName: template.couponName
  };
}
