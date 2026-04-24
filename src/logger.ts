import fs from "node:fs/promises";
import path from "node:path";
import { ensureLogsDir, logsDir } from "./config.js";

function safeCell(value: unknown): string {
  const s = String(value ?? "").replace(/"/g, '""');
  return `"${s}"`;
}

export async function appendLog(rows: Array<Record<string, unknown>>): Promise<string> {
  await ensureLogsDir();
  const now = new Date();
  const name = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_coupon_log.csv`;
  const file = path.join(logsDir, name);
  const exists = await fs.stat(file).then(() => true).catch(() => false);
  const headers = ["time", "storeId", "storeName", "templateId", "label", "start", "end", "dryRun", "status", "result"];
  const lines: string[] = [];
  if (!exists) lines.push(headers.join(","));
  for (const row of rows) {
    lines.push(headers.map((h) => safeCell(row[h])).join(","));
  }
  await fs.appendFile(file, lines.join("\n") + "\n", "utf8");
  return file;
}
