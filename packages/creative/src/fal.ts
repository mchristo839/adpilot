/**
 * Minimal fal.ai client (queue API, synchronous mode). Generates a 1024x1024
 * image from a prompt and returns PNG bytes. Upscaling happens in sharp.
 */
export interface FalOptions {
  key?: string;
  model?: string; // e.g. fal-ai/flux/dev
  fetchImpl?: typeof fetch;
}

export async function generatePhoto(prompt: string, opts: FalOptions = {}): Promise<Uint8Array> {
  const key = opts.key ?? process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not set");
  const model = opts.model ?? process.env.FAL_MODEL ?? "fal-ai/flux/dev";
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`https://fal.run/${model}`, {
    method: "POST",
    headers: { authorization: `Key ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      prompt: `${prompt}. Photographic, natural light, no text, no logos, no watermarks.`,
      image_size: "square_hd",
      num_images: 1,
      output_format: "png",
      enable_safety_checker: true,
    }),
  });
  if (!res.ok) throw new Error(`fal.ai ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { images?: { url: string }[] };
  const url = json.images?.[0]?.url;
  if (!url) throw new Error("fal.ai returned no image");
  const img = await f(url);
  if (!img.ok) throw new Error(`fal.ai image download ${img.status}`);
  return new Uint8Array(await img.arrayBuffer());
}

/** Resize/cover a photo to the target size with sharp. */
export async function fitPhoto(bytes: Uint8Array, w: number, h: number): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  return new Uint8Array(await sharp(bytes).resize(w, h, { fit: "cover", position: "attention" }).png().toBuffer());
}
