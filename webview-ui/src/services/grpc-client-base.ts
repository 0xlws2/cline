import { vscode } from "../utils/vscode"
import { v4 as uuidv4 } from "uuid"
import { isRemoteMode, getGrpcEndpoint, waitForWebSocketConnection } from "../utils/environment"

export interface Callbacks<TResponse> {
	onResponse: (response: TResponse) => void
	onError: (error: Error) => void
	onComplete: () => void
}

export abstract class ProtoBusClient {
	static serviceName: string

	static async makeUnaryRequest<TRequest, TResponse>(
		methodName: string,
		request: TRequest,
		encodeRequest: (_: TRequest) => unknown,
		decodeResponse: (_: { [key: string]: any }) => TResponse,
	): Promise<TResponse> {
		// If we're in remote mode, use direct gRPC-Web instead of postMessage
		if (isRemoteMode) {
			return this.makeRemoteUnaryRequest(methodName, request, encodeRequest, decodeResponse)
		}

		return new Promise((resolve, reject) => {
			const requestId = uuidv4()

			// Set up one-time listener for this specific request
			const handleResponse = (event: MessageEvent) => {
				const message = event.data
				if (message.type === "grpc_response" && message.grpc_response?.request_id === requestId) {
					// Remove listener once we get our response
					window.removeEventListener("message", handleResponse)
					if (message.grpc_response.message) {
						const response = this.decode(message.grpc_response.message, decodeResponse)
						resolve(response)
					} else if (message.grpc_response.error) {
						reject(new Error(message.grpc_response.error))
					} else {
						console.error("Received ProtoBus message with no response or error ", JSON.stringify(message))
					}
				}
			}

			window.addEventListener("message", handleResponse)
			// Send the request
			vscode.postMessage({
				type: "grpc_request",
				grpc_request: {
					service: this.serviceName,
					method: methodName,
					message: this.encode(request, encodeRequest),
					request_id: requestId,
					is_streaming: false,
				},
			})
		})
	}

