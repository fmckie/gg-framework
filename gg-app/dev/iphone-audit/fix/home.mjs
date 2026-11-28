// node dev/iphone-audit/fix/home.mjs <name> : Kleio's Home on the phone and the desktop.
import { both, closeBrowser } from "../lib.mjs";
const name = process.argv[2] ?? "home";
await both({ area: "home-fix" }, async (app) => {
  await app.settle(1200);
  await app.capture(name, { scroll: false });
  const plates = await app.page.evaluate(() =>
    [...document.querySelectorAll(".home-actions > *")].map((el) => {
      const r = el.getBoundingClientRect();
      return `${el.className.split(" ").slice(0, 2).join(".")} "${el.textContent.trim()}" ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width * 10) / 10}x${Math.round(r.height * 10) / 10}`;
    }),
  );
  console.log(`-- ${app.device}\n  ${plates.join("\n  ")}`);
});
await closeBrowser();
