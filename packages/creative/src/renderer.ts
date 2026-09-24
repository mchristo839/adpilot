import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import type { Brand } from "@adpilot/db";

export interface RenderInput {
  templatesRoot: string; // repo templates/ dir
  brand: Brand;
  templateId: string;
  slots: Record<string, string>;
  outDir: string;
  baseName: string;
}

export interface RenderOutput {
  square: string; // path to 1080x1080 png
  story: string; // path to 1080x1920 png
}

const SIZES = { square: { w: 1080, h: 1080 }, story: { w: 1080, h: 1920 } } as const;

/** List template ids for a brand (falls back to _default). */
export async function listTemplates(templatesRoot: string, slug: string): Promise<string[]> {
  const dir = path.join(templatesRoot, slug);
  try {
    const files = await readdir(dir);
    const ids = files.filter((f) => f.endsWith(".html") && !f.startsWith("_")).map((f) => f.replace(/\.html$/, ""));
    if (ids.length) return ids;
  } catch {
    /* fall through */
  }
  const files = await readdir(path.join(templatesRoot, "_default"));
  return files.filter((f) => f.endsWith(".html") && !f.startsWith("_")).map((f) => f.replace(/\.html$/, ""));
}

/** Slot names in a template ({{slot}} placeholders), excluding built-ins. */
export async function templateSlots(templatesRoot: string, slug: string, templateId: string): Promise<string[]> {
  const html = await loadTemplate(templatesRoot, slug, templateId);
  const found = new Set<string>();
  for (const m of html.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)) {
    const name = m[1]!;
    if (!name.startsWith("brand.") && !["width", "height", "format"].includes(name)) found.add(name);
  }
  return [...found];
}

async function loadTemplate(templatesRoot: string, slug: string, templateId: string): Promise<string> {
  const safe = templateId.replace(/[^a-zA-Z0-9_-]/g, "");
  for (const dir of [slug, "_default"]) {
    try {
      return await readFile(path.join(templatesRoot, dir, `${safe}.html`), "utf8");
    } catch {
      /* next */
    }
  }
  throw new Error(`Template ${templateId} not found for brand ${slug}`);
}

export function fillTemplate(html: string, brand: Brand, slots: Record<string, string>, size: { w: number; h: number }, format: string): string {
  const assets = brand.brand_assets ?? {};
  const colours = (assets.colours ?? {}) as Record<string, string>;
  const fonts = (assets.fonts ?? {}) as Record<string, string>;
  const values: Record<string, string> = {
    width: String(size.w),
    height: String(size.h),
    format,
    "brand.name": brand.name,
    "brand.logo": String(assets.logo_url ?? assets.logo_path ?? ""),
    "brand.font_heading": fonts.heading ?? "Inter, Arial, sans-serif",
    "brand.font_body": fonts.body ?? "Inter, Arial, sans-serif",
    "brand.google_fonts_url": fonts.google_fonts_url ?? "",
    ...Object.fromEntries(Object.entries(colours).map(([k, v]) => [`brand.colour.${k}`, v])),
    ...slots,
  };
  return html.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => escapeHtml(values[key] ?? ""));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "<br>");
}

let browser: Browser | null = null;
async function getBrowser(): Promise<Browser> {
  if (!browser) {
    const executablePath = process.env.CHROMIUM_PATH || undefined;
    browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  }
  return browser;
}
export async function closeBrowser(): Promise<void> {
  await browser?.close();
  browser = null;
}

/** Render a template at 1080x1080 and 1080x1920. */
export async function renderTemplate(input: RenderInput): Promise<RenderOutput> {
  const html = await loadTemplate(input.templatesRoot, input.brand.slug, input.templateId);
  await mkdir(input.outDir, { recursive: true });
  const b = await getBrowser();
  const out: Partial<RenderOutput> = {};
  for (const [format, size] of Object.entries(SIZES) as [keyof typeof SIZES, { w: number; h: number }][]) {
    const page = await b.newPage({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 });
    try {
      await page.setContent(fillTemplate(html, input.brand, input.slots, size, format), { waitUntil: "networkidle" });
      await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready);
      const file = path.join(input.outDir, `${input.baseName}-${format}.png`);
      await page.screenshot({ path: file, type: "png", clip: { x: 0, y: 0, width: size.w, height: size.h } });
      out[format] = file;
    } finally {
      await page.close();
    }
  }
  return out as RenderOutput;
}

/** Render an overlay (headline/sub) on top of a photo using the brand's overlay template. */
export async function renderOverlay(input: Omit<RenderInput, "templateId" | "slots"> & { photoPath: string; headline: string; sub?: string }): Promise<RenderOutput> {
  const photo = await readFile(input.photoPath);
  const dataUrl = `data:image/png;base64,${photo.toString("base64")}`;
  return renderTemplate({
    ...input,
    templateId: "photo-overlay",
    slots: { photo: dataUrl, headline: input.headline, sub: input.sub ?? "" },
  });
}

export async function writePng(dir: string, name: string, bytes: Uint8Array): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await writeFile(file, bytes);
  return file;
}
