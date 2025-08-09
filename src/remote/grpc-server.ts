import * as grpc from "@grpc/grpc-js"
import { Logger } from "../services/logging/Logger"
import { Controller } from "../core/controller"
import { addProtobusServices } from "@/generated/hosts/standalone/protobus-server-setup"
import { GrpcHandlerWrapper, GrpcStreamingResponseHandlerWrapper } from "@/hosts/external/grpc-types"
import * as vscode from "vscode"

export interface RemoteServerConfig {
	port: number
	controller: Controller
	context: vscode.ExtensionContext
}

/**
 * Remote gRPC server that provides Cline services independently
 * Enables standalone frontend clients to connect via gRPC
 */
export class RemoteGrpcServer {
	private server: grpc.Server | null = null
	private controller: Controller
	private context: vscode.ExtensionContext
	private port: number

	constructor(config: RemoteServerConfig) {
		this.controller = config.controller
		this.context = config.context
		this.port = config.port
	}

	/**
	 * Create and configure the gRPC server with all Cline services
	 */
	private createServer(): grpc.Server {
		const server = new grpc.Server()

		// Use the generated setup function to add all services
		addProtobusServices(server, this.controller, this.createWrapper(), this.createStreamingWrapper())

		return server
	}

	/**
	 * Wrapper function that converts Promise-based handlers to gRPC callback-style handlers
	 */
	private createWrapper(): GrpcHandlerWrapper {
		return <TRequest, TResponse>(
			handler: (controller: Controller, req: TRequest) => Promise<TResponse>,
			controller: Controller,
		): grpc.handleUnaryCall<TRequest, TResponse> => {
			return async (call: grpc.ServerUnaryCall<TRequest, TResponse>, callback: grpc.sendUnaryData<TResponse>) => {
				try {
					const result = await handler(controller, call.request)
					callback(null, result)
				} catch (error) {
					Logger.error("gRPC handler error:", error)
					callback(error as grpc.ServiceError)
				}
			}
		}
	}

	/**
	 * Wrapper function for streaming response handlers
	 */
	private createStreamingWrapper(): GrpcStreamingResponseHandlerWrapper {
		return <TRequest, TResponse>(
			handler: (
				controller: Controller,
				req: TRequest,
				streamWriter: (response: TResponse, isLast?: boolean, sequenceNumber?: number) => Promise<void>,
				requestId?: string,
			) => Promise<void>,
			controller: Controller,
		): grpc.handleServerStreamingCall<TRequest, TResponse> => {
			return async (call: grpc.ServerWritableStream<TRequest, TResponse>) => {
				try {
					const streamWriter = async (response: TResponse, isLast?: boolean, sequenceNumber?: number) => {
						call.write(response)
						if (isLast) {
							call.end()
						}
					}

					await handler(controller, call.request, streamWriter)
				} catch (error) {
					Logger.error("gRPC streaming handler error:", error)
					call.destroy(error as grpc.ServiceError)
				}
			}
		}
	}

	/**
	 * Start the gRPC server
	 */
	async start(): Promise<void> {
		if (this.server) {
			throw new Error("Server is already running")
		}

		this.server = this.createServer()

		return new Promise((resolve, reject) => {
			this.server!.bindAsync(`0.0.0.0:${this.port}`, grpc.ServerCredentials.createInsecure(), (error, port) => {
				if (error) {
					Logger.error("Failed to start gRPC server:", error)
					reject(error)
					return
				}

				this.server!.start()
				Logger.log(`Remote gRPC server started on port ${port}`)
				resolve()
			})
		})
	}

	/**
	 * Stop the gRPC server
	 */
	async stop(): Promise<void> {
		if (!this.server) {
			return
		}

		return new Promise((resolve) => {
			this.server!.tryShutdown((error) => {
				if (error) {
					Logger.error("Error stopping gRPC server:", error)
					this.server!.forceShutdown()
				} else {
					Logger.log("Remote gRPC server stopped")
				}

				this.server = null
				resolve()
			})
		})
	}

	/**
	 * Check if the server is running
	 */
	isRunning(): boolean {
		return this.server !== null
	}

	/**
	 * Get the server port
	 */
	getPort(): number {
		return this.port
	}

	/**
	 * Get server status information
	 */
	getStatus() {
		return {
			running: this.isRunning(),
			port: this.port,
			address: `0.0.0.0:${this.port}`,
		}
	}
}
