import { describe, expect, it, vi } from "vitest";
import { routeCliCommandInput, type CliSubcommandName } from "./command-routing.js";

function handlers(calls: string[]): Record<CliSubcommandName, () => void> {
  return {
    pixel: () => calls.push("pixel"),
    mcp: () => calls.push("mcp"),
    login: () => calls.push("login"),
    logout: () => calls.push("logout"),
    sessions: () => calls.push("sessions"),
    telegram: () => calls.push("telegram"),
    serve: () => calls.push("serve"),
    doctor: () => calls.push("doctor"),
    "agent-home-login": () => calls.push("agent-home-login"),
    "agent-home": () => calls.push("agent-home"),
  };
}

describe("routeCliCommandInput", () => {
  it("prints top-level help before dispatching subcommands", () => {
    const argv = ["node", "kleio-coder", "login", "--help"];
    const printHelp = vi.fn();
    const exit = vi.fn((code: number) => {
      throw new Error(`exit:${code}`);
    });

    expect(() => routeCliCommandInput({ argv, printHelp, exit, handlers: handlers([]) })).toThrow(
      "exit:0",
    );
    expect(printHelp).toHaveBeenCalledOnce();
  });

  it("dispatches subcommands and strips command tokens only for modes that parse their own flags", () => {
    const calls: string[] = [];
    const sessionsArgv = ["node", "kleio-coder", "sessions", "--foo"];
    const loginArgv = ["node", "kleio-coder", "login", "--foo"];

    expect(
      routeCliCommandInput({
        argv: sessionsArgv,
        printHelp: vi.fn(),
        exit: vi.fn() as never,
        handlers: handlers(calls),
      }),
    ).toEqual({ kind: "handled", subcommand: "sessions" });
    expect(sessionsArgv).toEqual(["node", "kleio-coder", "--foo"]);

    expect(
      routeCliCommandInput({
        argv: loginArgv,
        printHelp: vi.fn(),
        exit: vi.fn() as never,
        handlers: handlers(calls),
      }),
    ).toEqual({ kind: "handled", subcommand: "login" });
    expect(loginArgv).toEqual(["node", "kleio-coder", "login", "--foo"]);
    expect(calls).toEqual(["sessions", "login"]);
  });

  it("converts continue into a later TUI resume route without handling it as a subcommand", () => {
    const argv = ["node", "kleio-coder", "continue", "--model", "x"];
    const calls: string[] = [];

    expect(
      routeCliCommandInput({
        argv,
        printHelp: vi.fn(),
        exit: vi.fn() as never,
        handlers: handlers(calls),
      }),
    ).toEqual({ kind: "continue" });
    expect(argv).toEqual(["node", "kleio-coder", "--model", "x"]);
    expect(calls).toEqual([]);
  });
});
