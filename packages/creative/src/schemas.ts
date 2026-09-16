import { z } from "zod";

export const StrategySchema = z.object({
  campaign_name: z.string().min(3).max(80),
  objective: z.enum(["OUTCOME_LEADS", "OUTCOME_TRAFFIC"]),
  angles: z
    .array(z.object({ name: z.string().min(2).max(60), hook: z.string().min(5).max(200), audience_hint: z.string().max(300) }))
    .min(1)
    .max(8),
  targeting: z.object({
    countries: z.array(z.string().length(2)).min(1),
    age_min: z.number().int().min(18).max(65),
    age_max: z.number().int().min(18).max(65),
    interests: z.array(z.string()).max(20),
    custom_notes: z.string().max(500).default(""),
  }),
  placements: z.enum(["advantage_plus", "manual"]),
  recommended_daily_budget: z.number().min(0),
});
export type Strategy = z.infer<typeof StrategySchema>;

export const CtaSchema = z.enum(["LEARN_MORE", "SIGN_UP", "GET_QUOTE", "BOOK_NOW"]);

export const CreativeCopySchema = z.object({
  angle: z.string(),
  primary_text: z.array(z.string().min(10).max(600)).length(3),
  headline: z.array(z.string().min(3).max(40)).length(2),
  description: z.string().max(60),
  cta: CtaSchema,
  image_spec: z.discriminatedUnion("route", [
    z.object({
      route: z.literal("template"),
      template_id: z.string(),
      slots: z.record(z.string()),
    }),
    z.object({
      route: z.literal("fal"),
      prompt: z.string().min(10).max(800),
      overlay: z.object({ headline: z.string().max(60), sub: z.string().max(90).optional() }),
    }),
  ]),
});
export type CreativeCopy = z.infer<typeof CreativeCopySchema>;

export const CreativeBatchSchema = z.object({ creatives: z.array(CreativeCopySchema).min(1) });

/** First line of primary text must be under 125 chars. */
export function firstLineOk(text: string): boolean {
  const first = text.split("\n")[0] ?? "";
  return first.length < 125;
}
