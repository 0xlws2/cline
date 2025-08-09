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
	// Mark as standalone for runtime checks and apply styles
	document.documentElement.classList.add("standalone")
	;(window as any).__is_standalone__ = true
	// Provide a simple, stable client ID so existing subscriptions that expect it can run
	// Note: future multi-session routing can replace this with a generated per-session ID
	;(window as any).clineClientId = "standalone"
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
)
