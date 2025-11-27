export const OPENAI_BASE_URL = "/api/openai";
export const VLLM_BASE_URL = "/api/vllm";
export const STATUS_URL = "/api/status";

export async function fetchBackendStatus() {
	try {
		const res = await fetch(STATUS_URL, { method: "GET" });
		if (!res.ok) return { enabled: false, reason: "status_error" };
		const data = await res.json();
		return {
			enabled: !!data.enabled,
			reason: data.reason || null,
			models: data.models || [],
		};
	} catch {
		return { enabled: false, reason: "network_error" };
	}
}
