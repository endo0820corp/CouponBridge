import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import type { CouponTemplatesFile, StoreConfig, StoresFile } from "./types.js";

dotenv.config();

export const rootDir = process.cwd();
export const configDir = path.join(rootDir, "config");
export const storesPath = path.join(configDir, "stores.json");
export const logsDir = path.join(rootDir, "logs");

export const env = {
  port: Number(process.env.PORT || 5174),
  dryRun: (process.env.DRY_RUN ?? "true").toLowerCase() !== "false",
  requestFormat: "xml" as const,
  issueUrl: process.env.RMS_COUPON_ISSUE_URL || "https://api.rms.rakuten.co.jp/es/1.0/coupon/issue",
  getUrl: process.env.RMS_COUPON_GET_URL || "https://api.rms.rakuten.co.jp/es/1.0/coupon/get",
  searchUrl: process.env.RMS_COUPON_SEARCH_URL || "https://api.rms.rakuten.co.jp/es/1.0/coupon/search"
};

export async function loadStores(): Promise<StoresFile> {
  const raw = await fs.readFile(storesPath, "utf8");
  return JSON.parse(raw) as StoresFile;
}

export async function getStore(storeId?: string): Promise<StoreConfig> {
  const storesFile = await loadStores();
  const id = storeId || storesFile.defaultStoreId;
  const store = storesFile.stores.find((s) => s.id === id);
  if (!store) {
    throw new Error(`店舗設定が見つかりません: ${id}`);
  }
  return store;
}

export async function loadTemplates(storeId?: string): Promise<CouponTemplatesFile> {
  const store = await getStore(storeId);
  const filePath = path.join(configDir, store.templatesFile);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as CouponTemplatesFile;
}

export function getStoreCredentials(store: StoreConfig): { serviceSecret: string; licenseKey: string } {
  const serviceSecret = process.env[store.serviceSecretEnv] || (store.id === "yukaiya" ? process.env.RMS_SERVICE_SECRET || "" : "");
  const licenseKey = process.env[store.licenseKeyEnv] || (store.id === "yukaiya" ? process.env.RMS_LICENSE_KEY || "" : "");
  return { serviceSecret, licenseKey };
}

export async function ensureLogsDir(): Promise<void> {
  await fs.mkdir(logsDir, { recursive: true });
}
