import * as React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The test runner compiles app JSX with the classic runtime, which expects a global React.
(globalThis as { React?: typeof React }).React = React;

describe("legal placeholder pages", () => {
  it.each(["privacy", "terms"] as const)("%s is clearly a draft with no invented terms", async (name) => {
    const Page = name === "privacy" ? (await import("@/app/(public)/privacy/page")).default : (await import("@/app/(public)/terms/page")).default;
    const html = renderToStaticMarkup(React.createElement(Page));
    expect(html).toContain("Draft — pending legal review");
    expect(html).toMatch(/placeholder/);
    expect(html).not.toMatch(/we collect|you agree|governing law|liabilit|indemnif|arbitration/i);
  });
});
