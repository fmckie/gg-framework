// Settings → About, on the desktop: the maker's page, set like a book's
// colophon. Kleio's mark signs itself once: one pen stroke, masking the mark's
// own PNG, draws it and then the rule the page hangs from. Then the maker, his
// role, one line of intent and where to find his work; then what Kleio is made
// with, and its version. The phone keeps AboutPage's card.

import { useEffect, useState } from "react";
import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { openUrl } from "../agent";
import { localStorageOrNull } from "../app-entry-view";
import mark from "./assets/kleio-mark.png";

const ABOUT = {
  tagline: "Talk to your work: chat, code and specialists in one app.",
  maker: {
    credit: "Designed and built by",
    name: "William McKie",
    role: "AI/ML engineer",
    statement:
      "I built Kleio as my own AI harness: one place to talk, code and hand work to specialists. I hope it helps others too.",
    link: { label: "GitHub", href: "https://github.com/fmckie" },
  },
  colophon: [
    "Made with Tauri 2, React 19, TypeScript and Rust.",
    "The wordmark is set in Bungee, the statement in Mukta Malar, the rest in your system's typeface.",
    "This page moves with CSS and SVG alone, no animation libraries.",
  ],
} as const;

// One continuous stroke (a single M), in the mark PNG's own pixels (381×360).
// Stroked 34 wide with round caps and joins, it covers every pixel of the mark,
// so the finished signature is the mark exactly. The head's SVG maps 1769
// units to the 520px measure, so the mark is 112px wide and the rule is 1px.
const PEN = [
  // Up the column from its foot.
  "M56 386C56 386 73 361.7 80 356C87 350.3 98 352 98 352C98 352 96.3 364.7 96 326C95.7 287.3 95.8 164 96 120C96.2 76 96.3 74.7 97 62C97.7 49.3 100 44 100 44",
  // Round the left scroll, from its eye outwards.
  "C100 44 90 54.3 84 58C78 61.7 69.5 64.2 64 66C58.5 67.8 54.7 70.3 51 69C47.3 67.7 42.5 61.8 42 58C41.5 54.2 44.7 48.2 48 46C51.3 43.8 58 43.3 62 45C66 46.7 70.2 51.5 72 56C73.8 60.5 74 67 73 72C72 77 69.8 82.7 66 86C62.2 89.3 56 91.7 50 92C44 92.3 35.8 91.2 30 88C24.2 84.8 18.3 79 15 73C11.7 67 10 59.2 10 52C10 44.8 11.7 36.2 15 30C18.3 23.8 23.8 18.3 30 15C36.2 11.7 37 10.7 52 10",
  // Across the capital.
  "C67 9.3 97 10.8 120 11C143 11.2 166.7 11 190 11C213.3 11 236.7 11 260 11C283.3 11 315 10.3 330 11",
  // Round the right scroll, into its eye.
  "C345 11.7 344.2 11.8 350 15C355.8 18.2 361.7 23.8 365 30C368.3 36.2 370 44.8 370 52C370 59.2 368.3 67 365 73C361.7 79 355.8 84.8 350 88C344.2 91.2 336 92.2 330 92C324 91.8 317.7 90 314 87C310.3 84 309 78.8 308 74C307 69.2 306.3 62.7 308 58C309.7 53.3 314 48 318 46C322 44 328.7 44.3 332 46C335.3 47.7 337.7 52.7 338 56C338.3 59.3 335.8 63.7 334 66C332.2 68.3 331.8 70.7 327 70",
  // Back along the capital, down a flute, down the stem.
  "C322.2 69.3 312.8 65.3 305 62C297.2 58.7 287.8 53.3 280 50C272.2 46.7 264.7 43.5 258 42C251.3 40.5 245 39.5 240 41C235 42.5 229.3 47.3 228 51C226.7 54.7 232 63 232 63C232 63 219.7 57.3 214 54C208.3 50.7 202.3 43.7 198 43C193.7 42.3 189.3 46.2 188 50C186.7 53.8 189.8 56.3 190 66C190.2 75.7 190.5 98 189 108C187.5 118 181 126 181 126C181 126 175.2 57.3 170 44C164.8 30.7 157.2 45.7 150 46C142.8 46.3 129.3 44.7 127 46C124.7 47.3 134.1 50.7 136 54C137.9 57.3 138.1 55 138.5 66C138.9 77 138.5 70.7 138.5 120C138.5 169.3 138.5 362 138.5 362",
  // Into the small triangle, up the K's inside, then down its arm and out along its leg.
  "L180 262C180 262 180.2 277.7 199 296C217.8 314.3 293 372 293 372C293 372 233.2 281.6 216.8 257.3C200.2 233 200.1 234.4 194 226C187.9 217.6 185.3 206.7 180 207C174.7 207.3 162 228 162 228C162 228 165.1 205 168 196C170.9 187 165.9 190.2 179.4 173.9C192.9 157.6 234.1 115.2 248.9 97.9C263.7 80.6 261.6 79.7 268 70C274.4 60.4 287 40 287 40C287 40 282.7 60.8 281 70C279.3 79.2 280.1 88.3 277 95C273.9 101.7 275.4 95.8 262.1 110.1C248.8 124.4 197.3 181 197.3 181C197.3 181 217 211.1 238.2 242.7C259.5 274.3 325 370.5 325 370.5",
  // The flourish: out to the rule's far end, then along it.
  "C437 536 1250 750.1 1110 750.1L-730 750.1",
].join("");
const VIEW = { x: -694, width: 1769, height: 752 };
const RULE_Y = 748.42; // 220px down: the head's last pixel row

