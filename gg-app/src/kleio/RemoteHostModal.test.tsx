// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { RemoteHostModal, relTime } from "./RemoteHostModal";
import { KleioBadge } from "./KleioBadge";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(async () => undefined) }));

const invokeMock = vi.mocked(invoke);

const REC = {
  baseUrl: "https://mac-mini-1.example.ts.net:8443",
  host: "mac-mini-1.example.ts.net",
  deviceId: "dev-self",
  label: "Laptop",
  admin: false,
  pairedAt: "2026-09-22T10:00:00Z",
};
const ACTIVE = {
  base: REC.baseUrl,
  host: REC.host,
  deviceId: REC.deviceId,
  label: REC.label,
  admin: false,
};

/** Route invoke() by command name; tests override individual commands. */
function routes(map: Record<string, (args?: Record<string, unknown>) => unknown>): void {
  invokeMock.mockImplementation(async (cmd, args) => {
    const fn = map[cmd];
    if (!fn) throw new Error(`unexpected invoke ${cmd}`);
    return fn(args as Record<string, unknown> | undefined);
  });
}

beforeEach(() => {
  invokeMock.mockReset();
});
afterEach(cleanup);

describe("KleioBadge", () => {
  it("renders nothing in local mode and a short host name when remote", () => {
    const { container, rerender } = render(<KleioBadge active={null} onClick={() => {}} />);
    expect(container.firstChild).toBeNull();
    const onClick = vi.fn();
    rerender(<KleioBadge active={ACTIVE} onClick={onClick} />);
    const b = screen.getByRole("button", { name: /connected to kleio host/i });
    expect(b.textContent).toContain("on mac-mini-1");
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("RemoteHostModal — not paired", () => {
  it("pairs, then offers a restart; the token never touches React", async () => {
    let paired = false;
    routes({
      kleio_remote_status: () => ({ active: null, paired: paired ? REC : null }),
      kleio_pair: (args) => {
        expect(args).toEqual({
          baseUrl: "https://mac-mini-1.example.ts.net:8443",
          code: "ABC-DEF",
          label: "Laptop",
        });
        paired = true;
        return REC;
      },
    });
    render(<RemoteHostModal onClose={() => {}} />);
    await screen.findByLabelText("Host URL");
    fireEvent.change(screen.getByLabelText("Host URL"), {
      target: { value: "https://mac-mini-1.example.ts.net:8443" },
    });
    fireEvent.change(screen.getByLabelText("Pair code"), { target: { value: "abc-def" } });
    fireEvent.change(screen.getByLabelText("This device's name"), { target: { value: "Laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    await screen.findByRole("status");
    expect(screen.getByRole("status").textContent).toMatch(/Restart gg-app to apply/);
    fireEvent.click(screen.getByRole("button", { name: "Restart now" }));
    expect(relaunch).toHaveBeenCalledOnce();
    // The pairing ticket (with token) is consumed in Rust; React only ever saw the record.
    expect(JSON.stringify(invokeMock.mock.results)).not.toMatch(/token/i);
  });

  it("surfaces the host's error verbatim and stays on the form", async () => {
    routes({
      kleio_remote_status: () => ({ active: null, paired: null }),
      kleio_pair: () => {
        throw new Error("Code not recognised, or it expired. Mint a fresh one on the host.");
      },
    });
    render(<RemoteHostModal onClose={() => {}} />);
    await screen.findByLabelText("Host URL");
    fireEvent.change(screen.getByLabelText("Host URL"), { target: { value: "https://x:1" } });
    fireEvent.change(screen.getByLabelText("Pair code"), { target: { value: "ZZZZZZ" } });
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Code not recognised/);
    expect((screen.getByRole("button", { name: "Pair" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe("RemoteHostModal — paired", () => {
  it("shows the host, no Devices tab for a non-admin, and forget needs a confirm", async () => {
    let paired: typeof REC | null = REC;
    routes({
      kleio_remote_status: () => ({ active: ACTIVE, paired }),
      kleio_forget: () => {
        paired = null;
      },
    });
    render(<RemoteHostModal onClose={() => {}} />);
    await screen.findByText("Connected — sessions run on the host");
    expect(screen.queryByRole("tab", { name: "Devices" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Forget host…" }));
    expect(invokeMock).not.toHaveBeenCalledWith("kleio_forget");
    fireEvent.click(screen.getByRole("button", { name: "Forget host" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("kleio_forget"));
    await screen.findByRole("status");
    expect(screen.getByRole("status").textContent).toMatch(/You just forgot the host/);
  });
});

describe("RemoteHostModal — admin", () => {
  const ADMIN_REC = { ...REC, admin: true };
  const ADMIN_ACTIVE = { ...ACTIVE, admin: true };
  const DEVICES = [
    {
      deviceId: "dev-self",
      label: "Laptop",
      createdAt: "2026-09-22T10:00:00Z",
      lastSeen: null,
      revoked: false,
      admin: true,
    },
    {
      deviceId: "dev-phone",
      label: "Phone",
      createdAt: "2026-09-22T10:00:00Z",
      lastSeen: "2026-09-22T10:05:00Z",
      revoked: false,
      admin: false,
    },
  ];

  it("lists devices, cannot revoke itself, revokes another after confirm, mints a code", async () => {
    let devices = DEVICES;
    routes({
      kleio_remote_status: () => ({ active: ADMIN_ACTIVE, paired: ADMIN_REC }),
      kleio_admin_state: () => ({
        unlocked: true,
        expiresAt: Date.now() + 60_000,
        available: true,
      }),
      kleio_devices: () => devices,
      kleio_revoke: (args) => {
        expect(args).toEqual({ deviceId: "dev-phone" });
        devices = devices.map((d) => (d.deviceId === "dev-phone" ? { ...d, revoked: true } : d));
        return devices;
      },
      kleio_offer: (args) => {
        expect(args).toEqual({ admin: true });
        return {
          display: "QRS-TUV",
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          admin: true,
        };
      },
    });
    render(<RemoteHostModal onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Devices" }));
    await screen.findByText("Phone");
    // Self row: no revoke button, only the em-dash pointer to Forget host.
    const selfRow = screen.getByText("Laptop").closest("tr")!;
    expect(selfRow.querySelector("button")).toBeNull();
    // Other row: confirm then revoke.
    const phoneRow = screen.getByText("Phone").closest("tr")!;
    fireEvent.click(phoneRow.querySelector("button")!); // Revoke…
    expect(invokeMock).not.toHaveBeenCalledWith("kleio_revoke", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(screen.getByText("Phone").closest("tr")!.className).toBe("revoked"));
    // Mint an admin code.
    fireEvent.click(screen.getByLabelText("Make the new device an admin"));
    fireEvent.click(screen.getByRole("button", { name: "New pair code" }));
    await screen.findByText("QRS-TUV");
  });

  it("explains a Touch ID refusal instead of a raw error", async () => {
    routes({
      kleio_remote_status: () => ({ active: ADMIN_ACTIVE, paired: ADMIN_REC }),
      kleio_admin_state: () => ({ unlocked: false, expiresAt: null, available: true }),
      kleio_devices: () => {
        throw new Error("denied:denied");
      },
    });
    render(<RemoteHostModal onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Devices" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Touch ID was cancelled/);
  });
});

describe("relTime", () => {
  it("formats past and future", () => {
    const now = Date.parse("2026-09-22T12:00:00Z");
    expect(relTime("2026-09-22T11:57:00Z", now)).toBe("3 min ago");
    expect(relTime("2026-09-22T12:04:10Z", now)).toBe("in 4 min");
    expect(relTime("2026-09-20T12:00:00Z", now)).toBe("2 d ago");
    expect(relTime("garbage", now)).toBe("garbage");
  });
});
