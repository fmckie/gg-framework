// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import * as scanner from "@tauri-apps/plugin-barcode-scanner";
import { RemoteHostModal } from "./RemoteHostModal";
import { relTime } from "./relTime";
import { KleioBadge } from "./KleioBadge";
import type { LinkStatus } from "./kleioLink";
import { NOT_A_TICKET } from "./pairTicket";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-barcode-scanner", () => ({
  Format: { QRCode: "QR_CODE" },
  scan: vi.fn(),
  cancel: vi.fn(async () => undefined),
  checkPermissions: vi.fn(async () => "granted"),
  requestPermissions: vi.fn(async () => "granted"),
}));

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
  vi.mocked(relaunch).mockClear();
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
      // A computer applies a pairing by relaunching.
      kleio_activate_pairing: () => "restart",
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
    expect(screen.getByRole("status").textContent).toMatch(/Restart Kleio to apply/);
    fireEvent.click(screen.getByRole("button", { name: "Restart now" }));
    expect(relaunch).toHaveBeenCalledOnce();
    // The pairing ticket (with token) is consumed in Rust; React only ever saw the record.
    expect(JSON.stringify(invokeMock.mock.results)).not.toMatch(/token/i);
  });

  it("on the iPhone, a pairing that switches on in place closes into the app", async () => {
    let paired = false;
    routes({
      kleio_remote_status: () => ({ active: null, paired: paired ? REC : null }),
      kleio_pair: () => {
        paired = true;
        return REC;
      },
      kleio_activate_pairing: () => "active",
    });
    const onClose = vi.fn();
    render(<RemoteHostModal onClose={onClose} />);
    await screen.findByLabelText("Host URL");
    fireEvent.change(screen.getByLabelText("Host URL"), {
      target: { value: "https://mac-mini-1.example.ts.net:8443" },
    });
    fireEvent.change(screen.getByLabelText("Pair code"), { target: { value: "abc-def" } });
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(relaunch).not.toHaveBeenCalled();
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

describe("RemoteHostModal — pairing over the Kleio link (connection prototype)", () => {
  // `routes` turns away a command it doesn't list, as a build without the
  // `kleio-link` feature turns away the link's commands.
  const NO_LINK: LinkStatus = {
    paired: false,
    active: false,
    running: false,
    error: null,
    mode: null,
    host: null,
    hostKey: null,
    relay: null,
    refused: null,
    connected: false,
    path: null,
    pathAddr: null,
    tailscale: false,
    rttMs: null,
    connectedSinceMs: null,
    redials: 0,
    lastResumeMs: null,
    events: [],
    debugBuild: true,
  };
  const LINK_REC = { ...REC, baseUrl: "http://127.0.0.1:47821" };
  const TICKET = JSON.stringify({
    v: 4,
    type: "kleio-pair",
    name: "mac-mini-1",
    key: "ab12cd34ef".padEnd(64, "0"),
    relays: ["https://euc1-1.relay.n0.iroh.link./", "n0"],
    addrs: ["192.168.1.20:52043"],
    code: "ABC-DEF",
  });
  const CHECKED = {
    name: "mac-mini-1",
    keyPrefix: "ab12cd34ef",
    relayHost: "euc1-1.relay.n0.iroh.link.",
    code: "ABC-DEF",
  };

  /** Opens the not-paired pane and waits for its question about the link. */
  async function openPane(onClose: () => void = () => {}): Promise<void> {
    render(<RemoteHostModal onClose={onClose} />);
    await screen.findByLabelText("Host URL");
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("kleio_link_status"));
    await act(async () => {});
  }

  function paste(text: string): void {
    fireEvent.change(screen.getByLabelText(/Pairing ticket/), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Use ticket" }));
  }

  it("without the link, the form is today's: no ticket field", async () => {
    routes({ kleio_remote_status: () => ({ active: null, paired: null }) });
    await openPane();
    expect(screen.queryByLabelText(/Pairing ticket/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Use ticket" })).toBeNull();
  });

  it("with the link, a release build has no ticket field either", async () => {
    routes({
      kleio_remote_status: () => ({ active: null, paired: null }),
      kleio_link_status: () => ({ ...NO_LINK, debugBuild: false }),
    });
    await openPane();
    expect(screen.queryByLabelText(/Pairing ticket/)).toBeNull();
  });

  it("a pasted v2 ticket fills today's form, and pairs nothing by itself", async () => {
    routes({
      kleio_remote_status: () => ({ active: null, paired: null }),
      kleio_link_status: () => NO_LINK,
    });
    await openPane();
    paste(
      JSON.stringify({
        v: 2,
        type: "kleio-pair",
        baseUrl: "https://mac-mini-1.example.ts.net:8443",
        code: "ABC-DEF",
      }),
    );
    expect((screen.getByLabelText("Host URL") as HTMLInputElement).value).toBe(
      "https://mac-mini-1.example.ts.net:8443",
    );
    expect((screen.getByLabelText("Pair code") as HTMLInputElement).value).toBe("ABC-DEF");
    expect(invokeMock).not.toHaveBeenCalledWith("kleio_link_check_ticket", expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith("kleio_pair", expect.anything());
  });

  it("text that isn't a ticket says so and fills nothing", async () => {
    routes({
      kleio_remote_status: () => ({ active: null, paired: null }),
      kleio_link_status: () => NO_LINK,
    });
    await openPane();
    paste("https://mac-mini-1.example.ts.net:8443 ABC-DEF");
    expect((await screen.findByRole("alert")).textContent).toBe(NOT_A_TICKET);
    expect((screen.getByLabelText("Host URL") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Pair code") as HTMLInputElement).value).toBe("");
  });

  it("a pasted link ticket shows the host to confirm, then pairs over the link", async () => {
    let paired = false;
    routes({
      kleio_remote_status: () => ({ active: null, paired: paired ? LINK_REC : null }),
      kleio_link_status: () => ({ ...NO_LINK, paired }),
      kleio_link_check_ticket: (args) => {
        expect(args).toEqual({ ticket: TICKET });
        return CHECKED;
      },
      kleio_link_pair: (args) => {
        expect(args).toEqual({ ticket: TICKET, label: "Laptop" });
        paired = true;
        return LINK_REC;
      },
    });
    await openPane();
    paste(TICKET);
    await screen.findByText("ab12cd34ef…");
    expect(screen.getByText("mac-mini-1")).toBeTruthy();
    expect(screen.getByText("euc1-1.relay.n0.iroh.link.")).toBeTruthy();
    expect(screen.getByText("ABC-DEF")).toBeTruthy();
    // Nothing pairs until Pair is pressed, and the safe choice has focus.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back" }));
    expect(invokeMock).not.toHaveBeenCalledWith("kleio_link_pair", expect.anything());
    fireEvent.change(screen.getByLabelText("This device's name"), { target: { value: "Laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    // On a computer it applies at the next launch, as a Tailscale pairing does.
    expect((await screen.findByRole("status")).textContent).toMatch(/Restart Kleio to apply/);
    // kleio_link_pair switches the pairing on itself.
    expect(invokeMock).not.toHaveBeenCalledWith("kleio_activate_pairing");
    expect(invokeMock).not.toHaveBeenCalledWith("kleio_pair", expect.anything());
  });

  it("on the iPhone, a link pairing that switches on in place closes into the app", async () => {
    let paired = false;
    routes({
      kleio_remote_status: () => ({ active: null, paired: paired ? LINK_REC : null }),
      kleio_link_status: () => ({ ...NO_LINK, paired, active: paired }),
      kleio_link_check_ticket: () => CHECKED,
      kleio_link_pair: () => {
        paired = true;
        return LINK_REC;
      },
    });
    const onClose = vi.fn();
    await openPane(onClose);
    paste(TICKET);
    fireEvent.click(await screen.findByRole("button", { name: "Pair" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("a link ticket the link refuses shows why and stays on the form", async () => {
    routes({
      kleio_remote_status: () => ({ active: null, paired: null }),
      kleio_link_status: () => NO_LINK,
      kleio_link_check_ticket: () => {
        throw new Error("This QR code's relay address isn't valid.");
      },
    });
    await openPane();
    paste(TICKET);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "This QR code's relay address isn't valid.",
    );
    expect(screen.getByLabelText("Host URL")).toBeTruthy();
  });

  describe("on the iPhone, Scan QR code", () => {
    beforeEach(() => {
      document.documentElement.classList.add("platform-ios");
      vi.mocked(scanner.checkPermissions).mockResolvedValue("granted");
      vi.mocked(scanner.requestPermissions).mockResolvedValue("granted");
    });
    afterEach(() => {
      document.documentElement.classList.remove("platform-ios", "kleio-scanning");
      vi.mocked(scanner.scan).mockReset();
    });

    it("isn't there without the link", async () => {
      routes({ kleio_remote_status: () => ({ active: null, paired: null }) });
      await openPane();
      expect(screen.queryByRole("button", { name: "Scan QR code" })).toBeNull();
    });

    it("isn't there on a computer", async () => {
      document.documentElement.classList.remove("platform-ios");
      routes({
        kleio_remote_status: () => ({ active: null, paired: null }),
        kleio_link_status: () => NO_LINK,
      });
      await openPane();
      expect(screen.queryByRole("button", { name: "Scan QR code" })).toBeNull();
    });

    it("scans QR codes only, then a link ticket goes to the confirm step", async () => {
      vi.mocked(scanner.scan).mockResolvedValue({
        content: TICKET,
        format: "QR_CODE" as scanner.Format,
        bounds: null,
      });
      routes({
        kleio_remote_status: () => ({ active: null, paired: null }),
        kleio_link_status: () => ({ ...NO_LINK, debugBuild: false }),
        kleio_link_check_ticket: (args) => {
          expect(args).toEqual({ ticket: TICKET });
          return CHECKED;
        },
      });
      await openPane();
      fireEvent.click(screen.getByRole("button", { name: "Scan QR code" }));
      await screen.findByText("ab12cd34ef…");
      expect(scanner.scan).toHaveBeenCalledWith({ formats: ["QR_CODE"], windowed: true });
      // A scan only reads the code: nothing pairs until Pair is pressed.
      expect(invokeMock).not.toHaveBeenCalledWith("kleio_link_pair", expect.anything());
      expect(document.documentElement.classList.contains("kleio-scanning")).toBe(false);
    });

    it("a scanned v2 ticket fills the form", async () => {
      vi.mocked(scanner.scan).mockResolvedValue({
        content: JSON.stringify({
          v: 2,
          type: "kleio-pair",
          baseUrl: "https://mac-mini-1.example.ts.net:8443",
          code: "ABC-DEF",
        }),
        format: "QR_CODE" as scanner.Format,
        bounds: null,
      });
      routes({
        kleio_remote_status: () => ({ active: null, paired: null }),
        kleio_link_status: () => NO_LINK,
      });
      await openPane();
      fireEvent.click(screen.getByRole("button", { name: "Scan QR code" }));
      await waitFor(() =>
        expect((screen.getByLabelText("Pair code") as HTMLInputElement).value).toBe("ABC-DEF"),
      );
      expect((screen.getByLabelText("Host URL") as HTMLInputElement).value).toBe(
        "https://mac-mini-1.example.ts.net:8443",
      );
    });

    it("a QR code that isn't a ticket says so and fills nothing", async () => {
      vi.mocked(scanner.scan).mockResolvedValue({
        content: "WIFI:S:home;T:WPA;P:secret;;",
        format: "QR_CODE" as scanner.Format,
        bounds: null,
      });
      routes({
        kleio_remote_status: () => ({ active: null, paired: null }),
        kleio_link_status: () => NO_LINK,
      });
      await openPane();
      fireEvent.click(screen.getByRole("button", { name: "Scan QR code" }));
      expect((await screen.findByRole("alert")).textContent).toBe(NOT_A_TICKET);
      expect((screen.getByLabelText("Host URL") as HTMLInputElement).value).toBe("");
    });

    it("camera denied: says how to turn it on, scans nothing, keeps the form", async () => {
      vi.mocked(scanner.checkPermissions).mockResolvedValue("prompt");
      vi.mocked(scanner.requestPermissions).mockResolvedValue("denied");
      routes({
        kleio_remote_status: () => ({ active: null, paired: null }),
        kleio_link_status: () => NO_LINK,
      });
      await openPane();
      fireEvent.click(screen.getByRole("button", { name: "Scan QR code" }));
      expect((await screen.findByRole("alert")).textContent).toMatch(
        /turn on Camera for Kleio in Settings, or type the details instead/,
      );
      expect(scanner.requestPermissions).toHaveBeenCalledOnce();
      expect(scanner.scan).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Host URL")).toBeTruthy();
    });

    it("Cancel closes the camera and leaves the form as it was", async () => {
      let reject: (e: unknown) => void = () => {};
      vi.mocked(scanner.scan).mockImplementation(
        () =>
          new Promise((_, no) => {
            reject = no;
          }),
      );
      vi.mocked(scanner.cancel).mockImplementation(async () => reject("cancelled"));
      routes({
        kleio_remote_status: () => ({ active: null, paired: null }),
        kleio_link_status: () => NO_LINK,
      });
      await openPane();
      fireEvent.click(screen.getByRole("button", { name: "Scan QR code" }));
      const overlay = await screen.findByRole("dialog", { name: "Scan QR code" });
      expect(document.documentElement.classList.contains("kleio-scanning")).toBe(true);
      fireEvent.click(within(overlay).getByRole("button", { name: "Cancel" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Scan QR code" })).toBeNull(),
      );
      expect(document.documentElement.classList.contains("kleio-scanning")).toBe(false);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("button", { name: "Scan QR code" })).toBeTruthy();
    });
  });

  it("the host turning the code away shows on the confirm step, and Back returns", async () => {
    routes({
      kleio_remote_status: () => ({ active: null, paired: null }),
      kleio_link_status: () => NO_LINK,
      kleio_link_check_ticket: () => CHECKED,
      kleio_link_pair: () => {
        throw new Error("Code not recognised, or it expired. Mint a fresh one on the host.");
      },
    });
    await openPane();
    paste(TICKET);
    fireEvent.click(await screen.findByRole("button", { name: "Pair" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Code not recognised/);
    expect((screen.getByRole("button", { name: "Pair" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Host URL")).toBeTruthy();
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
    {
      deviceId: "dev-old",
      label: "Old laptop",
      createdAt: "2026-09-20T10:00:00Z",
      lastSeen: "2026-09-20T11:00:00Z",
      revoked: true,
      admin: false,
    },
  ];

  it("lists live devices, cannot remove itself, removes another after confirm, mints a code", async () => {
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
        // Epoch ms, as the host sends it (Rust passes it through as a u64).
        return {
          display: "QRS-TUV",
          expiresAt: Date.now() + 5 * 60_000,
          admin: true,
        };
      },
    });
    render(<RemoteHostModal onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Devices" }));
    await screen.findByText("Phone");
    // Removed devices and raw device ids stay out of the list.
    expect(screen.queryByText("Old laptop")).toBeNull();
    expect(screen.queryByText("dev-phone")).toBeNull();
    // Plain-words activity: last seen, or when it paired if never seen.
    expect(screen.getByText(/^Active \d/)).toBeDefined();
    expect(screen.getByText(/^Paired \d/)).toBeDefined();
    // This Mac can't remove itself: its row has no buttons at all.
    const selfRow = screen.getByText("Laptop").closest("li");
    expect(selfRow).not.toBeNull();
    expect(selfRow?.querySelector("button")).toBeNull();
    // Another device: confirm first, with focus on the safe choice.
    fireEvent.click(screen.getByRole("button", { name: "Remove Phone" }));
    expect(invokeMock).not.toHaveBeenCalledWith("kleio_revoke", expect.anything());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await screen.findByText("Phone removed.");
    expect(invokeMock).toHaveBeenCalledWith("kleio_revoke", { deviceId: "dev-phone" });
    expect(screen.queryByText("Phone")).toBeNull();
    // Its button went with the row; focus comes back to the dialog. The modal
    // restores it in an effect, which a busy CI machine can run a beat after
    // the message shows, so wait for it rather than assume it already ran.
    await waitFor(() =>
      expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true),
    );
    // Mint an admin code.
    fireEvent.click(screen.getByLabelText("Make the new device an admin"));
    fireEvent.click(screen.getByRole("button", { name: "New pair code" }));
    await screen.findByText("QRS-TUV");
    expect(screen.getByText(/expires in 5 min/)).toBeDefined();
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
