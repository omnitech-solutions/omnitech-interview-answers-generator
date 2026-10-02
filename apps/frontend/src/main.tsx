import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@omnitech-assistant/react/styles.css";
import "../../web/app/styles.css";
import "@omnitech/product-interview/studio.css";
import { App } from "./app.js";

createRoot(document.getElementById("root")!).render(<App />);
