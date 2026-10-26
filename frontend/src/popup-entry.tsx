/**
 * CLAVIS — popup entry (desktop).
 *
 * Mount point for the pre-created popup window (§3.1): fonts, global CSS
 * and the PopupRoot component, which owns the load/retry lifecycle and the
 * palette itself.
 */
import { createRoot } from "react-dom/client";
import { PopupRoot } from "@/components/clavis/popup-root";

import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono";
import "@/globals.css";

createRoot(document.getElementById("root")!).render(<PopupRoot />);
