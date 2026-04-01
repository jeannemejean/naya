import { Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@/lib/i18n";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <Suspense fallback={<div />}>
    <App />
  </Suspense>
);
