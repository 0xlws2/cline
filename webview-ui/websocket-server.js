#!/usr/bin/env node

import { WebSocketServer } from "ws"
import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import path from "path"
import { fileURLToPath } from "url"
import { networkInterfaces } from "os"

// Port configuration - hardcoded to match backend
const WS_PORT = 8081
const GRPC_SERVER_PORT = 9090

// Get local IP address for network access
function getLocalIP() {
	try {
		const nets = networkInterfaces()
		for (const name of Object.keys(nets)) {
			for (const net of nets[name]) {
				if (net.family === "IPv4" && !net.internal) {
					return net.address
				}
			}
		}
	} catch (e) {}
	return "localhost"
}

const localIP = getLocalIP()
console.log(`🔌 Starting WebSocket Server for gRPC Communication`)
console.log(`   WebSocket: ws://0.0.0.0:${WS_PORT} (accessible via ws://${localIP}:${WS_PORT})`)
console.log(`   gRPC Server: localhost:${GRPC_SERVER_PORT}`)

// Resolve repo root for proto files
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const protoDir = path.resolve(repoRoot, "proto")

// Load proto definitions for the cline services we need
const CLINES = [
	"cline/account.proto",
	"cline/browser.proto",
	"cline/checkpoints.proto",
	"cline/common.proto",
	"cline/file.proto",
	"cline/mcp.proto",
	"cline/models.proto",
	"cline/slash.proto",
	"cline/state.proto",
	"cline/task.proto",
	"cline/ui.proto",
	"cline/web.proto",
]

const loaderOptions = {
	keepCase: true,
	longs: String,
	enums: String,
	defaults: true,
	oneofs: true,
}

const packageDefinition = protoLoader.loadSync(CLINES, { includeDirs: [protoDir], ...loaderOptions })
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition)

// Build gRPC clients with larger message limits
const grpcOptions = {
	"grpc.max_receive_message_length": 100 * 1024 * 1024, // 100MB
	"grpc.max_send_message_length": 100 * 1024 * 1024,
}

const clinePkg = protoDescriptor.cline || {}
function createClient(serviceName) {
	const ServiceCtor = clinePkg[serviceName]
	if (!ServiceCtor) return null
	return new ServiceCtor(`localhost:${GRPC_SERVER_PORT}`, grpc.credentials.createInsecure(), grpcOptions)
}

const clients = new Map()
function getClient(fullyQualifiedService) {
	// fullyQualifiedService is like "cline.StateService"
	const short = fullyQualifiedService.replace(/^cline\./, "")
	if (clients.has(short)) return clients.get(short)
	const client = createClient(short)
	if (!client) return null
	clients.set(short, client)
	return client
}

// Track active streaming calls for cancellation
const activeCalls = new Map() // request_id -> call

// Create WebSocket server (bind to all interfaces)
const wss = new WebSocketServer({
	port: WS_PORT,
	host: "0.0.0.0",
})

wss.on("connection", (ws) => {
	console.log("🔌 Frontend connected via WebSocket")

	ws.on("message", (message) => {
		try {
			const data = JSON.parse(message.toString())
			// console.log("📨 Received from frontend:", data.type || "unknown")

			if (data.type === "grpc_request") {
				handleGrpcRequest(data, ws)
			} else if (data.type === "grpc_request_cancel") {
				handleGrpcCancel(data, ws)
			}
		} catch (error) {
			console.error("❌ WebSocket message error:", error)
		}
	})

	ws.on("close", () => {
		console.log("🔌 Frontend disconnected")
	})

	ws.on("error", (error) => {
		console.error("❌ WebSocket error:", error)
	})
})

function sendGrpcResponse(ws, { request_id, message = null, error = null, is_streaming = false, sequence_number = undefined }) {
	const payload = {
		type: "grpc_response",
		grpc_response: {
			request_id,
			message,
			error,
			is_streaming,
			sequence_number,
		},
	}
	try {
		ws.send(JSON.stringify(payload))
	} catch (e) {
		console.error("❌ Failed to send WebSocket response:", e)
	}
}

function toSnakeCase(str) {
	return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}
function toCamelCase(str) {
	return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}
function keysToSnake(obj) {
	if (obj == null || typeof obj !== "object") return obj
	if (Array.isArray(obj)) return obj.map(keysToSnake)
	const out = {}
	for (const [k, v] of Object.entries(obj)) {
		out[toSnakeCase(k)] = keysToSnake(v)
	}
	return out
}
function keysToCamel(obj) {
	if (obj == null || typeof obj !== "object") return obj
	if (Array.isArray(obj)) return obj.map(keysToCamel)
	const out = {}
	for (const [k, v] of Object.entries(obj)) {
		out[toCamelCase(k)] = keysToCamel(v)
	}
	return out
}

