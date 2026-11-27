// The composer and footer: idle, a multi-line draft, the slash and @ menus, an attachment,
// every panel the footer and composer open, and mid-run.
import { both, closeBrowser, enterSession } from "../lib.mjs";
import { AREA, probe, startRun } from "./common.mjs";

const FILES = [
  "src/checkout/retry.ts",
  "src/checkout/RetryPage.tsx",
  "src/checkout/components/OrderSummaryWithAVeryLongComponentNameForWrapping.tsx",
  "src/cart/cart.integration.test.ts",
  "docs/checkout-retry-with-idempotency-keys-and-the-old-flow.md",
  "scripts/replay-checkout.mjs",
].map((p) => ({ path: p, name: p.split("/").pop() }));

// A 1x1 PNG, made up.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const COMPOSER = [".inputwrap", ".inputrow", ".input-stack", "textarea.input", ".inputactions-trailing", ".enhance-pill", ".panel-entry-bar", ".footer", ".footer-right", ".footer-right > *", ".footer-sep", ".model-anchor", ".model-picker", ".model-anchor select", ".model-label", ".liveregion", ".activity", ".helper-chip"];

await both(
  {
    area: AREA,
    invoke: (cmd) => (cmd === "agent_files" ? { files: FILES } : undefined),
  },
  async (app) => {
    const { page } = app;
    const step = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        console.log(`\n!! ${app.device} step ${name}: ${String(e?.message ?? e).split("\n")[0]}`);
      }
    };
    const textarea = page.locator("textarea.input");
    await enterSession(app);
    await app.settle(4500);

    await step("idle", async () => {
      await app.capture("footer-composer", { element: ".inputwrap", scroll: false });
      await probe(app, "footer-composer", COMPOSER);
    });

    await step("draft", async () => {
      await textarea.fill("Add checkout retry with idempotency keys.\nKeep the old flow behind a flag,\nthen rerun the cart integration tests and tell me which ones are still flaky on CI.");
      await app.settle(900);
      await app.capture("composer-draft", { element: ".inputwrap", scroll: false });
      await probe(app, "composer-draft", COMPOSER);
      await textarea.fill("");
      await app.settle(300);
    });

    await step("slash", async () => {
      await textarea.focus();
      await page.keyboard.type("/");
      await app.settle(700);
      await app.capture("menu-slash", { scroll: false });
      await probe(app, "menu-slash", [".slash-menu", ".slash-item", ".command-menu", "[role=listbox]", "[role=option]", ".slash-menu-hint", ".menu-hint"]);
      await textarea.fill("");
      await app.settle(300);
    });

    await step("mention", async () => {
      await textarea.focus();
      await page.keyboard.type("@");
      await app.settle(900);
      await app.capture("menu-mention", { scroll: false });
      await probe(app, "menu-mention", ["[role=listbox]", "[role=option]", ".mention-menu", ".mention-item"]);
      await textarea.fill("");
      await app.settle(300);
    });

    await step("attach", async () => {
      const chooser = page.waitForEvent("filechooser", { timeout: 4000 });
      await app.tap(page.getByTitle("Attach files"));
      const fc = await chooser;
      await fc.setFiles([{ name: "made-up-receipt.png", mimeType: "image/png", buffer: PNG }]);
      await app.settle(1200);
      await app.capture("composer-attached", { element: ".inputwrap", scroll: false });
      await probe(app, "composer-attached", [".attachments", ".attachment", ".attachment button", ".attach-chip", ".attach-chip button", ".inputwrap img", ".inputwrap button"]);
    });

    await step("more", async () => {
      await app.tap(".more-entry");
      await app.settle(500);
      await app.capture("panel-more", { scroll: false });
      await probe(app, "panel-more", [".composer-panel", ".panel-header", ".panel-esc", ".panel-close", ".priority-action"]);
      await app.tap(".composer-panel .panel-close");
    });

    await step("branch", async () => {
      await app.tap(".branch-entry");
      await app.settle(500);
      await app.capture("panel-branch", { scroll: false });
      await probe(app, "panel-branch", [".composer-panel", ".panel-header", ".panel-meta", ".panel-esc", ".panel-close", ".branch-actions", ".branch-action"]);
      await app.tap(".composer-panel .panel-close");
    });

    await step("context", async () => {
      await app.tap(".ctx-button");
      await app.settle(700);
      await app.capture("panel-context", { scroll: false });
      await probe(app, "panel-context", [".usage-popover", ".usage-popover button", ".usage-close", ".usage-popover *[class*=row]"]);
      const close = page.locator(".usage-popover .usage-close");
      if (await close.isVisible().catch(() => false)) await app.tap(close);
      else await page.keyboard.press("Escape");
      await app.settle(300);
    });

    await step("model", async () => {
      await app.tap(".model-trigger");
      await app.settle(900);
      await app.capture("panel-model");
      await probe(app, "panel-model", [".model-panel", ".model-panel .panel-header", ".model-panel button", ".thinking-levels", ".thinking-choice", ".thinking-choice span", ".model-close", ".model-panel input", ".model-row", ".model-panel [role=option]"]);
      const close = page.locator(".model-panel .model-close, .model-panel .panel-close").first();
      if (await close.isVisible().catch(() => false)) await app.tap(close);
      else await page.keyboard.press("Escape");
      await app.settle(400);
    });

    await step("helper-model", async () => {
      // Helper's picker (ModelSelect): the second model control in the footer.
      const anchor = page.locator(".footer .model-anchor").nth(1);
      await probe(app, "panel-helper-model-closed", [".footer .model-anchor", ".footer .model-anchor *"]);
      await app.tap(anchor.locator("button, select, [role=button], [role=combobox]").first());
      await app.settle(700);
      await app.capture("panel-helper-model", { scroll: false });
      await probe(app, "panel-helper-model", [".model-menu", ".model-menu *[role=option]", ".model-option", "[role=listbox]", "[role=option]", ".model-anchor select"]);
      await page.keyboard.press("Escape");
      await app.settle(300);
    });

    await step("thinking", async () => {
      await app.tap(".thinking-toggle");
      await app.settle(500);
      await app.capture("footer-thinking", { element: ".footer", scroll: false });
    });

    await step("running", async () => {
      await page.reload({ waitUntil: "load" });
      await app.settle(1800);
      await enterSession(app);
      await startRun(app);
      for (const chunk of ["Looking at the retry wiring now. ", "The cart tests come next."]) await app.emit("text_delta", { text: chunk });
      await app.settle(900);
      await app.capture("composer-running", { element: ".inputwrap", scroll: false });
      await probe(app, "composer-running", [...COMPOSER, ".liveregion button", ".cancel", ".tools-toggle"]);
      await textarea.fill("also rerun the dark-mode snapshot tests when that is done");
      await app.settle(700);
      await app.capture("composer-running-draft", { element: ".inputwrap", scroll: false });
      await probe(app, "composer-running-draft", COMPOSER);
    });
  },
);
await closeBrowser();
