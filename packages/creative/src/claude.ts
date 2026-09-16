import Anthropic from "@anthropic-ai/sdk";
import type { Brand } from "@adpilot/db";
import { extractJson } from "./json.js";
import { copySystemPrompt, copyUserPrompt, strategySystemPrompt, strategyUserPrompt, type BriefInput } from "./prompts.js";
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

  constructor(opts: ClaudeOptions = {}) {
    this.client = opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.generateModel = opts.generateModel ?? process.env.CLAUDE_MODEL_GENERATE ?? "claude-sonnet-4-6";
    this.classifyModel = opts.classifyModel ?? process.env.CLAUDE_MODEL_CLASSIFY ?? "claude-haiku-4-5";
  }

  private async json(system: string, user: string, maxTokens = 4000): Promise<unknown> {
    const res = await this.client.messages.create({
      model: this.generateModel,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    if (res.stop_reason === "refusal") throw new Error("Claude refused the request");
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return extractJson(text);
  }

  async strategy(brand: Brand, brief: BriefInput, landingText: string, queueSummary: string): Promise<Strategy> {
    const raw = await this.json(strategySystemPrompt(), strategyUserPrompt(brand, brief, landingText, queueSummary));
    const parsed = StrategySchema.parse(raw);
    if (parsed.targeting.age_min > parsed.targeting.age_max) [parsed.targeting.age_min, parsed.targeting.age_max] = [parsed.targeting.age_max, parsed.targeting.age_min];
    return parsed;
  }

  async copy(brand: Brand, strategy: Strategy, templateIds: string[], landingText: string, perAngle: number): Promise<CreativeCopy[]> {
    const raw = await this.json(copySystemPrompt(), copyUserPrompt(brand, strategy, templateIds, landingText, perAngle), 8000);
    const parsed = CreativeBatchSchema.parse(raw);
    for (const c of parsed.creatives) {
      c.primary_text = c.primary_text.map((t) => (firstLineOk(t) ? t : shortenFirstLine(t)));
      if (c.image_spec.route === "template" && !templateIds.includes(c.image_spec.template_id)) {
        c.image_spec.template_id = templateIds[0] ?? c.image_spec.template_id;
      }
    }
    return parsed.creatives;
  }

  /** Regenerate copy for a single angle. */
  async copyForAngle(brand: Brand, strategy: Strategy, angleName: string, templateIds: string[], landingText: string): Promise<CreativeCopy> {
    const angle = strategy.angles.find((a) => a.name === angleName) ?? strategy.angles[0]!;
    const one = { ...strategy, angles: [angle] };
    const out = await this.copy(brand, one, templateIds, landingText, 1);
    return out[0]!;
  }
}

function shortenFirstLine(text: string): string {
  const [first = "", ...rest] = text.split("\n");
  const cut = first.slice(0, 120).replace(/\s+\S*$/, "");
  return [cut, ...rest].join("\n");
}
