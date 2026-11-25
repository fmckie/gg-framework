import { describe, expect, it } from "vitest";
import themeCss from "./kleio-theme.css?raw";

describe("the desktop's small gaps", () => {
  it("shows Home's off button as grey on a flat rim and dark enamel, at full opacity", () => {
    expect(themeCss).toContain(
      [
        "html:not(.platform-ios) .kleio-cloisonne.is-dimmed,",
        "html:not(.platform-ios) .kleio-cloisonne.is-dimmed:hover {",
        "  opacity: 1;",
        "  color: #a19798;",
        "  background: linear-gradient(#3b3435, #3b3435) border-box;",
        "}",
        "html:not(.platform-ios) .kleio-cloisonne.is-dimmed::before {",
        "  background-color: #1d1819;",
        "  box-shadow: none;",
        "}",
      ].join("\n"),
    );
  });

  it("leaves the iPhone's off button at half opacity", () => {
    expect(themeCss).toContain(
      "\n.kleio-cloisonne.is-dimmed,\n.kleio-cloisonne.is-dimmed:hover {\n  opacity: 0.5;\n",
    );
  });

  it("steps the five effort bars from 2px to 10px in the mockup's blue", () => {
    const bar = "html:not(.platform-ios) .app.app-session > .footer .effort-mark i:nth-child";
    [2, 4, 6, 8, 10].forEach((height, index) => {
      expect(themeCss).toContain(`${bar}(${index + 1}) {\n  height: ${height}px;\n}`);
    });
    expect(themeCss).toMatch(/\.effort-mark i \{\n {2}width: 2px;\n {2}background: #94a2c4;\n\}/);
  });

  it("ships Mukta Malar in Regular and Bold only: Medium is not a woff2 yet", () => {
    const faces = themeCss.match(/font-family: "Mukta Malar";\n {2}src: [^\n]+/g) ?? [];
    expect(faces.map((face) => /MuktaMalar-(\w+)\.woff2/.exec(face)?.[1])).toEqual([
      "Regular",
      "Bold",
    ]);
  });
});
