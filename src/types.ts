export type RequestFormat = "xml";

export type CouponTemplate = {
  id: string;
  enabled: boolean;
  label: string;
  couponName: string;
  couponCaption: string;
  /** coupon.issue の <coupon> 配下にそのまま入れる共通設定 */
  couponPayload: Record<string, unknown>;
};

export type CouponTemplatesFile = {
  templates: CouponTemplate[];
};

export type StoreConfig = {
  id: string;
  name: string;
  templatesFile: string;
  serviceSecretEnv: string;
  licenseKeyEnv: string;
};

export type StoresFile = {
  defaultStoreId: string;
  stores: StoreConfig[];
};

export type Period = {
  startDate: string; // YYYY-MM-DD
  startDateTime: string; // YYYY-MM-DD HH:mm
  endDateTime: string; // YYYY-MM-DD HH:mm
  couponStartDate: string; // YYYY-MM-DDTHH:mm:ss+09:00
  couponEndDate: string; // YYYY-MM-DDTHH:mm:ss+09:00
};

export type IssueRequest = {
  storeId: string;
  startDate: string;
  templateIds: string[];
};

export type SearchCoupon = {
  couponCode?: string;
  couponName?: string;
  couponStartDate?: string;
  couponEndDate?: string;
  rawXml: string;
};
