import { describe, expect, it } from "vitest";
import themeCss from "./kleio-theme.css?raw";
import { PLATE_H, PLATE_W } from "./KleioPlate";

describe("the desktop's small gaps", () => {
  it("lays Home's six plates out three, two, one, each on two half-columns", () => {
    const actions = "html:root .kleio-home > .home-actions";
    expect(themeCss).toContain(
      "grid-template-columns: repeat(6, calc((124px * var(--plate-scale) - var(--plate-gap)) / 2));",
    );
    expect(themeCss).toContain(`${actions} > .kleio-plate {\n  grid-column: span 2;\n}`);
    expect(themeCss).toContain(
      `${actions} > .kleio-plate:nth-child(4) {\n  grid-column: 2 / span 2;\n}`,
    );
    expect(themeCss).toContain(
      `${actions} > .kleio-plate:nth-child(6) {\n  grid-column: 3 / span 2;\n}`,
    );
  });

  it("dulls an off plate once: App.css's .is-dimmed fade is undone on it", () => {
    expect(themeCss).toContain(
      ".kleio-plate.is-dimmed,\n.kleio-plate.is-dimmed:hover {\n  opacity: 1;\n  filter: none;\n}",
    );
    expect(themeCss).toContain(
      ".kleio-plate.is-dimmed .kleio-plate-layer {\n  filter: saturate(0.45) brightness(0.7);\n}",
    );
  });

  it("sizes a plate to the canvases KleioPlate draws", () => {
    expect(themeCss).toContain(`width: calc(${PLATE_W}px * var(--s));`);
    expect(themeCss).toContain(`height: calc(${PLATE_H}px * var(--s));`);
  });

  it("sets Home's and the connect screens' name in the serif, without Bungee's shade", () => {
    expect(themeCss).toContain(
      [
        ":is(.home, .kleio-gate) .kleio-mark .kleio-wordmark {",
        '  font-family: Didot, "Bodoni 72", "Bodoni MT", "Times New Roman", serif;',
      ].join("\n"),
    );
    expect(themeCss).toContain(
      ":is(.home, .kleio-gate) .kleio-mark .kleio-wordmark::after {\n  content: none;\n}",
    );
  });

  it("outweighs the old half-opacity rule on the iPhone too, tapped or not", () => {
    // (0,3,0) for the old rule and its hover; the shared rule adds the root: (0,3,1).
    expect(themeCss).toContain(
      "\n.kleio-cloisonne.is-dimmed,\n.kleio-cloisonne.is-dimmed:hover {\n  opacity: 0.5;\n",
    );
    expect(themeCss).not.toMatch(/html\.platform-ios[^{]*\.kleio-cloisonne/);
  });

  it("steps the five effort bars from 2px to 10px in the mockup's blue", () => {
    const bar = "html:root .app.app-session > .footer .effort-mark i:nth-child";
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
