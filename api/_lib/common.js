import { get } from "@vercel/edge-config";
import { kv } from "@vercel/kv";

export async function getServiceEnabled() {
	const flag = await get("SERVICE_ENABLED");
	const enabled = flag !== false;
	const reason = enabled
		? undefined
		: (await get("SERVICE_DISABLED_REASON")) || "disabled";
	return { enabled, reason };
}

export async function getAllowedModels() {
	const models = await get("ALLOWED_MODELS");
	if (!models) return [];
	if (Array.isArray(models)) return models;
	return String(models)
		.split(",")
		.map((m) => m.trim())
		.filter(Boolean);
}

export async function getMaxTemperature() {
	const v = await get("MAX_TEMPERATURE");
	return typeof v === "number" ? v : 1.0;
}

export async function getMaxTokens() {
	const v = await get("MAX_TOKENS");
	return typeof v === "number" ? v : 2048;
}

export async function getVllmBaseURL() {
	const v = await get("VLLM_BASE_URL");
	return v || null;
}

export function getIP(req) {
	const ip =
		req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
		req.headers.get("x-real-ip") ||
		req.headers.get("cf-connecting-ip") || // just in case
		"0.0.0.0";
	return ip;
}

export function extractBearer(req) {
	const h =
		req.headers.get("authorization") || req.headers.get("Authorization");
	if (!h) return null;
	const m = /^Bearer\s+(.+)$/i.exec(h);
	return m ? m[1] : null;
}

export async function verifyUserKey(token) {
	if (!token) return null;
	const tokenId = await tokenToId(token);
	const record = await kv.get(`userkey:${tokenId}`);
	if (!record) return null;
	if (record.status && record.status !== "active") return null;
	return record;
}

async function tokenToId(token) {
	const enc = new TextEncoder();
	const data = enc.encode(token);
	const digest = await crypto.subtle.digest("SHA-256", data);
	const bytes = new Uint8Array(digest);
	let b64 = "";
	// Convert to base64
	for (let i = 0; i < bytes.length; i++) b64 += String.fromCharCode(bytes[i]);
	// btoa expects binary string
	const base64 = btoa(b64);
	// base64url without padding
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function getRatePlan() {
	const defaults = { per10s: 4, perHour: 120, perDay: 1000 };
	const cfg = await get("RATE_LIMITS");
	if (!cfg || typeof cfg !== "object") return defaults;
	return {
		per10s: Number(cfg.per10s) || defaults.per10s,
		perHour: Number(cfg.perHour) || defaults.perHour,
		perDay: Number(cfg.perDay) || defaults.perDay,
	};
}

export async function enforceRateLimit(dim) {
	const plan = await getRatePlan();
	const now = Date.now();

	const minute10Bucket = Math.floor(now / 10_000);
	const hourBucket = Math.floor(now / 3_600_000);
	const dayBucket = Math.floor(now / 86_400_000);

	const dims = [
		[`rl:ip:${dim.ip}:${minute10Bucket}`, plan.per10s, 12],
		[`rl:ip:${dim.ip}:${hourBucket}`, plan.perHour, 3_700],
		[`rl:ip:${dim.ip}:${dayBucket}`, plan.perDay, 90_000],
	];

	if (dim.device) {
		dims.push([`rl:dev:${dim.device}:${minute10Bucket}`, plan.per10s, 12]);
		dims.push([`rl:dev:${dim.device}:${hourBucket}`, plan.perHour, 3_700]);
		dims.push([`rl:dev:${dim.device}:${dayBucket}`, plan.perDay, 90_000]);
	}
	if (dim.userId) {
		dims.push([`rl:user:${dim.userId}:${minute10Bucket}`, plan.per10s, 12]);
		dims.push([`rl:user:${dim.userId}:${hourBucket}`, plan.perHour, 3_700]);
		dims.push([`rl:user:${dim.userId}:${dayBucket}`, plan.perDay, 90_000]);
	}

	for (const [key, limit, ttl] of dims) {
		const c = await kv.incr(key);
		if (c === 1) await kv.expire(key, ttl);
		if (c > limit) {
			let retryAfter = 10;
			try {
				const remain = await kv.ttl(key);
				if (typeof remain === "number" && remain > 0)
					retryAfter = Math.max(1, remain);
			} catch {}
			throw rateLimitError("Too many requests", retryAfter, key);
		}
	}
}

export function rateLimitError(message, retryAfter = 10, key) {
	return new Response(
		JSON.stringify({ error: "rate_limited", message, retryAfter, key }),
		{
			status: 429,
			headers: {
				"content-type": "application/json; charset=utf-8",
				"retry-after": String(retryAfter),
			},
		},
	);
}

export async function acquireSessionLock(sessionId, ttlSec = 300) {
	const ok = await kv.setnx(`lock:session:${sessionId}`, 1);
	if (ok) await kv.expire(`lock:session:${sessionId}`, ttlSec);
	return !!ok;
}

export async function releaseSessionLock(sessionId) {
	await kv.del(`lock:session:${sessionId}`);
}

export function badRequest(message) {
	return new Response(JSON.stringify({ error: "bad_request", message }), {
		status: 400,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

export function unauthorized(message = "invalid or missing user key") {
	return new Response(JSON.stringify({ error: "unauthorized", message }), {
		status: 401,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

export function forbidden(message = "forbidden") {
	return new Response(JSON.stringify({ error: "forbidden", message }), {
		status: 403,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

export function serviceUnavailable(reason = "service_disabled") {
	return new Response(JSON.stringify({ error: reason, enabled: false }), {
		status: 503,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

export function conflict(message = "concurrent session in progress") {
	return new Response(JSON.stringify({ error: "conflict", message }), {
		status: 409,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

export function notAllowed() {
	return new Response(JSON.stringify({ error: "method_not_allowed" }), {
		status: 405,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

export function withJSONHeaders(res) {
	const h = new Headers(res.headers);
	h.set("content-type", "application/json; charset=utf-8");
	return new Response(res.body, { status: res.status, headers: h });
}

export const gateway = {
	// config
	getServiceEnabled,
	getAllowedModels,
	getMaxTemperature,
	getMaxTokens,
	getVllmBaseURL,
	// request helpers
	getIP,
	extractBearer,
	// auth and rate limit
	verifyUserKey,
	enforceRateLimit,
	acquireSessionLock,
	releaseSessionLock,
	// error responses
	badRequest,
	unauthorized,
	forbidden,
	serviceUnavailable,
	conflict,
	notAllowed,
	rateLimitError,
	withJSONHeaders,
};
