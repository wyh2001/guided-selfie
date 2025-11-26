export const config = { runtime: "edge" };

import { gateway } from "../_lib/common.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export default async function handler(req) {
	if (req.method !== "POST") return gateway.notAllowed();

	const { enabled, reason } = await gateway.getServiceEnabled();
	if (!enabled) return gateway.serviceUnavailable(reason);

	const token = gateway.extractBearer(req);
	const user = await gateway.verifyUserKey(token);
	if (!user) return gateway.unauthorized();

	const ip = gateway.getIP(req);
	const device = req.headers.get("x-device-id");
	const sessionId = req.headers.get("x-session-id");

	const contentType = req.headers.get("content-type") || "";
	if (!contentType.includes("application/json"))
		return gateway.badRequest("expect application/json");

	const raw = await req.text();
	if (raw.length > 1_000_000) return gateway.badRequest("payload too large");
	let body;
	try {
		body = JSON.parse(raw);
	} catch {
		return gateway.badRequest("invalid json");
	}

	// simple validation and clamping
	if (typeof body.stream !== "undefined" && typeof body.stream !== "boolean") {
		return gateway.badRequest("stream must be boolean if provided");
	}
	if (Array.isArray(body.messages) && body.messages.length > 64) {
		return gateway.badRequest("too many messages (max 64)");
	}

	const allowed = await gateway.getAllowedModels();
	if (allowed.length && body.model && !allowed.includes(String(body.model))) {
		return gateway.forbidden("model_not_allowed");
	}
	const maxTemp = await gateway.getMaxTemperature();
	if (typeof body.temperature === "number") {
		body.temperature = Math.min(Math.max(body.temperature, 0), maxTemp);
	}
	const maxTokens = await gateway.getMaxTokens();
	if (typeof body.max_tokens === "number") {
		const n = Math.max(1, Math.floor(body.max_tokens));
		body.max_tokens = Math.min(n, maxTokens);
	}

	try {
		await gateway.enforceRateLimit({ ip, device, userId: user.userId });
	} catch (e) {
		if (e instanceof Response) return e;
		return gateway.rateLimitError("rate limited");
	}

	let locked = false;
	if (sessionId) {
		locked = await gateway.acquireSessionLock(sessionId);
		if (!locked) return gateway.conflict("session locked");
	}

	const apiKey = process.env.OPENROUTER_API_KEY ?? "";
	if (!apiKey) return gateway.serviceUnavailable();

	if (!body.user && user.userId) body.user = String(user.userId);

	const upstreamHeaders = {
		"content-type": "application/json",
		Authorization: `Bearer ${apiKey}`,
		"X-Title": "guided-selfie",
		"HTTP-Referer":
			req.headers.get("origin") ||
			(req.headers.get("host") ? `https://${req.headers.get("host")}/` : ""),
	};

	let responded = false;
	try {
		const upstream = await fetch(OPENROUTER_URL, {
			method: "POST",
			headers: upstreamHeaders,
			body: JSON.stringify(body),
		});

		const respHeaders = new Headers();
		const ct = upstream.headers.get("content-type") || "";
		if (ct.includes("text/event-stream")) {
			respHeaders.set("content-type", "text/event-stream; charset=utf-8");
			respHeaders.set("cache-control", "no-cache");
			respHeaders.set("connection", "keep-alive");
		} else {
			respHeaders.set("content-type", "application/json; charset=utf-8");
		}
		respHeaders.set("x-content-type-options", "nosniff");
		// propagate useful upstream headers if present
		for (const h of [
			"x-request-id",
			"openrouter-processing-ms",
			"openrouter-ratelimit-limit",
			"openrouter-ratelimit-remaining",
			"openrouter-ratelimit-reset",
			"ratelimit-limit",
			"ratelimit-remaining",
			"ratelimit-reset",
		]) {
			const v = upstream.headers.get(h);
			if (v) respHeaders.set(h, v);
		}

		// stream wrapper to release session lock on completion/cancel
		const upstreamBody = upstream.body;
		if (!upstreamBody) {
			if (sessionId && locked) await gateway.releaseSessionLock(sessionId);
			responded = true;
			return new Response(null, {
				status: upstream.status,
				headers: respHeaders,
			});
		}

		const stream = new ReadableStream({
			start(controller) {
				const reader = upstreamBody.getReader();
				function pump() {
					reader
						.read()
						.then(({ done, value }) => {
							if (done) {
								controller.close();
								if (sessionId && locked) gateway.releaseSessionLock(sessionId);
								return;
							}
							controller.enqueue(value);
							pump();
						})
						.catch((err) => {
							controller.error(err);
							if (sessionId && locked) gateway.releaseSessionLock(sessionId);
						});
				}
				pump();
			},
			cancel() {
				if (sessionId && locked) gateway.releaseSessionLock(sessionId);
			},
		});

		responded = true;
		return new Response(stream, {
			status: upstream.status,
			headers: respHeaders,
		});
	} finally {
		if (sessionId && locked && !responded) {
			await gateway.releaseSessionLock(sessionId);
		}
	}
}
