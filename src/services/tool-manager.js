import { tool } from "ai";

export class ToolManager {
	constructor() {
		this.tools = new Map();
	}

	/**
	 * Register a new tool
	 * @param {string} name - Tool name
	 * @param {string} description - Tool description
	 * @param {import('zod').ZodType} parameters - Zod Schema for parameters
	 * @param {Function} handler - Function to execute
	 */
	registerTool(name, description, parameters, handler) {
		this.tools.set(name, {
			name,
			description,
			parameters,
			handler,
		});
	}

	/**
	 * Get tools formatted for Vercel AI SDK
	 * @returns {Object} Tools object for generateText
	 */
	getTools() {
		const tools = {};
		for (const [name, def] of this.tools) {
			tools[name] = tool({
				description: def.description,
				parameters: def.parameters,
				execute: def.handler,
			});
		}
		return tools;
	}

	/**
	 * Get all tool definitions in JSON Schema format
	 * Used when not using AI SDK tools directly
	 * @returns {Array} List of tool definitions
	 */
	getToolDefinitions() {
		return Array.from(this.tools.values()).map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters, // Zod object
			},
		}));
	}

	/**
	 * Execute a tool
	 * Used when not calling tools via AI SDK
	 * @param {string} name - Tool name
	 * @param {Object} args - Tool arguments
	 * @returns {Promise<any>} Tool execution result
	 */
	async executeTool(name, args) {
		const tool = this.tools.get(name);
		if (!tool) {
			throw new Error(`Tool ${name} not found`);
		}
		console.log(`Executing tool: ${name}`, args);
		try {
			return await tool.handler(args);
		} catch (error) {
			console.error(`Error executing tool ${name}:`, error);
			throw error;
		}
	}
}
