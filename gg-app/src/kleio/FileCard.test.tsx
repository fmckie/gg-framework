// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { FileCard } from "./FileCard";
import { FileViewerProvider } from "./FileViewerProvider";
import type { FileOwner } from "./kleioFiles";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
// The viewer draws documents through Markdown, which reaches the Tauri bridge on import.
vi.mock("../agent", () => ({ openProjectPath: vi.fn(), sendPrompt: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

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
    await waitFor(() => expect(screen.getByText(/isn't on your host any more/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Save a copy/ })).toBeNull();
    expect(
      (screen.getByRole("button", { name: `Open ${PATH}` }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shows the name once when the card is titled with it", async () => {
    vi.mocked(invoke).mockResolvedValue({
      name: PATH,
      size: 10,
      mime: "application/pdf",
      thumbnail: null,
    });
    await act(async () => {
      render(<FileCard owner={OWNER} path={PATH} label={PATH} />);
    });
    await waitFor(() => expect(screen.getByText("PDF document · 10 bytes")).toBeTruthy());
    expect(screen.getAllByText(PATH)).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Save a copy/ })).toBeTruthy();
  });

  it("shows a file the reply only named once it's found, and nothing when it isn't there", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("no such file"));
    let view: ReturnType<typeof render> | undefined;
    await act(async () => {
      view = render(<FileCard owner={OWNER} path="chart.png" label="chart.png" named />);
    });
    await waitFor(() => expect(view?.container.innerHTML).toBe(""));
    cleanup();
    vi.mocked(invoke).mockResolvedValue({
      name: "chart.png",
      size: 2048,
      mime: "image/png",
      thumbnail: null,
    });
    await act(async () => {
      render(<FileCard owner={OWNER} path="chart.png" label="chart.png" named />);
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /Save a copy/ })).toBeTruthy());
  });

  it("fetches a Chat/Code file by its workspace owner", async () => {
    const owner = { kind: "workspace", cwd: "/Users/k/kleio-projects/demo" } as const;
    vi.mocked(invoke).mockResolvedValue({
      name: "report.pdf",
      size: 2048,
      mime: "application/pdf",
      thumbnail: null,
    });
    await act(async () => {
      render(<FileCard owner={owner} path="out/report.pdf" label="Quarterly report" />);
    });
    await waitFor(() => expect(screen.getByText("PDF document · 2 KB")).toBeTruthy());
    expect(invoke).toHaveBeenCalledWith("kleio_file_fetch", { owner, path: "out/report.pdf" });
  });
});

describe("FileCard for a website", () => {
  const SITE_OWNER = { kind: "workspace", cwd: "/Users/k/kleio-projects/demo" } as const;
  const SITE = "site/index.html";

  async function renderSite(): Promise<void> {
    await act(async () => {
      render(<FileCard owner={SITE_OWNER} path={SITE} label="Demo site" />);
    });
  }

  it("offers Open site only, opens it through the Mac mini, and never downloads it", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await renderSite();
    expect(screen.getByText("Demo site")).toBeTruthy();
    expect(screen.getByText("Website · opens in your browser")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Save a copy/ })).toBeNull();
    expect(document.querySelector("img")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open site" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("kleio_site_open", { owner: SITE_OWNER, path: SITE }),
    );
    expect(vi.mocked(invoke).mock.calls.map(([cmd]) => cmd)).toEqual(["kleio_site_open"]);
  });

  it.each([
    ["not_a_site", "Only web pages open as a site."],
    ["not_found", "Your host needs an update to open sites."],
    ["no such file", "isn't on your host any more"],
    ["no such workspace", "Kleio only opens files from its project folders."],
    ["bad_request", "Update Kleio on both devices."],
  ])("explains a %s error", async (raw, shown) => {
    vi.mocked(invoke).mockRejectedValue(new Error(raw));
    await renderSite();
    fireEvent.click(screen.getByRole("button", { name: `Open site index.html` }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain(shown));
    expect((screen.getByRole("button", { name: "Open site" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe("FileCard in the app, beside its file viewer", () => {
  const MEMBER = { kind: "group", groupId: "g_00ff00ff", blobId: "b_0000aaaa" } as const;

  function respond(): void {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "kleio_file_fetch")
        return { name: PATH, size: 10, mime: "application/octet-stream", thumbnail: null };
      // The host is still readying the show: the viewer says it's opening.
      if (cmd === "kleio_api") return new Promise(() => {});
      return undefined;
    });
  }

  async function renderInApp(owner: FileOwner, path: string, label: string): Promise<void> {
    await act(async () => {
      render(
        <FileViewerProvider>
          <FileCard owner={owner} path={path} label={label} />
        </FileViewerProvider>,
      );
    });
  }

  it.each([
    { owner: OWNER, body: { source: "specialist", id: "b_0000aaaa", path: PATH } },
    {
      owner: MEMBER,
      body: { source: "group", id: "g_00ff00ff", member: "b_0000aaaa", path: PATH },
    },
  ])("opens a PDF in the viewer, asked of the host as $body.source's", async ({ owner, body }) => {
    respond();
    await renderInApp(owner, PATH, "Your AI research report");
    fireEvent.click(screen.getByRole("button", { name: `Open ${PATH}` }));
    expect(await screen.findByRole("dialog", { name: "Your AI research report" })).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("kleio_api", {
      method: "POST",
      path: "/kleio/voice/show",
      body,
      session: null,
    });
    expect(invoke).not.toHaveBeenCalledWith("kleio_file_open", expect.anything());
  });

  it("still opens a kind the viewer doesn't draw in its app", async () => {
    respond();
    await renderInApp(OWNER, "Q3 plan.docx", "The plan");
    fireEvent.click(screen.getByRole("button", { name: "Open Q3 plan.docx" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("kleio_file_open", {
        owner: OWNER,
        path: "Q3 plan.docx",
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still opens a web page as a site", async () => {
    respond();
    await renderInApp(OWNER, "site/index.html", "The menu site");
    fireEvent.click(screen.getByRole("button", { name: "Open site index.html" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("kleio_site_open", {
        owner: OWNER,
        path: "site/index.html",
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
