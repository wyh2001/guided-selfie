/*
AI usage disclosure: 

Around 65% of the code in this file is written with AI assistance,
especially the part involving overlay effect implementation.

*/
import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

const DEFAULT_MODEL =
	"https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
const DEFAULT_WASM =
	"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

export class SelfieSegmentation {
	constructor() {
		this.segmenter = null;
		this.mode = null;
		this.isRunning = false;
		this.video = null;
		this.canvas = null;
		this.rafId = null;
		this.lastVideoTime = -1;
		this.effectType = "high-contrast"; // 'high-contrast' | 'blur' | 'none'
		this.interval = 0.1; // Default interval in seconds
	}

	/**
	 * Initialize the image segmenter
	 * @param {Object} options - Configuration options
	 */
	async init(options = {}) {
		if (this.segmenter) {
			return this.segmenter;
		}

		this.mode = options.runningMode ?? "VIDEO";
		const vision = await FilesetResolver.forVisionTasks(
			options.wasmPath ?? DEFAULT_WASM,
		);

		this.segmenter = await ImageSegmenter.createFromOptions(vision, {
			baseOptions: {
				modelAssetPath: options.modelAssetPath ?? DEFAULT_MODEL,
				delegate: options.delegate ?? "GPU",
			},
			runningMode: this.mode,
			outputCategoryMask: false,
			outputConfidenceMasks: true,
		});

		return this.segmenter;
	}

	/**
	 * Start segmentation loop
	 * @param {HTMLVideoElement} video
	 * @param {HTMLCanvasElement} canvas
	 * @param {number} interval - Update interval in seconds
	 */
	start(video, canvas, interval = 0.1) {
		if (!this.segmenter) {
			console.error("Segmenter not initialized");
			return;
		}
		this.video = video;
		this.canvas = canvas;
		this.interval = interval;
		this.isRunning = true;
		this.loop();
	}

	/**
	 * Stop segmentation loop
	 */
	stop() {
		this.isRunning = false;
		if (this.rafId) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		// Clear canvas
		if (this.canvas) {
			const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
			ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		}
	}

	/**
	 * Set the overlay effect type
	 * @param {string} effect - 'high-contrast' | 'blur' | 'none'
	 */
	setEffect(effect) {
		this.effectType = effect;
	}

	/**
	 * Main segmentation loop
	 */
	async loop() {
		if (!this.isRunning) return;

		const currentTime = this.video.currentTime;
		if (currentTime - this.lastVideoTime >= this.interval) {
			this.lastVideoTime = currentTime;
			const startTimeMs = performance.now();

			if (this.segmenter) {
				const result = this.segmenter.segmentForVideo(this.video, startTimeMs);
				this.draw(result);
			}
		}

		this.rafId = requestAnimationFrame(() => this.loop());
	}

	/**
	 * Draw the segmentation result with overlay effect
	 * @param {ImageSegmenterResult} result
	 */
	draw(result) {
		if (!this.canvas || !this.video) return;
		const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
		const width = this.video.videoWidth;
		const height = this.video.videoHeight;

		if (this.canvas.width !== width || this.canvas.height !== height) {
			this.canvas.width = width;
			this.canvas.height = height;
		}

		let mask = null;
		if (result.confidenceMasks && result.confidenceMasks.length > 0) {
			if (result.confidenceMasks.length > 1) {
				mask = result.confidenceMasks[1];
			} else {
				mask = result.confidenceMasks[0];
			}
		}

		if (!mask) return;

		if (this.effectType === "high-contrast") {
			this.drawHighContrast(ctx, mask, width, height);
		} else if (this.effectType === "blur") {
			// TBD
			ctx.drawImage(this.video, 0, 0, width, height);
		} else {
			ctx.drawImage(this.video, 0, 0, width, height);
		}
	}

	/**
	 * Draw high contrast overlay
	 * @param {CanvasRenderingContext2D} ctx
	 * @param {SegmentationMask} mask
	 * @param {number} width
	 * @param {number} height
	 */
	drawHighContrast(ctx, mask, width, height) {
		// Draw the video frame first
		ctx.drawImage(this.video, 0, 0, width, height);

		// Get the video data
		const imageData = ctx.getImageData(0, 0, width, height);
		const pixels = imageData.data;

		// Get mask data as floats (0.0 to 1.0)
		const maskData = mask.getAsFloat32Array();

		for (let i = 0; i < maskData.length; ++i) {
			const score = maskData[i]; // 0.0 (background) to 1.0 (person)
			const offset = i * 4;

			const isPerson = score;
			const isBackground = 1 - score;

			// Person Overlay: Gold
			const personR = 255;
			const personG = 215;
			const personB = 0;
			const personAlpha = 0.9; // Keep slight detail

			// Background Overlay: Black
			const bgR = 0;
			const bgG = 0;
			const bgB = 0;
			const bgAlpha = 1.0;

			// Interpolate overlay color and alpha based on the mask score
			const targetR = isPerson * personR + isBackground * bgR;
			const targetG = isPerson * personG + isBackground * bgG;
			const targetB = isPerson * personB + isBackground * bgB;
			const targetAlpha = isPerson * personAlpha + isBackground * bgAlpha;

			// Apply blending
			pixels[offset] =
				pixels[offset] * (1 - targetAlpha) + targetR * targetAlpha; // R
			pixels[offset + 1] =
				pixels[offset + 1] * (1 - targetAlpha) + targetG * targetAlpha; // G
			pixels[offset + 2] =
				pixels[offset + 2] * (1 - targetAlpha) + targetB * targetAlpha; // B
		}

		ctx.putImageData(imageData, 0, 0);
	}

	/**
	 * Dispose the segmenter and free resources
	 */
	dispose() {
		this.stop();
		if (this.segmenter) {
			this.segmenter.close();
			this.segmenter = null;
		}
	}
}
