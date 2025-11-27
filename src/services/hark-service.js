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
	}

	isActive() {
		return this.active;
	}

	async start(options = {}) {
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

			const stream = await navigator.mediaDevices.getUserMedia(constraints);

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
				this.onSpeechStart?.();
			});

			instance.on("stopped_speaking", () => {
				this.onSpeechEnd?.();
			});

			this.active = true;
		} catch (e) {
			console.error("HarkService: start failed", e);
			throw e;
		} finally {
			this._starting = false;
		}
	}

	async stop() {
		this._startToken++;

		if (!this.active && !this._starting) return;

		try {
			if (this.harkInstance) {
				this.harkInstance.stop();
				this.harkInstance = null;
			}
			if (this.stream) {
				for (const t of this.stream.getTracks()) t.stop();
				this.stream = null;
			}
		} finally {
			this.active = false;
			this._starting = false;
		}
	}
}