// Handle gRPC requests by forwarding to native gRPC backend
async function handleGrpcRequest(request, ws) {
	const { grpc_request } = request || {}
	if (!grpc_request) {
		return sendGrpcResponse(ws, { request_id: "", error: "Invalid gRPC request format", is_streaming: false })
	}

	const { service, method, request_id, is_streaming, message } = grpc_request
	try {
		const client = getClient(service)
		if (!client) {
			throw new Error(`Unknown service: ${service}`)
		}
		if (typeof client[method] !== "function") {
			throw new Error(`Unknown method: ${service}.${method}`)
		}

		console.log(`📡 Forwarding gRPC request: ${service}/${method}`)

		const snakeRequest = keysToSnake(message || {})

		if (!is_streaming) {
			// Unary call with callback style
			client[method](snakeRequest, (err, resp) => {
				if (err) {
					return sendGrpcResponse(ws, { request_id, error: err.message || String(err), is_streaming: false })
				}
				const camelResp = keysToCamel(resp)
				sendGrpcResponse(ws, { request_id, message: camelResp, is_streaming: false })
			})
			return
		}

		// Server-streaming call
		const call = client[method](snakeRequest)
		activeCalls.set(request_id, call)
		let seq = 0

		call.on("data", (resp) => {
			// Debug: log state payload size to verify hydration expectations
			if (service === "cline.StateService" && method === "subscribeToState") {
				try {
					const size = resp && typeof resp === "object" && resp.state_json ? String(resp.state_json).length : 0
					// eslint-disable-next-line no-console
					console.log(`[WS-Bridge] subscribeToState chunk: state_json length=${size}`)
				} catch {}
			}
			const camelResp = keysToCamel(resp)
			if (service === "cline.StateService" && method === "subscribeToState") {
				try {
					const sizeCamel =
						camelResp && typeof camelResp === "object" && camelResp.stateJson ? String(camelResp.stateJson).length : 0
					// eslint-disable-next-line no-console
					console.log(`[WS-Bridge] subscribeToState camel chunk: stateJson length=${sizeCamel}`)
				} catch {}
			}
			sendGrpcResponse(ws, { request_id, message: camelResp, is_streaming: true, sequence_number: seq++ })
		})
		call.on("end", () => {
			sendGrpcResponse(ws, { request_id, message: null, is_streaming: false })
			activeCalls.delete(request_id)
		})
		call.on("error", (err) => {
			// gRPC ends with an error also closes the stream
			sendGrpcResponse(ws, { request_id, error: err.message || String(err), is_streaming: false })
			activeCalls.delete(request_id)
		})
	} catch (error) {
		console.error("❌ gRPC request error:", error)
		sendGrpcResponse(ws, { request_id, error: error.message || String(error), is_streaming: false })
	}
}

// Handle gRPC request cancellation
function handleGrpcCancel(request, ws) {
	const requestId = request?.grpc_request_cancel?.request_id
	console.log(`🚫 Canceling gRPC request: ${requestId}`)
	if (!requestId) return
	const call = activeCalls.get(requestId)
	if (call && typeof call.cancel === "function") {
		try {
			call.cancel()
		} catch (e) {
			console.warn(`⚠️ Error cancelling call ${requestId}:`, e?.message || e)
		}
	}
	activeCalls.delete(requestId)
}

console.log(`✅ WebSocket Server running on ws://localhost:${WS_PORT}`)
console.log(`   Ready to handle gRPC communication for remote Cline!`)

// Graceful shutdown
process.on("SIGINT", () => {
	console.log("\n🛑 Shutting down WebSocket Server...")
	// Cancel all active gRPC calls
	for (const [requestId, call] of activeCalls) {
		try {
			if (call && typeof call.cancel === "function") {
				call.cancel()
			}
		} catch (e) {
			console.warn(`⚠️ Error cancelling call ${requestId}:`, e?.message || e)
		}
	}
	activeCalls.clear()

	// Close WebSocket server
	wss.close(() => {
		console.log("✅ WebSocket Server closed")
		process.exit(0)
	})

	// Force exit after 2 seconds if graceful shutdown fails
	setTimeout(() => {
		console.log("⚡ Force exit")
		process.exit(1)
	}, 2000)
})
