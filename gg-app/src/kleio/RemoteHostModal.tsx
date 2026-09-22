// Kleio — "Remote host" pane. SPIKE STUB.
//
// Everything Kleio-specific in the webview lives under src/kleio/. App.tsx touches it at
// two lines (a useState + a conditional render) and one hotkey branch. This stub only
// shows whether the app is in remote-host mode; pairing/QR/device management come in
// Step 4. It exists to prove the isolation pattern survives an upstream merge.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "../Modal";

interface RemoteHostModalProps {
  onClose: () => void;
}

export function RemoteHostModal({ onClose }: RemoteHostModalProps): React.ReactElement {
  const [status, setStatus] = useState<string>("checking…");
  useEffect(() => {
    let live = true;
    invoke<{ base: string | null }>("kleio_remote_status")
      .then((s) => live && setStatus(s.base ? `remote → ${s.base}` : "local sidecar"))
      .catch((e) => live && setStatus(`unavailable (${String(e)})`));
    return () => {
      live = false;
    };
  }, []);
  return (
    <Modal title="Kleio — remote host" onClose={onClose}>
      <p style={{ margin: 0, fontFamily: "var(--mono, monospace)", fontSize: 13 }}>{status}</p>
      <p style={{ marginTop: 12, opacity: 0.7, fontSize: 12 }}>
        Spike stub. Set <code>KLEIO_HOST_URL</code> and <code>KLEIO_DEVICE_TOKEN</code> before
        launching to drive a Kleio host over the tailnet.
      </p>
    </Modal>
  );
}
