/*
This is a fallback for @ricky0123/vad-web, as vad-web may not work for all browsers,
like Safari in some iOS versions:
https://github.com/ricky0123/vad/issues/227
*/
import hark from "hark";

export class HarkService {
	constructor() {
		this.stream = null;
		this.harkInstance = null;
		this.active = false;
		this._starting = false;
		this._startToken = 0;

		// External callbacks
		this.onSpeechStart = null;
		this.onSpeechEnd = null;

		// [HARK_DEBUG] Debug tracking for mobile TTS truncation diagnosis
		this._debugEventId = 0;
		this._debugLastSpeakingTime = 0;
		this._debugLastStoppedTime = 0;

		// [HARK_DEBUG] Log initialization
		console.log('[HARK_DEBUG] HarkService initialized', {
			userAgent: navigator.userAgent,
			isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
			// Hypothesis: Hark (like VAD) may detect TTS audio output as speech
			timestamp: Date.now()
		});
	}

	isActive() {
		return this.active;
	}

	async start(options = {}) {
		// [HARK_DEBUG] Log start attempts
		console.log('[HARK_DEBUG] start() called', {
			alreadyActive: this.active,
			alreadyStarting: this._starting,
			timestamp: Date.now()
		});

		if (this.active || this._starting) return;

		if (!navigator.mediaDevices?.getUserMedia) {
			console.error("HarkService: getUserMedia not supported");
			return;
		}

		this._starting = true;
		const token = ++this._startToken;

		try {
			const constraints = options.constraints || {
				audio: {
					channelCount: 1,
					echoCancellation: true,
					autoGainControl: true,
					noiseSuppression: true,
				},
			};

			// [HARK_DEBUG] Log audio constraints - hypothesis: echoCancellation may not be effective on mobile
			console.log('[HARK_DEBUG] Requesting getUserMedia with constraints', {
				constraints: JSON.stringify(constraints),
				// Hypothesis: Mobile may ignore echoCancellation, causing TTS to be picked up
				timestamp: Date.now()
			});

			const stream = await navigator.mediaDevices.getUserMedia(constraints);

			// [HARK_DEBUG] Log stream info
			const audioTrack = stream.getAudioTracks()[0];
			console.log('[HARK_DEBUG] Got audio stream', {
				trackLabel: audioTrack?.label,
				trackSettings: JSON.stringify(audioTrack?.getSettings?.() || {}),
				// Hypothesis: Check if echoCancellation is actually enabled
				timestamp: Date.now()
			});

			// Check if cancelled during getUserMedia
			if (token !== this._startToken) {
				for (const t of stream.getTracks()) t.stop();
				return;
			}

			this.stream = stream;

			const harkOptions = {
				interval: 50,
				threshold: -65, // dB, lower is more sensitive
				play: false,
				...(options.hark || {}),
			};

			const instance = hark(this.stream, harkOptions);

			// Check again after hark init
			if (token !== this._startToken) {
				instance.stop();
				for (const t of this.stream.getTracks()) t.stop();
				this.stream = null;
				return;
			}

			this.harkInstance = instance;

			instance.on("speaking", () => {
				const eventId = ++this._debugEventId;
				const now = Date.now();
				const timeSinceLastStopped = this._debugLastStoppedTime ? now - this._debugLastStoppedTime : 'first';

				// [HARK_DEBUG] CRITICAL: Hark detected speaking - may be picking up TTS
				console.log(`[HARK_DEBUG] speaking event #${eventId}`, {
					timeSinceLastStopped: timeSinceLastStopped,
					// Hypothesis: If this fires while TTS is playing, Hark is hearing the TTS
					timestamp: now,
					// Hypothesis: Rapid speaking events may indicate TTS echo detection
					possibleEchoDetection: typeof timeSinceLastStopped === 'number' && timeSinceLastStopped < 500
				});

				this._debugLastSpeakingTime = now;
				this.onSpeechStart?.();
			});

			instance.on("stopped_speaking", () => {
				const eventId = this._debugEventId;
				const now = Date.now();
				const duration = this._debugLastSpeakingTime ? now - this._debugLastSpeakingTime : 'unknown';

				console.log(`[HARK_DEBUG] stopped_speaking event #${eventId}`, {
					speakingDuration: duration,
					// Hypothesis: Very short durations may be false positives from TTS audio
					possibleFalsePositive: typeof duration === 'number' && duration < 300,
					timestamp: now
				});

				this._debugLastStoppedTime = now;
				this.onSpeechEnd?.();
			});

			this.active = true;
			console.log('[HARK_DEBUG] Hark started successfully', { timestamp: Date.now() });
		} catch (e) {
			console.error("HarkService: start failed", e);
			throw e;
		} finally {
			this._starting = false;
		}
	}

	async stop() {
		// [HARK_DEBUG] Log stop attempts
		console.log('[HARK_DEBUG] stop() called', {
			wasActive: this.active,
			wasStarting: this._starting,
			callStack: new Error().stack?.split('\n').slice(1, 4).join(' <- '),
			timestamp: Date.now()
		});

		this._startToken++;

		if (!this.active && !this._starting) {
			console.log('[HARK_DEBUG] stop() - was not active, returning', { timestamp: Date.now() });
			return;
		}

		try {
			if (this.harkInstance) {
				console.log('[HARK_DEBUG] Stopping hark instance', { timestamp: Date.now() });
				this.harkInstance.stop();
				this.harkInstance = null;
			}
			if (this.stream) {
				console.log('[HARK_DEBUG] Stopping stream tracks', { timestamp: Date.now() });
				for (const t of this.stream.getTracks()) t.stop();
				this.stream = null;
			}
		} finally {
			this.active = false;
			this._starting = false;
			console.log('[HARK_DEBUG] Hark stopped', { timestamp: Date.now() });
		}
	}
}
