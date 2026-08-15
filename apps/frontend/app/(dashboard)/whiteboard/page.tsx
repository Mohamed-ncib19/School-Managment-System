import type { Metadata } from "next";
import dynamic from "next/dynamic";

// Excalidraw is huge (~8s to compile, several MB of chunks). It lives in this
// route only — never in the dashboard shell — so the rest of the app's dev
// compiles and page loads stay fast. `ssr: false` because Excalidraw needs a
// DOM and the editor's draft recovery touches sessionStorage.
const WhiteboardWorkspace = dynamic(
  () => import("@/components/whiteboard/whiteboard-workspace"),
  { ssr: false },
);

export const metadata: Metadata = {
  title: "Notes / Tableau blanc",
};

export default function WhiteboardPage() {
  return <WhiteboardWorkspace />;
}