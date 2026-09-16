import type { Brand } from "@adpilot/db";

export interface BriefInput {
  objective: "OUTCOME_LEADS" | "OUTCOME_TRAFFIC";
  landing_url: string;
  offer?: string;
  creatives: number;
  duration_days: number;
  total_budget_cents: number;
}

export function strategySystemPrompt(): string {
  return `You are a performance marketer planning Meta (Facebook and Instagram) campaigns for small businesses.
You return strict JSON only, no prose, no markdown fences. You never invent facts about the business beyond what the landing page and brand notes say.
You recommend budgets but never decide them; the system clamps budgets to hard caps.`;
}

export function strategyUserPrompt(brand: Brand, brief: BriefInput, landingText: string, queue: string): string {
  const budgetMajor = (brief.total_budget_cents / 100).toFixed(2);
  return `BRAND
Name: ${brand.name}
Currency: ${brand.currency}
Default objective: ${brand.default_objective}
Audience notes: ${brand.audience_notes}
Tone rules: ${brand.tone_rules}

BRIEF
Objective: ${brief.objective}
Landing URL: ${brief.landing_url}
Offer or angle (optional): ${brief.offer ?? "(none)"}
Number of creatives: ${brief.creatives}
Duration: ${brief.duration_days} days
Total budget for the run: ${budgetMajor} ${brand.currency}

LANDING PAGE (stripped)
${landingText || "(unavailable)"}

${queue ? `QUEUED CONCEPTS FROM THE BRAND'S CREATIVE QUEUE (reuse the good ones)\n${queue}\n` : ""}
TASK
Produce a campaign strategy as JSON with exactly this shape:
{
  "campaign_name": "string (short, includes brand and angle theme)",
  "objective": "OUTCOME_LEADS | OUTCOME_TRAFFIC",
  "angles": [ { "name": "string", "hook": "string", "audience_hint": "string" } ],
  "targeting": { "countries": ["ISO2"], "age_min": 25, "age_max": 60, "interests": ["string"], "custom_notes": "string" },
  "placements": "advantage_plus | manual",
  "recommended_daily_budget": number in ${brand.currency} (major units)
}
Rules: ${Math.min(brief.creatives, 4)} angles at most, each distinct. Countries must fit the audience notes. Keep recommended_daily_budget at or under total budget divided by duration.`;
}

export function copySystemPrompt(): string {
  return `You write direct-response Meta ad copy. Output strict JSON only. Respect brand tone rules exactly. No emojis unless tone rules allow them. No hype words, no exclamation marks unless the brand tone asks for them.`;
}

export function copyUserPrompt(brand: Brand, strategy: { angles: { name: string; hook: string; audience_hint: string }[] }, templates: string[], landingText: string, perAngle: number): string {
  return `BRAND: ${brand.name}
TONE RULES: ${brand.tone_rules}
AUDIENCE: ${brand.audience_notes}
AVAILABLE IMAGE TEMPLATES (id: slots): ${templates.join("; ") || "(none, use fal route)"}

LANDING PAGE SUMMARY
${landingText.slice(0, 2500)}

ANGLES
${strategy.angles.map((a, i) => `${i + 1}. ${a.name}: ${a.hook} (audience: ${a.audience_hint})`).join("\n")}

TASK
For each angle produce ${perAngle} creative(s). Return JSON:
{ "creatives": [ {
  "angle": "angle name",
  "primary_text": ["3 variants; first line under 125 characters; 1 to 4 short lines each"],
  "headline": ["2 variants under 40 characters"],
  "description": "one line under 60 characters",
  "cta": "LEARN_MORE | SIGN_UP | GET_QUOTE | BOOK_NOW",
  "image_spec": { "route": "template", "template_id": "<one of the ids above>", "slots": { "<slot>": "text" } }
               OR { "route": "fal", "prompt": "photographic scene description, no text in image", "overlay": { "headline": "short", "sub": "optional" } }
} ] }
Prefer the template route when templates exist. Slot text must be short enough for a square social image.`;
}
