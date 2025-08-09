import * as vscode from "vscode"
import { RemoteGrpcServer } from "./grpc-server"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { WebviewProvider } from "@/core/webview"
import * as fs from "fs/promises"
import * as path from "path"

export class RemoteServerManager {
	private server: RemoteGrpcServer | null = null
	private grpcWebProxyProcess: any = null
	private serverPort = 9090 // gRPC server port
	private proxyPort = 8080 // grpcwebproxy port

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

			// Start grpcwebproxy
			await this.startGrpcWebProxy()

			// Write port configuration for frontend
			await this.writePortConfiguration()

			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: `Remote server started! Access UI at http://localhost:3001 (gRPC: ${this.serverPort}, Proxy: ${this.proxyPort})`,
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

			// Stop grpcwebproxy
			if (this.grpcWebProxyProcess) {
				this.grpcWebProxyProcess.kill()
				this.grpcWebProxyProcess = null
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

	private async startGrpcWebProxy(): Promise<void> {
		const { spawn } = require("child_process")

		// Try to find grpcwebproxy binary
		let proxyPath = "grpcwebproxy" // Try system PATH first

		// Also check common locations
		const possiblePaths = [
			"grpcwebproxy",
			"/Users/work/go/bin/grpcwebproxy",
			path.join(process.env.GOPATH || "/Users/work/go", "bin", "grpcwebproxy"),
			path.join(this.context.extensionPath, "bin", "grpcwebproxy"),
		]

		let foundPath = null
		for (const testPath of possiblePaths) {
			try {
				if (testPath === "grpcwebproxy") {
					// Test if it's in PATH by trying to spawn it
					continue // We'll use this as fallback
				} else {
					await fs.access(testPath)
					foundPath = testPath
					break
				}
			} catch {
				// Continue to next path
			}
		}

		proxyPath = foundPath || "grpcwebproxy" // Fallback to PATH

		// Start grpcwebproxy
		this.grpcWebProxyProcess = spawn(proxyPath, [
			`--backend_addr=localhost:${this.serverPort}`,
			`--run_tls_server=false`,
			`--run_http_server=true`,
			`--allow_all_origins`,
			`--server_bind_address=0.0.0.0`,
			`--server_http_debug_port=${this.proxyPort}`,
		])

		this.grpcWebProxyProcess.stdout?.on("data", (data: Buffer) => {
			console.log(`[grpcwebproxy] ${data.toString()}`)
		})

		this.grpcWebProxyProcess.stderr?.on("data", (data: Buffer) => {
			console.error(`[grpcwebproxy] ${data.toString()}`)
		})

		this.grpcWebProxyProcess.on("error", (error: Error) => {
			console.error("[grpcwebproxy] Process error:", error)
		})

		// Give it a moment to start
		await new Promise((resolve) => setTimeout(resolve, 1000))
	}

	private async writePortConfiguration(): Promise<void> {
		// Write .grpc-port file for the frontend to discover
		const portFilePath = path.join(this.context.extensionPath, "webview-ui", ".grpc-port")
		await fs.writeFile(portFilePath, this.proxyPort.toString())

		// Also write a .ports.json for more detailed config
		const portsConfigPath = path.join(this.context.extensionPath, "webview-ui", ".ports.json")
		const portsConfig = {
			grpcWebProxyPort: this.proxyPort,
			grpcServerPort: this.serverPort,
			frontendPort: 3001,
		}
		await fs.writeFile(portsConfigPath, JSON.stringify(portsConfig, null, 2))

		console.log(`[RemoteServerManager] Wrote port configuration to ${portFilePath} and ${portsConfigPath}`)
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
