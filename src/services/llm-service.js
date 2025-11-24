/*
This is a temporary solution!!! Most of it will be moved to a backend later.
*/
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";

export class LLMService {
	/**
	 * @param {Object} options
	 * @param {string} [options.apiKey] - API Key for the provider
	 * @param {string} [options.provider='openrouter'] - Provider name
	 * @param {string} [options.model] - Model ID
	 */
	constructor(options = {}) {
		this.apiKey = options.apiKey || import.meta.env.VITE_OPENROUTER_API_KEY;
		this.providerName = options.provider || "openrouter";
		this.modelName = options.model || "google/gemini-2.5-flash";

		// VLLM
		this.vllmBaseURL =
			options.vllmBaseURL || import.meta.env.VITE_VLLM_BASE_URL;
		this.vllmApiKey = options.vllmApiKey || import.meta.env.VITE_VLLM_API_KEY;
		this.vllmModel = options.vllmModel || import.meta.env.VITE_VLLM_MODEL;

		if (!this.apiKey) {
			console.warn(
				"LLMService: API key is missing. Set VITE_OPENROUTER_API_KEY or pass it in options.",
			);
		}

		if (this.providerName === "openrouter") {
			this.provider = createOpenRouter({
				apiKey: this.apiKey,
			});
		} else {
			throw new Error(`Provider ${this.providerName} is not supported.`);
		}

		// Initialize for VLLM if configured
		if (this.vllmBaseURL) {
			this.vllmProvider = createOpenAICompatible({
				name: "llamacpp",
				baseURL: this.vllmBaseURL,
				...(this.vllmApiKey ? { apiKey: this.vllmApiKey } : {}),
			});
		}
	}

	/**
	 * Send a prompt to the LLM
	 * @param {string} prompt - User input
	 * @param {Object} options - Additional options
	 * @param {Object} [options.tools] - Tools definition for AI SDK
	 * @param {string} [options.system] - System prompt
	 * @param {number} [options.maxSteps=5] - Max steps for tool execution
	 * @returns {Promise<import('ai').GenerateTextResult>}
	 */
	async send(prompt, options = {}) {
		const { tools, system, maxSteps = 5 } = options;

		try {
			const result = await generateText({
				model: this.provider(this.modelName),
				prompt,
				system,
				tools,
				maxSteps,
			});

			return result;
		} catch (error) {
			console.error("LLMService send error:", error);
			throw error;
		}
	}

	/**
	 * Send messages with context to the LLM
	 * @param {Array} messages - Array of CoreMessage objects with conversation history
	 * @param {Object} options - Additional options
	 * @param {Object} [options.tools] - Tools definition for AI SDK
	 * @param {string} [options.system] - System prompt
	 * @param {number} [options.maxSteps=5] - Max steps for tool execution
	 * @returns {Promise<import('ai').GenerateTextResult>}
	 */
	async sendMessages(messages, options = {}) {
		const { tools, system, maxSteps = 5 } = options;

		try {
			const result = await generateText({
				model: this.provider(this.modelName),
				messages,
				system,
				tools,
				maxSteps,
			});

			return result;
		} catch (error) {
			console.error("LLMService sendMessages error:", error);
			throw error;
		}
	}

	/**
	 * Send image + text to an OpenAI-compatible VLLM endpoint (e.g. llama.cpp server)
	 * @param {Object} params
	 * @param {string} [params.prompt] - Optional user text
	 * @param {Blob} [params.imageBlob] - Image as Blob/File (browser capture)
	 * @param {string} [params.imageUrl] - Image URL (if you prefer URL input)
	 * @param {string} [params.model] - Override model id for VLLM
	 * @param {string} [params.system] - Optional system prompt
	 * @param {number} [params.resizeMaxWidth] - Optional max width for downscaling (default: 448)
	 * @param {number} [params.resizeMaxHeight] - Optional max height for downscaling (default: 448)
	 * @param {number} [params.resizeQuality] - Optional JPEG quality 0-1 (default: 0.6)
	 * @param {number} [params.maxOutputTokens] - Optional max tokens for the response
	 * @returns {Promise<import('ai').GenerateTextResult>}
	 */
	async sendImageAndText(params = {}) {
		const {
			prompt,
			imageBlob,
			imageUrl,
			model,
			system,
			resizeMaxWidth = 448,
			resizeMaxHeight = 448,
			resizeQuality = 0.6,
			maxOutputTokens,
		} = params;

		if (!this.vllmProvider) {
			throw new Error(
				"VLLM provider not configured. Set VITE_VLLM_BASE_URL or pass vllmBaseURL in constructor.",
			);
		}

		if (!imageBlob && !imageUrl) {
			throw new Error("sendImageAndText requires imageBlob or imageUrl");
		}

		const content = [];
		if (prompt && String(prompt).trim()) {
			content.push({ type: "text", text: prompt });
		}
		if (imageBlob) {
			const toUint8 = async (b) => new Uint8Array(await b.arrayBuffer());
			let bytes;
			try {
				let bmp;
				if ("createImageBitmap" in window) {
					bmp = await createImageBitmap(imageBlob);
				} else {
					bmp = await new Promise((resolve, reject) => {
						const url = URL.createObjectURL(imageBlob);
						const img = new Image();
						img.onload = () => {
							URL.revokeObjectURL(url);
							resolve(img);
						};
						img.onerror = (e) => {
							URL.revokeObjectURL(url);
							reject(e);
						};
						img.src = url;
					});
				}
				const sw = bmp.width;
				const sh = bmp.height;
				// If both sides already <= 448, avoid compress
				if (sw <= resizeMaxWidth && sh <= resizeMaxHeight) {
					bytes = await toUint8(imageBlob);
				} else {
					const ratio = Math.min(
						1,
						resizeMaxWidth > 0 ? resizeMaxWidth / sw : 1,
						resizeMaxHeight > 0 ? resizeMaxHeight / sh : 1,
					);
					const tw = Math.max(1, Math.round(sw * ratio));
					const th = Math.max(1, Math.round(sh * ratio));
					const canvas = document.createElement("canvas");
					canvas.width = tw;
					canvas.height = th;
					const ctx = canvas.getContext("2d");
					if (ctx) {
						ctx.drawImage(bmp, 0, 0, tw, th);
						const outBlob = await new Promise((resolve, reject) => {
							canvas.toBlob(
								(b) =>
									b ? resolve(b) : reject(new Error("Resize export failed")),
								"image/jpeg",
								resizeQuality,
							);
						});
						bytes = await toUint8(outBlob);
					} else {
						bytes = await toUint8(imageBlob);
					}
				}
				content.push({ type: "image", image: bytes });
			} catch (_) {
				const fallback = await toUint8(imageBlob);
				content.push({ type: "image", image: fallback });
			}
		} else if (imageUrl) {
			content.push({ type: "image", image: imageUrl });
		}

		try {
			const result = await generateText({
				model: this.vllmProvider.chatModel(model || this.vllmModel),
				messages: [
					{
						role: "user",
						content,
					},
				],
				system,
				maxOutputTokens,
			});
			return result;
		} catch (error) {
			console.error("LLMService sendImageAndText error:", error);
			throw error;
		}
	}
}