const SIGNED = "kleio.about.signed";
const INK = "kleio-ab-ink";
// The signature's delay and length (kleio-settings.css), and a little over: if
// its end is never reported, the mark is unmasked by then all the same.
const SIGNING_MS = 320 + 2200 + 400;
// Where nothing can be stored, the first open is remembered for this visit.
let signedThisVisit = false;

// Signs on the first open only, and only when motion is welcome.
function firstSigning(): boolean {
  if (signedThisVisit) return false;
  try {
    if (localStorageOrNull()?.getItem(SIGNED)) return false;
  } catch {
    // Unreadable: this visit's own note decides.
  }
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: no-preference)").matches
  );
}

export function AboutColophon({ version }: { version: string | null }): React.ReactElement {
  const [signing, setSigning] = useState(firstSigning);

  useEffect(() => {
    signedThisVisit = true;
    try {
      localStorageOrNull()?.setItem(SIGNED, "1");
    } catch {
      // Remembered for this visit only.
    }
  }, []);

  useEffect(() => {
    if (!signing) return;
    const timer = setTimeout(() => setSigning(false), SIGNING_MS);
    return () => clearTimeout(timer);
  }, [signing]);

  const { maker } = ABOUT;
  return (
    <section className="ab-page" aria-label="About Kleio">
      <header className="ab-head">
        <div className="ab-device" role="img" aria-label="Kleio">
          <svg
            className={`ab-sign${signing ? " is-signing" : ""}`}
            viewBox={`${VIEW.x} 0 ${VIEW.width} ${VIEW.height}`}
            // Narrower than the measure, the mark keeps its size and the rule is cut to fit.
            preserveAspectRatio="xMidYMin slice"
            aria-hidden="true"
            focusable="false"
            onAnimationEnd={(e) => {
              if (e.animationName === "kleio-ab-sign") setSigning(false);
            }}
          >
            <defs>
              <mask
                id={INK}
                maskUnits="userSpaceOnUse"
                x={VIEW.x}
                y="0"
                width={VIEW.width}
                height={VIEW.height}
                style={{ maskType: "alpha" }}
              >
                <path className="ab-pen" d={PEN} pathLength={1} />
              </mask>
            </defs>
            {/* Masked by the pen only while it signs: at rest this is the plain mark. */}
            <g className="ab-ink" mask={signing ? `url(#${INK})` : undefined}>
              <image href={mark} x="0" y="0" width="381" height="360" />
              <rect className="ab-rule" x={VIEW.x} y={RULE_Y} width={VIEW.width} height="3.402" />
            </g>
          </svg>
          <span className="kleio-wordmark ab-wordmark" aria-hidden="true">
            KLEIO
          </span>
        </div>
        <p className="ab-tagline">{ABOUT.tagline}</p>
      </header>

      <div className="ab-maker">
        <p className="ab-credit">
          <span className="st-label">{maker.credit}</span>{" "}
          <span className="ab-name">{maker.name}</span>
        </p>
        <p className="ab-role">{maker.role}</p>
        <p className="ab-statement">{maker.statement}</p>
        <p className="ab-elsewhere">
          <a
            className="ab-link"
            href={maker.link.href}
            onClick={(e) => {
              e.preventDefault();
              void openUrl(maker.link.href);
            }}
          >
            {maker.link.label}
            <ArrowUpRightIcon
              className="ab-link-arrow"
              size={13}
              weight="bold"
              aria-hidden="true"
            />{" "}
            <span className="sr-only">(opens in your browser)</span>
          </a>
        </p>
      </div>

      <footer className="ab-colophon">
        <hr className="ab-short-rule" />
        {ABOUT.colophon.map((line) => (
          <p key={line} className="ab-colophon-line">
            {line}
          </p>
        ))}
        {version && <p className="ab-version">{`Version ${version}`}</p>}
      </footer>
    </section>
  );
}
