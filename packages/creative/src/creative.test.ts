import { describe, expect, it } from "vitest";
import { extractJson } from "./json.js";
import { stripHtml } from "./landing.js";
import { fillTemplate } from "./renderer.js";
import { CreativeCopySchema, StrategySchema, firstLineOk } from "./schemas.js";
import { summariseQueue } from "./airtable.js";
import type { Brand } from "@adpilot/db";

describe("extractJson", () => {
  it("handles fences and prose", () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('{"a":{"b":2}} trailing')).toEqual({ a: { b: 2 } });
  });
});

describe("stripHtml", () => {
  it("keeps title, description and text", () => {
    const t = stripHtml("<html><head><title>Hi</title><meta name=\"description\" content=\"Desc\"></head><body><script>x()</script><h1>Head</h1><p>Body &amp; more</p></body></html>");
    expect(t).toContain("TITLE: Hi");
    expect(t).toContain("DESCRIPTION: Desc");
    expect(t).toContain("Body & more");
    expect(t).not.toContain("x()");
  });
});

describe("schemas", () => {
  it("validates strategy", () => {
    const s = StrategySchema.parse({
      campaign_name: "GTQ Sydney",
      objective: "OUTCOME_TRAFFIC",
      angles: [{ name: "angle one", hook: "hook here", audience_hint: "x" }],
      targeting: { countries: ["AU"], age_min: 25, age_max: 60, interests: [], custom_notes: "" },
      placements: "advantage_plus",
      recommended_daily_budget: 10,
    });
    expect(s.objective).toBe("OUTCOME_TRAFFIC");
  });
  it("rejects long headlines", () => {
    expect(() =>
      CreativeCopySchema.parse({
        angle: "a",
        primary_text: ["a".repeat(20), "b".repeat(20), "c".repeat(20)],
        headline: ["x".repeat(41), "ok"],
        description: "d",
        cta: "LEARN_MORE",
        image_spec: { route: "template", template_id: "t", slots: {} },
      }),
    ).toThrow();
  });
  it("checks first line length", () => {
    expect(firstLineOk("short\nlong".padEnd(300, "x"))).toBe(true);
    expect(firstLineOk("x".repeat(125))).toBe(false);
  });
});

describe("fillTemplate", () => {
  const brand = { name: "B", slug: "b", brand_assets: { colours: { ink: "#000" }, fonts: { heading: "IBM Plex Sans" } } } as unknown as Brand;
  it("fills slots, brand tokens and escapes html", () => {
    const html = "<div style='color:{{brand.colour.ink}};font-family:{{brand.font_heading}}'>{{headline}} {{width}}x{{height}}</div>";
    expect(fillTemplate(html, brand, { headline: "<b>Hi</b>" }, { w: 1080, h: 1080 }, "square")).toBe(
      "<div style='color:#000;font-family:IBM Plex Sans'>&lt;b&gt;Hi&lt;/b&gt; 1080x1080</div>",
    );
  });
});

describe("summariseQueue", () => {
  it("compacts records", () => {
    const s = summariseQueue([{ id: "r1", fields: { Concept: "Non-dom explainer", Status: "Draft", Count: 3 } }]);
    expect(s).toBe("- Concept: Non-dom explainer | Status: Draft");
  });
});
