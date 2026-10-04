// The cards under a Chat or Code reply for the outputs it links to (see
// WorkspaceFiles.tsx). Loaded the first time a paired transcript shows a
// reply, so the cards and their file-type icons stay out of the initial chunk.

import { useMemo } from "react";
import { FileCards } from "./FileCard";
import { workspaceFileLinks, type FileOwner } from "./kleioFiles";

export function WorkspaceOutputCards({
  owner,
  text,
}: {
  owner: Extract<FileOwner, { kind: "workspace" }>;
  text: string;
}): React.ReactElement | null {
  const links = useMemo(() => workspaceFileLinks(text, owner.cwd), [owner.cwd, text]);
  return <FileCards owner={owner} links={links} />;
}
