// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { KleioGate } from "./KleioGate";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./LazyRemoteHostModal", () => ({
  RemoteHostModal: () => <div role="dialog" aria-label="Pair" />,
}));
const invokeMock = vi.mocked(invoke);

const ACTIVE = {
  base: "https://mini.test:8443",
  host: "mini.test",
  deviceId: "d1",
  label: "Laptop",
  admin: true,
};

function answer(status: unknown, health: () => Promise<unknown>): void {
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "kleio_remote_status") return status;
    if (cmd === "kleio_api") return health();
    throw new Error(`unexpected ${cmd}`);
  });
}

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("KleioGate", () => {
  it("never opens the app unpaired: shows the connect screen", async () => {
    answer({ active: null, paired: null }, async () => ({ status: 200 }));
    render(
      <KleioGate>
        <p>the app</p>
      </KleioGate>,
    );
    expect(await screen.findByText("Connect to your Mac mini")).toBeDefined();
    expect(screen.queryByText("the app")).toBeNull();
    expect(invokeMock).not.toHaveBeenCalledWith("kleio_api", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Pair with your Mac mini" }));
    expect(screen.getByRole("dialog", { name: "Pair" })).toBeDefined();
  });

  it("opens the app once paired and the Mac mini answers", async () => {
    answer({ active: ACTIVE, paired: null }, async () => ({ status: 200 }));
    render(
      <KleioGate>
        <p>the app</p>
      </KleioGate>,
    );
    expect(await screen.findByText("the app")).toBeDefined();
    expect(invokeMock).toHaveBeenCalledWith("kleio_api", {
      method: "GET",
      path: "/kleio/health",
    });
  });

  it("says when the Mac mini can't be reached, and retries", async () => {
    let up = false;
    answer({ active: ACTIVE, paired: null }, async () => {
      if (!up) throw new Error("offline");
      return { status: 200 };
    });
    render(
      <KleioGate>
        <p>the app</p>
      </KleioGate>,
    );
    expect(await screen.findByText("Can't reach your Mac mini")).toBeDefined();
    expect(screen.queryByText("the app")).toBeNull();
    up = true;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("the app")).toBeDefined());
  });
});
