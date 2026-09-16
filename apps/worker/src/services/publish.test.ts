import { describe, expect, it } from "vitest";
import { optimisationFor } from "./publish.js";

describe("optimisationFor", () => {
  it("uses link clicks for traffic without a pixel", () => {
    expect(optimisationFor("OUTCOME_TRAFFIC", { slug: "x", pixel_id: null, lead_event: null })).toEqual({ optimization_goal: "LINK_CLICKS", promoted_object: undefined });
  });
  it("uses landing page views for traffic with a pixel (CallCrewHQ until a lead event exists)", () => {
    expect(optimisationFor("OUTCOME_TRAFFIC", { slug: "callcrewhq", pixel_id: "px", lead_event: null })).toEqual({ optimization_goal: "LANDING_PAGE_VIEWS", promoted_object: { pixel_id: "px" } });
  });
  it("refuses leads without a lead event", () => {
    expect(() => optimisationFor("OUTCOME_LEADS", { slug: "callcrewhq", pixel_id: "px", lead_event: null })).toThrow(/OUTCOME_TRAFFIC/);
  });
  it("maps standard and custom lead events", () => {
    expect(optimisationFor("OUTCOME_LEADS", { slug: "c", pixel_id: "px", lead_event: "Lead" }).promoted_object).toEqual({ pixel_id: "px", custom_event_type: "LEAD" });
    expect(optimisationFor("OUTCOME_LEADS", { slug: "c", pixel_id: "px", lead_event: "DemoBooked" }).promoted_object).toEqual({ pixel_id: "px", custom_event_type: "OTHER", custom_event_str: "DemoBooked" });
  });
});
