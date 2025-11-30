/*
AI usage disclosure:

This file is developed with AI assistance (65%).

*/

import { get } from "@vercel/edge-config";
import WebSocket from "ws";
import { gateway } from "../_lib/common.js";

export const config = {
	runtime: "nodejs",
	maxDuration: 60,
};

/**
 * Helper to convert Response (Edge runtime) to Express res (Node runtime)
 * @param {Response} response - Edge runtime Response object
 * @param {object} res - Express response object
 */
async function sendResponse(response, res) {
	const data = await response.json();
	return res.status(response.status).json(data);
}

export default async function handler(req, res) {
	if (req.method !== "POST") {
		return sendResponse(gateway.notAllowed(), res);
	}

	const { enabled, reason } = await gateway.getServiceEnabled();
	if (!enabled) {
		return sendResponse(gateway.serviceUnavailable(reason), res);
	}

	const token = gateway.extractBearer(req);
	const user = await gateway.verifyUserKey(token);
	if (!user) {
		return sendResponse(gateway.unauthorized(), res);
	}

	const voskWsUrl = await get("VOSK_WS_URL");
	if (!voskWsUrl) {
		return sendResponse(gateway.serviceUnavailable(), res);
	}

	const ip = gateway.getIP(req);
	const device = req.headers["x-device-id"];
	try {
		await gateway.enforceRateLimit({ ip, device, userId: user.userId });
	} catch (e) {
		if (e instanceof Response) {
			return sendResponse(e, res);
		}
		return sendResponse(gateway.rateLimitError("rate limited"), res);
	}

	// Read audio data from request body
	const chunks = [];
	for await (const chunk of req) {
		chunks.push(chunk);
	}
	const audioBuffer = Buffer.concat(chunks);

	if (audioBuffer.length === 0) {
		return sendResponse(gateway.badRequest("empty audio data"), res);
	}

	// Max 10MB
	if (audioBuffer.length > 10 * 1024 * 1024) {
		return sendResponse(
			gateway.badRequest("audio file too large (max 10MB)"),
			res,
		);
	}

	try {
		const transcript = await transcribeAudio(voskWsUrl, audioBuffer);
		return res.status(200).json({
			transcript: transcript || "",
		});
	} catch (error) {
		console.error("Voice transcription error:", error);
		return sendResponse(
			gateway.badRequest(error.message || "transcription failed"),
			res,
		);
	}
}

/**
 * Transcribe audio using vosk-server
 * @param {string} wsUrl - vosk-server WebSocket URL (wss://...)
 * @param {Buffer} audioBuffer - Raw audio data (should be 16kHz mono PCM16)
 * @returns {Promise<string>} - Transcript text
 */
async function transcribeAudio(wsUrl, audioBuffer) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(wsUrl, {
			headers: {
				// Cloudflare Access headers
				...(process.env.CF_ACCESS_CLIENT_ID &&
				process.env.CF_ACCESS_CLIENT_SECRET
					? {
							"CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID,
							"CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET,
						}
					: {}),
			},
		});

		let finalResult = null;
		const timeout = setTimeout(() => {
			ws.close();
			reject(new Error("vosk-server timeout"));
		}, 55000); // 55s timeout

		ws.on("open", () => {
			// Send config
			const config = {
				config: {
					sample_rate: 16000,
					words: false,
					max_alternatives: 0,
				},
			};
			ws.send(JSON.stringify(config));

			// Send entire audio buffer
			ws.send(audioBuffer, { binary: true });

			// Send EOF
			ws.send(JSON.stringify({ eof: 1 }));
		});

		ws.on("message", (data) => {
			try {
				const result = JSON.parse(data.toString());
				// Keep the last result with "text" field
				if (result.text !== undefined) {
					finalResult = result.text;
				}
			} catch (e) {
				console.error("Failed to parse vosk result:", e);
			}
		});

		ws.on("close", () => {
			clearTimeout(timeout);
			resolve(finalResult || "");
		});

		ws.on("error", (error) => {
			clearTimeout(timeout);
			reject(new Error(`vosk-server error: ${error.message}`));
		});
	});
}
