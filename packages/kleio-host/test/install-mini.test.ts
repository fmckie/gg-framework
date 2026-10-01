import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(__dirname, "../scripts/install-mini.sh");
const homes: string[] = [];

/** A fake service-user home with a stand-in cli.js that echoes what it got. */
function fakeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "kleio-install-"));
  homes.push(home);
  mkdirSync(join(home, "kleio-host/dist"), { recursive: true });
  writeFileSync(
    join(home, "kleio-host/dist/cli.js"),
    "console.log(JSON.stringify({ args: process.argv.slice(2), port: process.env.KLEIO_HOST_PORT }));\n",
  );
  return home;
}

function installCli(home: string): string {
  return execFileSync("sh", [script, "cli"], {
    env: { PATH: process.env.PATH ?? "", HOME: home, KLEIO_NODE_BIN: process.execPath },
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("install-mini.sh cli", () => {
  it("installs a kleio-host command that runs cli.js with the jobs' node and port", () => {
    const home = fakeHome();

    installCli(home);
    const out = execFileSync(join(home, ".local/bin/kleio-host"), ["devices", "--x"], {
      env: { PATH: "/usr/bin:/bin", HOME: home },
      encoding: "utf8",
    });

    expect(JSON.parse(out)).toEqual({ args: ["devices", "--x"], port: "8443" });
  });

  it("adds the folder to PATH in ~/.zprofile once, keeping what was there", () => {
    const home = fakeHome();
    writeFileSync(join(home, ".zprofile"), "eval mine\n");

    installCli(home);
    const second = installCli(home);
    const profile = readFileSync(join(home, ".zprofile"), "utf8");

    expect(profile.startsWith("eval mine\n")).toBe(true);
    expect(profile.split(".local/bin:$PATH").length - 1).toBe(1);
    expect(second).not.toContain("added ~/.local/bin");
  });
});
