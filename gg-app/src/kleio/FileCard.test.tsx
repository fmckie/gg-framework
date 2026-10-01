// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { FileCard } from "./FileCard";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const OWNER = { kind: "blob", blobId: "b_0000aaaa" } as const;
const PATH = "Morning-AI-Research-2026-10-01.pdf";
const THUMB = "data:image/png;base64,iVBORw0KGgo=";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderCard(): Promise<void> {
  await act(async () => {
    render(<FileCard owner={OWNER} path={PATH} label="Your AI research report" />);
  });
}

describe("FileCard", () => {
  it("shows the report's first page, name, kind and size, and opens it", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "kleio_file_fetch")
        return { name: PATH, size: 48_000, mime: "application/pdf", thumbnail: THUMB };
      return undefined;
    });
    await renderCard();
    await waitFor(() => expect(screen.getByText("PDF document · 47 KB")).toBeTruthy());
    expect(invoke).toHaveBeenCalledWith("kleio_file_fetch", { owner: OWNER, path: PATH });
    expect(screen.getByText("Your AI research report")).toBeTruthy();
    expect(screen.getByText(PATH)).toBeTruthy();
    expect(document.querySelector("img.kleio-file-thumb")?.getAttribute("src")).toBe(THUMB);

    fireEvent.click(screen.getByRole("button", { name: `Open ${PATH}` }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("kleio_file_open", { owner: OWNER, path: PATH }),
    );
  });

  it("saves a copy, and says so", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "kleio_file_fetch")
        return { name: PATH, size: 10, mime: "application/pdf", thumbnail: null };
      if (cmd === "kleio_file_save") return true;
      return undefined;
    });
    await renderCard();
    await waitFor(() => expect(screen.getByRole("button", { name: /Save a copy/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Save a copy/ }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved."));
  });

  it("explains a file that's gone, without Open or Save", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("no such file"));
    await renderCard();
    await waitFor(() => expect(screen.getByText(/isn't on your Mac mini any more/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Save a copy/ })).toBeNull();
    expect(
      (screen.getByRole("button", { name: `Open ${PATH}` }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
