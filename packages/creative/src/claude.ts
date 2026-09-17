import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Brand } from "@adpilot/db";
import type * as z from "zod/v4";
import { extractJson } from "./json.js";
import { copySystemPrompt, copyUserPrompt, strategySystemPrompt, strategyUserPrompt, type BriefInput, type PromptContext } from "./prompts.js";
import { CreativeBatchSchema, StrategySchema, firstLineOk, type CreativeCopy, type Strategy } from "./schemas.js";

export interface ClaudeOptions {
  apiKey?: string;
  generateModel?: string;
  classifyModel?: string;
  client?: Anthropic;
}

export class CreativeAI {
  private readonly client: Anthropic;
  private readonly generateModel: string;
  readonly classifyModel: string;
  private structuredSupported = true;

  constructor(opts: ClaudeOptions = {}) {
    this.client = opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.generateModel = opts.generateModel ?? process.env.CLAUDE_MODEL_GENERATE ?? "claude-sonnet-4-6";
    this.classifyModel = opts.classifyModel ?? process.env.CLAUDE_MODEL_CLASSIFY ?? "claude-haiku-4-5";
  }

  /**
   * Structured output first (schema-constrained JSON, no scraping). If the API
   * rejects the schema (older model, unsupported keyword) fall back to plain
   * text plus extractJson. Both paths end in zod.parse so the shape is checked.
   */
  private async structured<S extends z.ZodType>(schema: S, system: string, user: string, maxTokens: number): Promise<z.infer<S>> {
    if (this.structuredSupported) {
      try {
        const res = await this.client.messages.parse({
          model: this.generateModel,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: user }],
          output_config: { format: zodOutputFormat(schema) },
        });
        if (res.stop_reason === "refusal") throw new Error("Claude refused the request");
        if (res.parsed_output) return res.parsed_output as z.infer<S>;
      } catch (e) {
        if (e instanceof Anthropic.BadRequestError) {
          console.warn(`[claude] structured output rejected (${e.message.slice(0, 120)}). Falling back to text JSON.`);
          this.structuredSupported = false;
        } else {
          throw e;
        }
      }
    }
    const res = await this.client.messages.create({ model: this.generateModel, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
    if (res.stop_reason === "refusal") throw new Error("Claude refused the request");
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return schema.parse(extractJson(text)) as z.infer<S>;
  }

  async strategy(brand: Brand, brief: BriefInput, ctx: PromptContext): Promise<Strategy> {
    const parsed = await this.structured(StrategySchema, strategySystemPrompt(), strategyUserPrompt(brand, brief, ctx), 4000);
    if (parsed.targeting.age_min > parsed.targeting.age_max) [parsed.targeting.age_min, parsed.targeting.age_max] = [parsed.targeting.age_max, parsed.targeting.age_min];
    return parsed;
  }

  async copy(brand: Brand, strategy: Strategy, templateIds: string[], ctx: PromptContext, perAngle: number): Promise<CreativeCopy[]> {
    const parsed = await this.structured(CreativeBatchSchema, copySystemPrompt(), copyUserPrompt(brand, strategy, templateIds, ctx, perAngle), 8000);
    for (const c of parsed.creatives) {
      c.primary_text = c.primary_text.map((t) => (firstLineOk(t) ? t : shortenFirstLine(t)));
      if (c.image_spec.route === "template" && !templateIds.includes(c.image_spec.template_id)) {
        c.image_spec.template_id = templateIds[0] ?? c.image_spec.template_id;
      }
    }
    return parsed.creatives;
  }

  /** Regenerate copy for a single angle. */
  async copyForAngle(brand: Brand, strategy: Strategy, angleName: string, templateIds: string[], ctx: PromptContext): Promise<CreativeCopy> {
    const angle = strategy.angles.find((a) => a.name === angleName) ?? strategy.angles[0]!;
    const one = { ...strategy, angles: [angle] };
    const out = await this.copy(brand, one, templateIds, ctx, 1);
    return out[0]!;
  }
}

function shortenFirstLine(text: string): string {
  const [first = "", ...rest] = text.split("\n");
  const cut = first.slice(0, 120).replace(/\s+\S*$/, "");
  return [cut, ...rest].join("\n");
}
