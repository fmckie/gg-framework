import { describe, expect, it } from "vitest";
import themeCss from "./kleio-theme.css?raw";

const transcript = "html:root .app.app-session > .transcript-frame > .transcript";

describe("the plan review states' colours", () => {
  it("sets the approved row in the text colour, 15px, with a hanging verdigris tick and a muted state", () => {
    expect(themeCss).toContain(
      `${transcript} .plan-done {\n  position: relative;\n  margin: 0;\n  padding-left: 24px;\n  color: var(--kleio-text);\n  font-size: 15px;\n  line-height: 1.6;\n`,
    );
    expect(themeCss).toContain(
      `${transcript} .plan-done-check {\n  position: absolute;\n  top: 0;\n  left: 0;\n  color: var(--kleio-done);\n  font-size: 14px;\n}`,
    );
    expect(themeCss).toContain(`${transcript} .plan-done-state {\n  color: var(--kleio-muted);\n}`);
  });

  it("sets the waiting line as the activity line is: 40px, 14px, the second text colour", () => {
    const rule =
      /html:root \.app\.app-session > \.plan-review > \.plan-review-status \{[^}]+\}/.exec(
        themeCss,
      )?.[0];
    expect(rule).toContain("height: 40px;");
    expect(rule).toContain("padding: 0 14px;");
    expect(rule).toContain("color: var(--kleio-text-2);");
    expect(rule).toContain("font-size: 14px;");
  });

  it("gives the iPhone both rules, and none of its own", () => {
    expect(themeCss.match(/\.plan-done\b[^{]*\{/g)?.every((s) => !s.includes("platform-ios"))).toBe(
      true,
    );
    expect(themeCss).not.toMatch(/html\.platform-ios[^{]*\.plan-(done|review-status)/);
  });
});
