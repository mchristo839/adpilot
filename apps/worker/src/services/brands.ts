import { must, type Brand, type Db } from "@adpilot/db";

export async function activeBrands(db: Db): Promise<Brand[]> {
  return must(await db.from("brands").select("*").eq("active", true).order("name"), "load active brands") as Brand[];
}

export async function brandById(db: Db, id: string): Promise<Brand> {
  return must(await db.from("brands").select("*").eq("id", id).single(), `load brand ${id}`) as Brand;
}

export async function brandByIdOrSlug(db: Db, idOrSlug: string): Promise<Brand> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  const q = db.from("brands").select("*");
  return must(await (isUuid ? q.eq("id", idOrSlug) : q.eq("slug", idOrSlug)).single(), `load brand ${idOrSlug}`) as Brand;
}
