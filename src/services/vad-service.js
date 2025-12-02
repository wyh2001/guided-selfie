import { MicVAD } from "@ricky0123/vad-web";

export class VADService {
	constructor(vadOptions = {}) {
		this.vad = null;
		this.active = false;
		this._starting = null;

		// External callbacks
		this.onSpeechStart = null;
		this.onSpeechEnd = null;

		this.vadOptions = vadOptions;
	}

	isActive() {
		return this.active;
	}

	isStarting() {
		return !!this._starting;
	}

	async start() {
		if (this.active) return;
		if (this._starting) return this._starting;

		this._starting = (async () => {
			const baseAssetPath =
				"https://cdn.jsdelivr.net/npm/@ricky0123/vad-web/dist/";
			const commonOptions = {
				baseAssetPath,
				onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/",
				onSpeechStart: () => this.onSpeechStart?.(),
				onSpeechEnd: (audio) => this.onSpeechEnd?.(audio),
				...this.vadOptions,
			};

			try {
				// Try AudioWorklet first, fallback to ScriptProcessor if needed
				try {
					this.vad = await MicVAD.new({
						...commonOptions,
						processorType: "AudioWorklet",
					});
				} catch (err) {
					console.warn(
						"VADService: AudioWorklet failed, falling back to ScriptProcessor",
						err,
					);
					this.vad = await MicVAD.new({
						...commonOptions,
						processorType: "ScriptProcessor",
					});
				}

				await this.vad.start();
				this.active = true;
			} catch (e) {
				console.error("VADService: failed to initialize MicVAD", e);
				this.vad = null;
				this.active = false;
				throw e;
			} finally {
				this._starting = null;
			}
		})();

		return this._starting;
	}

	async stop() {
		if (this._starting) {
			try {
				await this._starting;
			} catch {}
		}

		if (!this.active) return;

		try {
			if (this.vad) {
				await this.vad.destroy();
			}
		} finally {
			this.vad = null;
			this.active = false;
		}
	}
}
