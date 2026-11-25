import { describe, expect, it } from "vitest";
import { chatTitle, readableSessionTitle } from "./session-title";

describe("readableSessionTitle", () => {
  it("leaves an ordinary title alone", () => {
    expect(readableSessionTitle("Plan my week")).toBe("Plan my week");
  });

  it("names an image-only chat whose preview was cut mid-path", () => {
    expect(
      readableSessionTitle(
        "[Image saved at /Users/me/app/.gg/uploads/mhj2k3l0-Screenshot_2026-11-03_at_10.1",
      ),
    ).toBe("Image");
  });

  it("shows the words typed after the image", () => {
    expect(
      readableSessionTitle("[Image saved at /p/.gg/uploads/a.png] Why is the header blank?"),
    ).toBe("Why is the header blank?");
  });

  it("counts several images", () => {
    expect(readableSessionTitle("[Image saved at /p/a.png] [Image saved at /p/b.png]")).toBe(
      "2 images",
    );
  });
});

describe("chatTitle", () => {
  it("is the first message on one line", () => {
    expect(chatTitle("  Plan my week\n\nstarting Monday ")).toBe("Plan my week starting Monday");
  });

  it("is Untitled chat for a chat with no message yet", () => {
    expect(chatTitle(undefined)).toBe("Untitled chat");
    expect(chatTitle("   ")).toBe("Untitled chat");
  });

  it("names an image-only first message as the browser does", () => {
    expect(chatTitle("[Image saved at /w/.gg/uploads/a.png]")).toBe("Image");
  });
});
