// Runs a fixed program, the way the host's read-only checks (always-on.ts)
// and its Windows ACL calls (acl.ts) need: by absolute path, with an argument
// array, never through a shell, with no console window, a timeout and a cap
// on output. A program that ran and exited, with any code, is a value; one
// that couldn't start, hung or said too much is a failure. A failure's message
// is in our own words: the program's output goes to the log, never into it.

import { execFile } from "node:child_process";
import { win32 } from "node:path";
import { err, ok, type Result } from "./result.js";

/** Exactly what goes to execFile (tests check it). */
export interface RunFileOptions {
  readonly encoding: "utf8";
  readonly shell: false;
  readonly windowsHide: true;
  readonly timeout: number;
  readonly maxBuffer: number;
}

export interface RunOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type RunFailureKind = "spawn_failed" | "timeout" | "too_much_output" | "killed";

export interface RunFailure {
  readonly kind: RunFailureKind;
  readonly message: string;
}

export type RunFile = (
  file: string,
  args: readonly string[],
  options: RunFileOptions,
  /** What the program reads on stdin, if anything. */
  input?: string,
) => Promise<Result<RunOutput, RunFailure>>;

export function runOptions(timeoutMs: number, maxBuffer: number): RunFileOptions {
  return { encoding: "utf8", shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer };
}

export const runFile: RunFile = (file, args, options, input) =>
  new Promise((resolve) => {
    const child = execFile(file, [...args], { ...options }, (error, stdout, stderr) => {
      if (!error) return resolve(ok({ exitCode: 0, stdout, stderr }));
      const code = error.code;
      if (typeof code === "number") return resolve(ok({ exitCode: code, stdout, stderr }));
      if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        return resolve(
          err({
            kind: "too_much_output",
            message: `more than ${options.maxBuffer} bytes of output`,
          }),
        );
      }
      if (error.killed) {
        return resolve(err({ kind: "timeout", message: `no answer within ${options.timeout} ms` }));
      }
      if (error.signal) {
        return resolve(err({ kind: "killed", message: `ended by ${error.signal}` }));
      }
      resolve(
        err({
          kind: "spawn_failed",
          message: `could not start (${typeof code === "string" ? code : "unknown error"})`,
        }),
      );
    });
    if (input !== undefined) {
      // A program that exits without reading it closes the pipe: not an error here.
      child.stdin?.on("error", () => {});
      child.stdin?.end(input);
    }
  });

/** A program's output for the host log: JSON-escaped, so one line, and its first 2 KB at most. */
export function logText(text: string): string {
  return JSON.stringify([...text].slice(0, 2048).join(""));
}

/** One log line for a program that ran: its file, args, exit code and output. */
export function ranLine(
  scope: string,
  file: string,
  args: readonly string[],
  out: RunOutput,
): string {
  return `${scope} ${file} ${JSON.stringify(args)} exit ${out.exitCode} stdout ${logText(out.stdout)} stderr ${logText(out.stderr)}`;
}

/** Windows' own programs, from %SystemRoot% only when it is a plain drive path. */
export function windowsSystem32(env: Readonly<Record<string, string | undefined>>): string {
  const root = env.SystemRoot;
  const base = root && /^[A-Za-z]:\\[^"<>|?*\r\n]*$/.test(root) ? root : "C:\\Windows";
  return win32.join(base, "System32");
}
