import { getAllowedModels, getServiceEnabled } from "../_lib/common.js";
export const config = { runtime: "edge" };

export default async function handler() {
	const { enabled, reason } = await getServiceEnabled();
	const models = await getAllowedModels();
	const body = {
		enabled,
		reason: enabled ? null : (reason ?? "disabled"),
		models,
	};
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}
