/**
 * Environment detection and configuration for remote vs VSCode mode
 */

// Type declarations for window extensions
declare global {
	interface Window {
		clineClientId?: string
		__is_standalone__?: boolean
		__remote_websocket__?: WebSocket
		standalonePostMessage?: (message: string) => void
	}
}

// Detect if we're running in standalone/remote mode
export const isRemoteMode = (() => {
	// Check if we're in a browser (not VSCode webview)
	const isInBrowser = typeof window !== "undefined" && !window.location.href.includes("vscode-webview:")

	// Check if we're explicitly marked as standalone
	const isStandaloneMarked = typeof window !== "undefined" && window.__is_standalone__

	// Check if we're on localhost (likely remote server)
	const isLocalhost =
		typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")

	return isInBrowser && (isStandaloneMarked || isLocalhost)
})()

// Port configuration for remote bridge
export const getPortConfig = () => {
	return {
		// Only the WebSocket bridge port is relevant in remote mode
		wsPort: 8081,
	}
}

// gRPC endpoint configuration (unused in current remote mode)
export const getGrpcEndpoint = () => {
	// We route all traffic through the WebSocket bridge, so there is no direct gRPC-Web endpoint.
	return null
}

// WebSocket endpoint for remote communication
export const getWebSocketEndpoint = () => {
	if (!isRemoteMode) {
		return null
	}

	const config = getPortConfig()
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
	const host = window.location.hostname
	return `${protocol}//${host}:${config.wsPort || 8081}`
}

// Connection state management
let wsConnectionReady = false
let wsConnectionPromise: Promise<void> | null = null

export const waitForWebSocketConnection = (): Promise<void> => {
	// If already connected, resolve immediately
	if (wsConnectionReady) {
		return Promise.resolve()
	}

	// If a connection attempt is in-flight, await it
	if (wsConnectionPromise) {
		return wsConnectionPromise
	}

	// Lazily kick off initialization in remote mode and return its promise
	if (isRemoteMode) {
		wsConnectionPromise = initializeRemoteMode()
			.then(() => {
				return
			})
			.catch((err) => {
				// Propagate the error but allow future retries
				throw err
			})
		return wsConnectionPromise
	}

	// Not in remote mode; no WebSocket is expected
	return Promise.reject(new Error("WebSocket not available in VSCode mode"))
}

// Initialize remote mode if needed
export const initializeRemoteMode = async () => {
	if (!isRemoteMode) {
		return
	}

	// Prevent multiple initialization attempts
	if (wsConnectionPromise) {
		return wsConnectionPromise
	}

	console.log("🚀 Initializing Cline Remote Mode")

	// Set standalone flag
	window.__is_standalone__ = true

	// Set client ID for remote mode
	if (!window.clineClientId) {
		window.clineClientId = "remote-client-" + Math.random().toString(36).substr(2, 9)
		console.log("Generated client ID for remote mode:", window.clineClientId)
	}

	// Setup WebSocket connection for communication
	const wsEndpoint = getWebSocketEndpoint()
	if (!wsEndpoint) {
		console.warn("⚠️ No WebSocket endpoint available")
		return Promise.reject(new Error("No WebSocket endpoint"))
	}

	wsConnectionPromise = new Promise((resolve, reject) => {
		try {
			const ws = new WebSocket(wsEndpoint)

			// Set up timeout for connection
			const connectionTimeout = setTimeout(() => {
				if (ws.readyState === WebSocket.CONNECTING) {
					console.warn("⏰ WebSocket connection timeout")
					ws.close()
					wsConnectionReady = false
					wsConnectionPromise = null
					reject(new Error("Connection timeout"))
				}
			}, 5000)

			ws.onopen = () => {
				clearTimeout(connectionTimeout)
				console.log("✅ Connected to remote server via WebSocket")
				window.__remote_websocket__ = ws
				wsConnectionReady = true
				resolve()
			}

			ws.onerror = (error) => {
				clearTimeout(connectionTimeout)
				console.warn("⚠️ WebSocket connection error - will retry")
				wsConnectionReady = false
				wsConnectionPromise = null
				reject(error)
			}

			ws.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data)
					// Dispatch as window message to maintain compatibility
					window.dispatchEvent(new MessageEvent("message", { data }))
				} catch (error) {
					console.error("❌ WebSocket message parse error:", error)
				}
			}

			ws.onclose = () => {
				console.log("🔌 Disconnected from remote server")
				window.__remote_websocket__ = undefined
				wsConnectionReady = false
				wsConnectionPromise = null

				// Try to reconnect after delay
				setTimeout(() => {
					console.log("🔄 Attempting to reconnect...")
					initializeRemoteMode()
				}, 3000)
			}

			// Setup postMessage handler for remote mode
			window.standalonePostMessage = (message) => {
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(message)
				} else {
					console.warn("⚠️ WebSocket not connected, cannot send message")
				}
			}
		} catch (error) {
			console.error("❌ Failed to create WebSocket:", error)
			wsConnectionPromise = null
			reject(error)
		}
	})

	return wsConnectionPromise
}

export default {
	isRemoteMode,
	getPortConfig,
	getGrpcEndpoint,
	getWebSocketEndpoint,
	initializeRemoteMode,
}
