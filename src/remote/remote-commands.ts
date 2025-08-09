import * as vscode from "vscode"
import { RemoteGrpcServer } from "./grpc-server"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { WebviewProvider } from "@/core/webview"

export class RemoteServerManager {
	private server: RemoteGrpcServer | null = null
	private serverPort = 9090 // gRPC server port

	constructor(private context: vscode.ExtensionContext) {}

	async startRemoteServer(): Promise<void> {
		try {
			// Get the active webview provider instance
			const webviewInstance = WebviewProvider.getVisibleInstance()
			if (!webviewInstance) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: "No active Cline instance found. Please open Cline first.",
				})
				return
			}

			// Start the gRPC server
			this.server = new RemoteGrpcServer({
				port: this.serverPort,
				controller: webviewInstance.controller,
				context: this.context,
			})

			await this.server.start()

			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: `Remote server started! gRPC server on port ${this.serverPort}. Start the WebSocket bridge and frontend separately.`,
			})
		} catch (error) {
			console.error("Failed to start remote server:", error)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Failed to start remote server: ${error}`,
			})
		}
	}

	async stopRemoteServer(): Promise<void> {
		try {
			// Stop gRPC server
			if (this.server) {
				await this.server.stop()
				this.server = null
			}

			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "Remote server stopped",
			})
		} catch (error) {
			console.error("Error stopping remote server:", error)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Error stopping remote server: ${error}`,
			})
		}
	}

	isRunning(): boolean {
		return this.server !== null
	}
}

// Export command handlers
export function registerRemoteCommands(context: vscode.ExtensionContext): void {
	const serverManager = new RemoteServerManager(context)

	// Register start command
	const startCommand = vscode.commands.registerCommand("cline.startRemoteServer", async () => {
		if (serverManager.isRunning()) {
			HostProvider.window.showMessage({
				type: ShowMessageType.WARNING,
				message: "Remote server is already running",
			})
			return
		}
		await serverManager.startRemoteServer()
	})

	// Register stop command
	const stopCommand = vscode.commands.registerCommand("cline.stopRemoteServer", async () => {
		if (!serverManager.isRunning()) {
			HostProvider.window.showMessage({
				type: ShowMessageType.WARNING,
				message: "Remote server is not running",
			})
			return
		}
		await serverManager.stopRemoteServer()
	})

	// Register toggle command
	const toggleCommand = vscode.commands.registerCommand("cline.toggleRemoteServer", async () => {
		if (serverManager.isRunning()) {
			await serverManager.stopRemoteServer()
		} else {
			await serverManager.startRemoteServer()
		}
	})

	context.subscriptions.push(startCommand, stopCommand, toggleCommand)

	// Clean up on extension deactivation
	context.subscriptions.push({
		dispose: () => {
			if (serverManager.isRunning()) {
				serverManager.stopRemoteServer()
			}
		},
	})
}
