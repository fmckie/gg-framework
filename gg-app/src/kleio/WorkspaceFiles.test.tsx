// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { openProjectPath } from "../agent";
import { toast } from "../toast";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../agent", () => ({ openProjectPath: vi.fn(), sendPrompt: vi.fn() }));
vi.mock("../toast", () => ({ toast: vi.fn() }));

const { Markdown } = await import("../Markdown");
const { WorkspaceFileCards, WorkspaceFilesProvider } = await import("./WorkspaceFiles");

const CWD = "/Users/k/kleio-projects/demo";
const OWNER = { kind: "workspace", cwd: CWD } as const;
const REPLY = [
  "Done. Here's the [Quarterly report](report.pdf) and the [Demo site](site/index.html).",
  `I also changed [App.tsx](${CWD}/src/App.tsx).`,
].join("\n\n");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** The transcript's shape: the provider around a reply and its cards. */
async function renderReply(cwd: string | null, text = REPLY): Promise<void> {
  await act(async () => {
    render(
      <WorkspaceFilesProvider cwd={cwd}>
        <Markdown>{text}</Markdown>
        <WorkspaceFileCards text={text} />
      </WorkspaceFilesProvider>,
    );
  });
}

describe("Chat/Code outputs when paired to a Mac mini", () => {
  it("shows a card for each output, but none for source files", async () => {
    vi.mocked(invoke).mockResolvedValue({
      name: "report.pdf",
      size: 2048,
      mime: "application/pdf",
      thumbnail: null,
    });
    await renderReply(CWD);
    expect(screen.getByRole("button", { name: "Open report.pdf" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open site index.html" })).toBeTruthy();
    expect(document.querySelectorAll(".kleio-file")).toHaveLength(2);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("kleio_file_fetch", { owner: OWNER, path: "report.pdf" }),
    );
  });

  it("opens a linked output from the mini, and a site through its preview", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await renderReply(CWD, "[Quarterly report](report.pdf) · [Demo site](site/index.html)");
    vi.mocked(invoke).mockClear();

    fireEvent.click(screen.getByRole("link", { name: "Quarterly report" }));
    fireEvent.click(screen.getByRole("link", { name: "Demo site" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke).toHaveBeenCalledWith("kleio_file_open", { owner: OWNER, path: "report.pdf" });
    expect(invoke).toHaveBeenCalledWith("kleio_site_open", {
      owner: OWNER,
      path: "site/index.html",
    });
    expect(openProjectPath).not.toHaveBeenCalled();
  });

  it("leaves source-file links to the project opener", async () => {
    await renderReply(CWD);
    fireEvent.click(screen.getByRole("link", { name: "App.tsx" }));
    expect(openProjectPath).toHaveBeenCalledWith(`${CWD}/src/App.tsx`);
    expect(invoke).not.toHaveBeenCalledWith("kleio_file_open", expect.anything());
  });

  it("says why a linked output didn't open", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("no such workspace"));
    await renderReply(CWD, "[Demo site](site/index.html)");
    fireEvent.click(screen.getByRole("link", { name: "Demo site" }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        "Kleio only opens files from its project folders.",
        "error",
      ),
    );
  });

  it("changes nothing when not paired", async () => {
    await renderReply(null);
    expect(document.querySelector(".kleio-file")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Quarterly report" }));
    expect(openProjectPath).toHaveBeenCalledWith("report.pdf");
    expect(invoke).not.toHaveBeenCalled();
  });
});
