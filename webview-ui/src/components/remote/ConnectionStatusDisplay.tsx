import { useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import ClineLogoDisconnected from "../../assets/ClineLogoDisconnected"
import { isRemoteMode } from "../../utils/environment"

interface ConnectionStatus {
	webSocket: "connected" | "connecting" | "failed"
	grpcBackend: "connected" | "connecting" | "failed"
}

export const ConnectionStatusDisplay = () => {
	const { didHydrateState } = useExtensionState()
	const [status, setStatus] = useState<ConnectionStatus>({
		webSocket: "connecting",
		grpcBackend: "connecting",
	})

	useEffect(() => {
		if (!isRemoteMode) return

		let mounted = true
		const interval = setInterval(() => {
			if (!mounted) return

			// Check WebSocket connection directly
			const ws = (window as any).__remote_websocket__
			if (ws && ws.readyState === WebSocket.OPEN) {
				setStatus((prev) => ({ ...prev, webSocket: "connected" }))
			} else {
				setStatus((prev) => ({ ...prev, webSocket: "connecting" }))
			}

			// Backend is considered connected only when app state hydrates
			setStatus((prev) => ({ ...prev, grpcBackend: didHydrateState ? "connected" : "connecting" }))
		}, 1000)

		return () => {
			mounted = false
			clearInterval(interval)
		}
	}, [didHydrateState])

	if (!isRemoteMode) return null

	const StatusIcon = ({ status: itemStatus }: { status: "connected" | "connecting" | "failed" }) => {
		switch (itemStatus) {
			case "connected":
				return <span className="text-green-400">✓</span>
			case "connecting":
				return <span className="text-yellow-400 animate-pulse">●</span>
			case "failed":
				return <span className="text-red-400">✗</span>
		}
	}

	const isFullyConnected = status.webSocket === "connected" && status.grpcBackend === "connected"

	return (
		<div className="flex h-screen w-full items-center justify-center bg-vscode-editor-background/95 backdrop-blur-sm">
			<div className="max-w-2xl w-full mx-6">
				{/* Logo and Header */}
				<div className="text-center mb-8">
					<div className="mb-6 flex justify-center">
						<ClineLogoDisconnected className="w-20 h-20 text-vscode-foreground/40" />
					</div>

					<h1 className="text-3xl font-semibold text-vscode-foreground mb-4">
						{isFullyConnected ? (
							"Connected to Cline"
						) : (
							<span className="flex items-center justify-center gap-1">
								Connecting to Cline
								<span className="loading-dots ml-1">
									<span>.</span>
									<span>.</span>
									<span>.</span>
								</span>
							</span>
						)}
					</h1>
					{isFullyConnected && <p className="text-vscode-descriptionForeground text-lg">All systems operational</p>}
				</div>

				{/* Connection Status Card */}
				<div className="bg-vscode-editor-inactiveSelectionBackground/80 backdrop-blur-sm rounded-lg shadow-lg p-6 mb-8 border border-vscode-panel-border">
					<h3 className="text-lg font-medium text-vscode-foreground mb-6">Connection Status</h3>

					<div className="space-y-4">
						<div className="flex items-center justify-between py-3 px-4 rounded-md bg-vscode-editor-background/50">
							<div className="flex flex-col">
								<span className="text-vscode-foreground font-medium">WebSocket Bridge</span>
								<span className="text-sm text-vscode-descriptionForeground">Real-time communication layer</span>
							</div>
							<div className="flex items-center gap-3">
								<StatusIcon status={status.webSocket} />
								<span className="text-sm text-vscode-descriptionForeground min-w-[120px] text-right">
									{status.webSocket === "connected" && "localhost:8081"}
									{status.webSocket === "connecting" && "Connecting..."}
									{status.webSocket === "failed" && "Not running"}
								</span>
							</div>
						</div>

						<div className="flex items-center justify-between py-3 px-4 rounded-md bg-vscode-editor-background/50">
							<div className="flex flex-col">
								<span className="text-vscode-foreground font-medium">VSCode Backend</span>
								<span className="text-sm text-vscode-descriptionForeground">Extension communication service</span>
							</div>
							<div className="flex items-center gap-3">
								<StatusIcon status={status.grpcBackend} />
								<span className="text-sm text-vscode-descriptionForeground min-w-[120px] text-right">
									{status.grpcBackend === "connected" && "localhost:9090"}
									{status.grpcBackend === "connecting" && "Connecting..."}
									{status.grpcBackend === "failed" && "Not running"}
								</span>
							</div>
						</div>
					</div>
				</div>

				{/* Setup Instructions */}
				{!isFullyConnected && (
					<div className="bg-vscode-inputValidation-errorBackground/20 backdrop-blur-sm border border-vscode-inputValidation-errorBorder rounded-lg p-6 shadow-lg">
						<div className="flex items-center gap-2 mb-4">
							<span className="text-red-400">⚠</span>
							<h3 className="text-lg font-medium text-vscode-errorForeground">Setup Required</h3>
						</div>

						<div className="space-y-6">
							{status.webSocket !== "connected" && (
								<div>
									<p className="text-vscode-foreground font-medium mb-3">1. Start WebSocket Bridge</p>
									<p className="text-sm text-vscode-descriptionForeground mb-3">
										Run this command in your terminal from the project root:
									</p>
									<div className="bg-vscode-textBlockQuote-background/80 backdrop-blur-sm rounded-md px-4 py-3 border border-vscode-panel-border">
										<code className="text-sm font-mono text-vscode-textPreformat-foreground">
											node webview-ui/websocket-server.js
										</code>
									</div>
								</div>
							)}

							{status.grpcBackend !== "connected" && (
								<div>
									<p className="text-vscode-foreground font-medium mb-3">2. Start VSCode Backend</p>
									<div className="ml-6">
										<p className="text-sm text-vscode-descriptionForeground mb-3">
											In VSCode, open Command Palette (Cmd+Shift+P / Ctrl+Shift+P) and run:
										</p>
										<div className="bg-vscode-textBlockQuote-background/80 backdrop-blur-sm rounded-md px-4 py-3 border border-vscode-panel-border">
											<code className="text-sm font-mono text-vscode-textPreformat-foreground">
												Cline: Start Remote Server
											</code>
										</div>
									</div>
								</div>
							)}
						</div>

						<div className="mt-6 pt-4 border-t border-vscode-panel-border/30">
							<p className="text-sm text-vscode-descriptionForeground">
								Once both services are running, this page will automatically connect and you'll be ready to use
								Cline.
							</p>
						</div>
					</div>
				)}

				{/* Success State */}
				{isFullyConnected && (
					<div className="bg-green-500/10 backdrop-blur-sm border border-green-500/30 rounded-lg p-6 shadow-lg text-center">
						<div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
							<span className="text-2xl text-green-400">✓</span>
						</div>
						<h3 className="text-xl font-semibold text-vscode-foreground mb-2">Ready to Code</h3>
						<p className="text-vscode-descriptionForeground">
							Cline is now connected and ready to assist with your development tasks.
						</p>
					</div>
				)}
			</div>
		</div>
	)
}

export default ConnectionStatusDisplay
