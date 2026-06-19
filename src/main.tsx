import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

declare global {
  interface Window {
    __applyPwaUpdate__?: () => Promise<void>;
    __hasPendingPwaUpdate__?: boolean;
  }
}

if (import.meta.env.PROD && import.meta.env.MODE !== "android") {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.__hasPendingPwaUpdate__ = true;
      window.__applyPwaUpdate__ = async () => {
        await updateSW(true);
      };
      window.dispatchEvent(new Event("pwa-update-ready"));
    },
  });
}

createRoot(document.getElementById("root")!).render(<App />);
