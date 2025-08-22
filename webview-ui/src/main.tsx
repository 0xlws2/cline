import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App.tsx"
// Load Codicons using the package import so fonts resolve correctly in dev and build
import "@vscode/codicons/dist/codicon.css"
// Provide non-invasive VS Code CSS variable fallbacks for standalone/dev
import "./vscode-theme-fallback.css"

// Add a marker class when not running inside VS Code so fallbacks apply only in dev/standalone
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isVSCode = typeof (globalThis as any).acquireVsCodeApi === "function"
if (!isVSCode) {
	document.documentElement.classList.add("standalone")
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
)
