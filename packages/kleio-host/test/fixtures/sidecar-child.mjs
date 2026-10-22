// A stand-in sidecar for sidecar.test.ts. It says whether it still sees the
// IPC-stop marker (the preloaded shim deletes it), prints the handshake, and
// waits. On SIGTERM it writes "term" to $KLEIO_TEST_MARKER and exits 0, the
// way the real sidecar's teardown ends; with KLEIO_TEST_IGNORE_TERM=1 it
// writes the marker and keeps running, like a teardown that hangs.
import { writeFileSync } from "node:fs";

const marker = process.env.KLEIO_TEST_MARKER;
process.on("SIGTERM", () => {
  if (marker) writeFileSync(marker, "term");
  if (process.env.KLEIO_TEST_IGNORE_TERM !== "1") process.exit(0);
});
setInterval(() => {}, 1000);
console.log(`ipc-stop-env ${process.env.KLEIO_SIDECAR_IPC_STOP ?? "unset"}`);
console.log(`GG_APP_LISTENING 4321 ${process.env.GG_APP_TOKEN}`);
