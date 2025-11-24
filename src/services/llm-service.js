/*
This is a temporary solution!!! Most of it will be moved to a backend later.
*/
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
		this.modelName = options.model || "google/gemini-2.0-flash-lite-001";

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
}
