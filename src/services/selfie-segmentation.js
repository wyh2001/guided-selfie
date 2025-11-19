/*
AI usage disclosure: 

Around 70% of the code in this file is written with AI assistance,
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
		this.ctx = null;
		this.rafId = null;
		this.lastVideoTime = -1;
		this.effectType = "high-contrast"; // 'high-contrast' | 'blur' | 'none'
		this.interval = 0.15; // Default interval in seconds

		// Processing canvas for resizing input
		this.processingWidth = 256;
		this.processingHeight = 256;
		this.processingCanvas = null;
		this.processingCtx = null;
	}

	/**
	 * Initialize the image segmenter
	 * @param {Object} options - Configuration options
	 */
	async init(options = {}) {
		if (this.segmenter) {
			return this.segmenter;
		}

		// Initialize processing canvas
		this.processingCanvas = document.createElement("canvas");
		this.processingCanvas.width = this.processingWidth;
		this.processingCanvas.height = this.processingHeight;
		this.processingCtx = this.processingCanvas.getContext("2d", {
			willReadFrequently: true,
		});

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
	start(video, canvas, interval = 0.15) {
		if (!this.segmenter) {
			console.error("Segmenter not initialized");
			return;
		}
		this.video = video;
		this.canvas = canvas;
		this.ctx = this.canvas.getContext("2d");
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
		if (this.canvas && this.ctx) {
			this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
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
	loop() {
		if (!this.isRunning) return;

		const currentTime = this.video.currentTime;
		if (currentTime - this.lastVideoTime >= this.interval) {
			this.lastVideoTime = currentTime;
			const startTimeMs = performance.now();

			if (this.segmenter) {
				// Draw video to processing canvas
				this.processingCtx.drawImage(
					this.video,
					0,
					0,
					this.processingWidth,
					this.processingHeight,
				);

				const result = this.segmenter.segmentForVideo(
					this.processingCanvas,
					startTimeMs,
				);
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
		if (!this.canvas || !this.video || !this.ctx) return;
		const ctx = this.ctx;
		const width = this.video.videoWidth;
		const height = this.video.videoHeight;

		if (!width || !height) return;

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
			this.drawHighContrastOnProcessing(mask);
			// Draw the processed small canvas scaled up to the main canvas
			ctx.imageSmoothingEnabled = true;
			ctx.drawImage(
				this.processingCanvas,
				0,
				0,
				this.processingWidth,
				this.processingHeight,
				0,
				0,
				width,
				height,
			);
		} else if (this.effectType === "blur") {
			// TBD
			ctx.drawImage(this.video, 0, 0, width, height);
		} else {
			ctx.drawImage(this.video, 0, 0, width, height);
		}
	}

	/**
	 * Draw high contrast overlay on the processing canvas (256x256)
	 * @param {SegmentationMask} mask
	 */
	drawHighContrastOnProcessing(mask) {
		const ctxSmall = this.processingCtx;
		const w = this.processingWidth;
		const h = this.processingHeight;

		// Get the video data from the processing canvas (already drawn in loop)
		const imageData = ctxSmall.getImageData(0, 0, w, h);
		const pixels = imageData.data;

		// Get mask data as floats (0.0 to 1.0)
		const maskData = mask.getAsFloat32Array();

		const len = w * h;

		// Person Overlay: Gold
		const personR = 255;
		const personG = 215;
		const personB = 0;
		const personAlpha = 0.9;

		// Background Overlay: Black
		const bgR = 0;
		const bgG = 0;
		const bgB = 0;
		const bgAlpha = 1.0;

		for (let i = 0; i < len; ++i) {
			const score = maskData[i]; // 0.0 (background) to 1.0 (person)
			const isPerson = score;
			const isBackground = 1 - score;

			// Interpolate overlay color and alpha based on the mask score
			const targetR = isPerson * personR + isBackground * bgR;
			const targetG = isPerson * personG + isBackground * bgG;
			const targetB = isPerson * personB + isBackground * bgB;
			const targetAlpha = isPerson * personAlpha + isBackground * bgAlpha;

			const offset = i * 4;

			const srcR = pixels[offset];
			const srcG = pixels[offset + 1];
			const srcB = pixels[offset + 2];

			// Apply blending
			pixels[offset] = srcR * (1 - targetAlpha) + targetR * targetAlpha; // R
			pixels[offset + 1] = srcG * (1 - targetAlpha) + targetG * targetAlpha; // G
			pixels[offset + 2] = srcB * (1 - targetAlpha) + targetB * targetAlpha; // B
		}

		ctxSmall.putImageData(imageData, 0, 0);
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
