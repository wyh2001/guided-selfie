/*
AI usage disclosure:

This file is developed with AI assistance (70%), 
especifically for the part of audio processing.

ChatGPT suggested some improvements, like fallback for some browsers.

*/
export class VoskRecognitionService {
	constructor() {
		this.mediaRecorder = null;
		this.audioChunks = [];
		this.isListening = false;
		this.status = "idle"; // idle | starting | listening | stopping
		this.audioContext = null;
		this.mediaStream = null;
		this._disposed = false;

		// Callbacks
		this.onResult = null;
		this.onError = null;
		this.onStart = null;
		this.onEnd = null;

		// Concurrency control
		this._startingPromise = null;
		this._stoppingPromise = null;
	}

	_setStatus(s) {
		this.status = s;
		this.isListening = s === "listening";
	}

	/**
	 * Start listening for speech input
	 * @returns {Promise<boolean>} true if started successfully
	 */
	async start() {
		if (this.status === "listening") return true;

		if (this._startingPromise) return this._startingPromise;

		if (this._stoppingPromise) await this._stoppingPromise;

		this._setStatus("starting");

		this._startingPromise = (async () => {
			try {
				if (!this.mediaStream) {
					this.mediaStream = await navigator.mediaDevices.getUserMedia({
						audio: {
							channelCount: 1,
							sampleRate: 16000,
							echoCancellation: true,
							noiseSuppression: true,
						},
					});
				}

				this.audioChunks = [];
				const options = {};
				if (
					// Fallback for some browsers
					typeof MediaRecorder.isTypeSupported === "function" &&
					MediaRecorder.isTypeSupported("audio/webm")
				) {
					options.mimeType = "audio/webm";
				}
				this.mediaRecorder = new MediaRecorder(this.mediaStream, options);

				this.mediaRecorder.ondataavailable = (event) => {
					if (event.data.size > 0) {
						this.audioChunks.push(event.data);
					}
				};

				this.mediaRecorder.onstop = async () => {
					if (this._disposed) return;

					try {
						await this._processRecording();
					} catch (error) {
						console.error("Failed to process recording:", error);
						this.onError?.(error);
					}
					this._setStatus("idle");
					this.onEnd?.();
				};

				this.mediaRecorder.start();
				this._setStatus("listening");
				this.onStart?.();
				return true;
			} catch (error) {
				console.error("Failed to start Vosk recognition:", error);
				this._setStatus("idle");
				this.onError?.(error);
				return false;
			} finally {
				this._startingPromise = null;
			}
		})();

		return this._startingPromise;
	}

	/**
	 * Stop listening and process the recording
	 * @returns {Promise<boolean>} true if stopped successfully
	 */
	async stop() {
		if (this.status === "idle") return true;

		if (this._stoppingPromise) return this._stoppingPromise;

		this._setStatus("stopping");

		this._stoppingPromise = (async () => {
			try {
				if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
					this.mediaRecorder.stop();

					await new Promise((resolve) => {
						const checkStop = () => {
							if (this.status === "idle") {
								resolve();
							} else {
								setTimeout(checkStop, 50);
							}
						};
						checkStop();
					});
				} else {
					this._setStatus("idle");
				}
				return true;
			} catch (error) {
				console.error("Failed to stop Vosk recognition:", error);
				this._setStatus("idle");
				return false;
			} finally {
				this._stoppingPromise = null;
			}
		})();

		return this._stoppingPromise;
	}

	/**
	 * Process recorded audio chunks and send to backend
	 * @private
	 */
	async _processRecording() {
		if (this.audioChunks.length === 0) {
			console.warn("No audio chunks to process");
			return;
		}

		const audioBlob = new Blob(this.audioChunks, { type: "audio/webm" });
		this.audioChunks = [];

		const pcmBlob = await this._convertToPcm(audioBlob);

		try {
			const userKey = localStorage.getItem("user_key");
			if (!userKey) {
				throw new Error("No user key found");
			}

			const response = await fetch("/api/voice-llm", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${userKey}`,
				},
				body: pcmBlob,
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.message || "Transcription failed");
			}

			const data = await response.json();
			const transcript = data.transcript?.toLowerCase().trim();

			if (transcript) {
				this.onResult?.(transcript);
			}
		} catch (error) {
			console.error("Failed to transcribe audio:", error);
			this.onError?.(error);
		}
	}

	/**
	 * Convert audio blob to raw PCM format (16kHz, mono, PCM16)
	 * @param {Blob} blob - Input audio blob
	 * @returns {Promise<Blob>} Raw PCM blob
	 * @private
	 */
	async _convertToPcm(blob) {
		const arrayBuffer = await blob.arrayBuffer();

		if (!this.audioContext) {
			this.audioContext = new (
				window.AudioContext || window.webkitAudioContext
			)({
				sampleRate: 16000,
			});
		}

		const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

		const channelData =
			audioBuffer.numberOfChannels === 1
				? audioBuffer.getChannelData(0)
				: this._mixToMono(audioBuffer);

		const targetSampleRate = 16000;
		const resampled =
			audioBuffer.sampleRate === targetSampleRate
				? channelData
				: this._resample(channelData, audioBuffer.sampleRate, targetSampleRate);

		// Convert Float32 to Int16 PCM
		const pcmBuffer = new ArrayBuffer(resampled.length * 2);
		const view = new DataView(pcmBuffer);
		let offset = 0;
		for (let i = 0; i < resampled.length; i++) {
			const s = Math.max(-1, Math.min(1, resampled[i]));
			const int16 = s < 0 ? s * 0x8000 : s * 0x7fff;
			view.setInt16(offset, int16, true);
			offset += 2;
		}

		return new Blob([pcmBuffer], { type: "application/octet-stream" });
	}

	/**
	 * Mix stereo to mono
	 * @private
	 */
	_mixToMono(audioBuffer) {
		const left = audioBuffer.getChannelData(0);
		const right = audioBuffer.getChannelData(1);
		const mono = new Float32Array(left.length);
		for (let i = 0; i < left.length; i++) {
			mono[i] = (left[i] + right[i]) / 2;
		}
		return mono;
	}

	/**
	 * Simple linear resampling
	 * @private
	 */
	_resample(samples, fromRate, toRate) {
		if (fromRate === toRate) return samples;
		const ratio = fromRate / toRate;
		const newLength = Math.round(samples.length / ratio);
		const result = new Float32Array(newLength);
		for (let i = 0; i < newLength; i++) {
			const srcIndex = i * ratio;
			const index = Math.floor(srcIndex);
			result[i] = samples[index];
		}
		return result;
	}

	/**
	 * Clean up resources
	 */
	dispose() {
		this._disposed = true;

		if (this.mediaRecorder) {
			if (this.mediaRecorder.state !== "inactive") {
				this.mediaRecorder.stop();
			}
			this.mediaRecorder = null;
		}
		if (this.mediaStream) {
			this.mediaStream.getTracks().forEach((track) => {
				track.stop();
			});
			this.mediaStream = null;
		}
		if (this.audioContext) {
			this.audioContext.close();
			this.audioContext = null;
		}
		this.audioChunks = [];
		this._setStatus("idle");
	}
}
