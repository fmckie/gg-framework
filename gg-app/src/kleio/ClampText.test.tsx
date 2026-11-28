// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClampText } from "./ClampText";

const LONG =
  "Every weekday, sort my inbox and file receipts to https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/receipts-and-invoices-2026.";

/** jsdom lays nothing out: say how tall the text is against its clamped box. */
function heights(scroll: number, client: number): void {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(scroll);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(client);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.classList.remove("platform-ios");
});

describe("ClampText", () => {
  it("is the desktop's own paragraph, whole and not a button", () => {
    heights(120, 40);
    const { container } = render(<ClampText className="kleio-job-text">{LONG}</ClampText>);
    const p = container.firstElementChild!;
    expect(p.outerHTML).toBe(`<p class="kleio-job-text">${LONG}</p>`);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("on the iPhone, opens a cut description on a tap and closes it on another", () => {
    document.documentElement.classList.add("platform-ios");
    heights(120, 40);
    render(<ClampText className="kleio-job-text">{LONG}</ClampText>);
    const p = screen.getByRole("button", { name: LONG });
    expect(p.className).toBe("kleio-job-text clamp-text");
    expect(p.querySelector(":scope > .clamp-body")?.textContent).toBe(LONG);
    expect(p.getAttribute("aria-expanded")).toBe("false");
    expect(p.hasAttribute("data-open")).toBe(false);

    fireEvent.click(p);
    expect(p.getAttribute("aria-expanded")).toBe("true");
    expect(p.hasAttribute("data-open")).toBe(true);
    fireEvent.keyDown(p, { key: "Enter" });
    expect(p.getAttribute("aria-expanded")).toBe("false");
  });

  it("on the iPhone, leaves a description that fits as plain text", () => {
    document.documentElement.classList.add("platform-ios");
    heights(40, 40);
    const { container } = render(<ClampText className="cast-p-job">Short.</ClampText>);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector(".cast-p-job.clamp-text")?.hasAttribute("tabindex")).toBe(false);
  });
});
