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

		// [VAD_DEBUG] Debug tracking for mobile TTS truncation diagnosis
		this._debugEventId = 0;
		this._debugLastSpeechStartTime = 0;
		this._debugLastSpeechEndTime = 0;

		// [VAD_DEBUG] Log initialization
		console.log('[VAD_DEBUG] VADService initialized', {
			userAgent: navigator.userAgent,
			isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
			// Hypothesis: VAD may be more sensitive on mobile or pick up TTS audio
			vadOptions: JSON.stringify(vadOptions),
			timestamp: Date.now()
		});
	}

	isActive() {
		return this.active;
	}

	isStarting() {
		return !!this._starting;
	}

	async start() {
		// [VAD_DEBUG] Log start attempts
		console.log('[VAD_DEBUG] start() called', {
			alreadyActive: this.active,
			alreadyStarting: !!this._starting,
			timestamp: Date.now()
		});

		if (this.active) return;
		if (this._starting) return this._starting;

		this._starting = (async () => {
			const baseAssetPath =
				"https://cdn.jsdelivr.net/npm/@ricky0123/vad-web/dist/";

			// [VAD_DEBUG] Wrap callbacks with debug logging
			const debugOnSpeechStart = () => {
				const eventId = ++this._debugEventId;
				const now = Date.now();
				const timeSinceLastEnd = this._debugLastSpeechEndTime ? now - this._debugLastSpeechEndTime : 'first';

				// [VAD_DEBUG] CRITICAL: This is where VAD detects speech - hypothesis: it may detect TTS output
				console.log(`[VAD_DEBUG] onSpeechStart #${eventId}`, {
					timeSinceLastSpeechEnd: timeSinceLastEnd,
					// Hypothesis: If this fires shortly after TTS starts, VAD is hearing TTS
					// Check if TTS is currently playing when this fires
					timestamp: now,
					// Hypothesis: Short intervals between end and start may indicate echo/feedback loop
					possibleEchoDetection: typeof timeSinceLastEnd === 'number' && timeSinceLastEnd < 500
				});

				this._debugLastSpeechStartTime = now;
				this.onSpeechStart?.();
			};

			const debugOnSpeechEnd = (audio) => {
				const eventId = this._debugEventId; // Use same ID as corresponding start
				const now = Date.now();
				const duration = this._debugLastSpeechStartTime ? now - this._debugLastSpeechStartTime : 'unknown';

				console.log(`[VAD_DEBUG] onSpeechEnd #${eventId}`, {
					speechDuration: duration,
					audioLength: audio?.length,
					// Hypothesis: Very short speech durations may be false positives from TTS
					possibleFalsePositive: typeof duration === 'number' && duration < 300,
					timestamp: now
				});

				this._debugLastSpeechEndTime = now;
				this.onSpeechEnd?.(audio);
			};

			const commonOptions = {
				baseAssetPath,
				onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/",
				onSpeechStart: debugOnSpeechStart,
				onSpeechEnd: debugOnSpeechEnd,
				...this.vadOptions,
			};

			try {
				// Try AudioWorklet first, fallback to ScriptProcessor if needed
				try {
					console.log('[VAD_DEBUG] Attempting AudioWorklet processor', { timestamp: Date.now() });
					this.vad = await MicVAD.new({
						...commonOptions,
						processorType: "AudioWorklet",
					});
					console.log('[VAD_DEBUG] AudioWorklet processor succeeded', { timestamp: Date.now() });
				} catch (err) {
					console.warn(
						"VADService: AudioWorklet failed, falling back to ScriptProcessor",
						err,
					);
					console.log('[VAD_DEBUG] Falling back to ScriptProcessor', { timestamp: Date.now() });
					this.vad = await MicVAD.new({
						...commonOptions,
						processorType: "ScriptProcessor",
					});
					console.log('[VAD_DEBUG] ScriptProcessor succeeded', { timestamp: Date.now() });
				}

				console.log('[VAD_DEBUG] Calling vad.start()', { timestamp: Date.now() });
				await this.vad.start();
				this.active = true;
				// [VAD_DEBUG] Log successful start with mic access info
				console.log('[VAD_DEBUG] VAD started successfully', {
					active: this.active,
					// Hypothesis: Mic access may conflict with TTS audio routing on mobile
					timestamp: Date.now()
				});
			} catch (e) {
				console.error("VADService: failed to initialize MicVAD", e);
				console.log('[VAD_DEBUG] VAD start failed', { error: e.message, timestamp: Date.now() });
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
		// [VAD_DEBUG] Log stop attempts - hypothesis: stopping VAD during TTS may help prevent truncation
		console.log('[VAD_DEBUG] stop() called', {
			wasActive: this.active,
			wasStarting: !!this._starting,
			// Hypothesis: If stop is called while TTS is playing, it may help
			callStack: new Error().stack?.split('\n').slice(1, 4).join(' <- '),
			timestamp: Date.now()
		});

		if (this._starting) {
			try {
				await this._starting;
			} catch {}
		}

		if (!this.active) {
			console.log('[VAD_DEBUG] stop() - was not active, returning', { timestamp: Date.now() });
			return;
		}

		try {
			if (this.vad) {
				console.log('[VAD_DEBUG] Calling vad.destroy()', { timestamp: Date.now() });
				await this.vad.destroy();
				console.log('[VAD_DEBUG] vad.destroy() completed', { timestamp: Date.now() });
			}
		} finally {
			this.vad = null;
			this.active = false;
			console.log('[VAD_DEBUG] VAD stopped', { timestamp: Date.now() });
		}
	}
}
