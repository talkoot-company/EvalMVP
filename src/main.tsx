import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const forceFavicon = () => {
  const href = `/favicon.png?v=4-${Date.now()}`;
  for (const rel of ["icon", "shortcut icon"]) {
    let link = document.querySelector<HTMLLinkElement>(`link[rel='${rel}']`);
    if (!link) {
      link = document.createElement("link");
      link.rel = rel;
      document.head.appendChild(link);
    }
    link.type = "image/png";
    link.href = href;
  }
};

forceFavicon();

createRoot(document.getElementById("root")!).render(<App />);