	static makeStreamingRequest<TRequest, TResponse>(
		methodName: string,
		request: TRequest,
		encodeRequest: (_: TRequest) => unknown,
		decodeResponse: (_: { [key: string]: any }) => TResponse,
		callbacks: Callbacks<TResponse>,
	): () => void {
		// If we're in remote mode, use WebSocket/gRPC-Web streaming
		if (isRemoteMode) {
			return this.makeRemoteStreamingRequest(methodName, request, encodeRequest, decodeResponse, callbacks)
		}

		const requestId = uuidv4()
		// Set up listener for streaming responses
		const handleResponse = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "grpc_response" && message.grpc_response?.request_id === requestId) {
				if (message.grpc_response.message) {
					// Process streaming message
					const response = this.decode(message.grpc_response.message, decodeResponse)
					callbacks.onResponse(response)
				} else if (message.grpc_response.error) {
					// Handle error
					if (callbacks.onError) {
						callbacks.onError(new Error(message.grpc_response.error))
					}
					// Only remove the event listener on error
					window.removeEventListener("message", handleResponse)
				} else {
					console.error("Received ProtoBus message with no response or error ", JSON.stringify(message))
				}
				if (message.grpc_response.is_streaming === false) {
					if (callbacks.onComplete) {
						callbacks.onComplete()
					}
					// Only remove the event listener when the stream is explicitly ended
					window.removeEventListener("message", handleResponse)
				}
			}
		}
		window.addEventListener("message", handleResponse)
		// Send the streaming request
		vscode.postMessage({
			type: "grpc_request",
			grpc_request: {
				service: this.serviceName,
				method: methodName,
				message: this.encode(request, encodeRequest),
				request_id: requestId,
				is_streaming: true,
			},
		})
		// Return a function to cancel the stream
		return () => {
			window.removeEventListener("message", handleResponse)
			// Send cancellation message
			vscode.postMessage({
				type: "grpc_request_cancel",
				grpc_request_cancel: {
					request_id: requestId,
				},
			})
			console.log(`[DEBUG] Sent cancellation for request: ${requestId}`)
		}
	}

	// Remote gRPC-Web methods for standalone mode
	static async makeRemoteUnaryRequest<TRequest, TResponse>(
		methodName: string,
		request: TRequest,
		encodeRequest: (_: TRequest) => unknown,
		decodeResponse: (_: { [key: string]: any }) => TResponse,
	): Promise<TResponse> {
		// Use WebSocket for remote unary request (via WebSocket server)
		console.log("Using WebSocket for remote unary request")

		// Wait for WebSocket connection (will lazy-initialize in remote mode)
		await waitForWebSocketConnection()

		const ws = (window as any).__remote_websocket__
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			throw new Error("WebSocket not connected")
		}

		return new Promise((resolve, reject) => {
			const requestId = uuidv4()

			// Set up one-time listener for this specific request
			const handleResponse = (event: MessageEvent) => {
				try {
					const message = event.data
					if (message.type === "grpc_response" && message.grpc_response?.request_id === requestId) {
						// Remove listener once we get our response
						window.removeEventListener("message", handleResponse)
						if (message.grpc_response.message) {
							const response = decodeResponse(message.grpc_response.message)
							resolve(response)
						} else if (message.grpc_response.error) {
							reject(new Error(message.grpc_response.error))
						} else {
							reject(new Error("Received empty gRPC response"))
						}
					}
				} catch (error) {
					console.error("Error parsing WebSocket response:", error)
					reject(error)
				}
			}

			window.addEventListener("message", handleResponse)

			// Send the request via WebSocket
			ws.send(
				JSON.stringify({
					type: "grpc_request",
					grpc_request: {
						service: this.serviceName,
						method: methodName,
						message: encodeRequest(request),
						request_id: requestId,
						is_streaming: false,
					},
				}),
			)

			// Set a timeout to avoid hanging
			setTimeout(() => {
				window.removeEventListener("message", handleResponse)
				reject(new Error("Request timeout"))
			}, 10000)
		})
	}

	static makeRemoteStreamingRequest<TRequest, TResponse>(
		methodName: string,
		request: TRequest,
		encodeRequest: (_: TRequest) => unknown,
		decodeResponse: (_: { [key: string]: any }) => TResponse,
		callbacks: Callbacks<TResponse>,
	): () => void {
		// For streaming requests in remote mode, use WebSocket (silently)
		const requestId = uuidv4()
		let isActive = true

		// Set up listener for streaming responses
		const handleResponse = (event: MessageEvent) => {
			try {
				const message = event.data
				if (message.type === "grpc_response" && message.grpc_response?.request_id === requestId) {
					if (message.grpc_response.message) {
						const response = decodeResponse(message.grpc_response.message)
						callbacks.onResponse(response)
					} else if (message.grpc_response.error) {
						callbacks.onError?.(new Error(message.grpc_response.error))
						window.removeEventListener("message", handleResponse)
					}
					if (message.grpc_response.is_streaming === false) {
						callbacks.onComplete?.()
						window.removeEventListener("message", handleResponse)
					}
				}
			} catch (error) {
				console.error("Error parsing WebSocket message:", error)
			}
		}

		// Wait for WebSocket connection, then send request
		waitForWebSocketConnection()
			.then(() => {
				if (!isActive) return // Request was cancelled

				const ws = (window as any).__remote_websocket__
				if (!ws || ws.readyState !== WebSocket.OPEN) {
					// Silently fail - don't spam errors during connection attempts
					return
				}

				window.addEventListener("message", handleResponse)

				// Send the streaming request via WebSocket
				ws.send(
					JSON.stringify({
						type: "grpc_request",
						grpc_request: {
							service: this.serviceName,
							method: methodName,
							message: encodeRequest(request),
							request_id: requestId,
							is_streaming: true,
						},
					}),
				)
			})
			.catch((error) => {
				// Silently fail during initial connection attempts - will retry when ready
				console.debug("WebSocket not ready for streaming request:", methodName)
			})

		return () => {
			isActive = false
			window.removeEventListener("message", handleResponse)
			const ws = (window as any).__remote_websocket__
			if (ws && ws.readyState === WebSocket.OPEN) {
				ws.send(
					JSON.stringify({
						type: "grpc_request_cancel",
						grpc_request_cancel: {
							request_id: requestId,
						},
					}),
				)
			}
		}
	}

	static encode<T>(message: T, encoder: (_: T) => unknown): any {
		if (window.__is_standalone__) {
			return encoder(message)
		}
		// VScode does not JSON encode ProtoBus messages
		return message
	}

	static decode<T>(message: any, decoder: (_: { [key: string]: any }) => T): T {
		if (window.__is_standalone__) {
			return decoder(message)
		}
		// VScode does not JSON encode ProtoBus messages
		return message
	}
}
