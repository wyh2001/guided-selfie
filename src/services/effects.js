/* 
Extracted from main.js into this module for better readability with GitHub Copilot's help.
*/
export class EffectsController {
	constructor(ctx) {
		this.segmentationService = ctx.segmentationService;
		this.video = ctx.videoEl;
		this.canvas = ctx.canvasEl;
		this.statusEl = ctx.statusEl;
		this.isHighContrastOn = false;
		this.isBlurOn = false;
	}

	_ensureInitialized() {
		if (!this.segmentationService.segmenter) {
			return this.segmentationService.init();
		}
	}

	_syncLoop() {
		const shouldRun = this.isHighContrastOn || this.isBlurOn;
		if (shouldRun && !this.segmentationService.isRunning) {
			this.segmentationService.start(this.video, this.canvas);
		} else if (!shouldRun && this.segmentationService.isRunning) {
			this.segmentationService.stop();
		}
	}

	async setHighContrast(on) {
		if (this.isHighContrastOn === on) return;
		this.isHighContrastOn = !!on;
		try {
			if (this.isHighContrastOn) {
				this.statusEl.textContent = "Initializing high contrast mode...";
				await this._ensureInitialized();
			}
			this.segmentationService.setOverlay(
				this.isHighContrastOn ? "high-contrast" : "none",
			);
			this._syncLoop();
			if (this.isHighContrastOn) {
				this.statusEl.textContent = "High contrast mode enabled";
			} else {
				this.statusEl.textContent = "High contrast mode disabled";
			}
			window.dispatchEvent(
				new CustomEvent("effects:contrast-changed", {
					detail: { enabled: this.isHighContrastOn },
				}),
			);
		} catch (e) {
			console.error("Failed to toggle high contrast", e);
			this.isHighContrastOn = false;
			this.segmentationService.setOverlay("none");
			this._syncLoop();
			this.statusEl.textContent = "Failed to toggle high contrast";
		}
	}

	async setBlur(on) {
		if (this.isBlurOn === on) return;
		this.isBlurOn = !!on;
		try {
			if (this.isBlurOn) {
				await this._ensureInitialized();
			}
			this.segmentationService.enableBlur(this.isBlurOn);
			this._syncLoop();
			this.statusEl.textContent = this.isBlurOn
				? "Background blur enabled"
				: "Background blur disabled";
			window.dispatchEvent(
				new CustomEvent("effects:blur-changed", {
					detail: { enabled: this.isBlurOn },
				}),
			);
		} catch (e) {
			console.error("Failed to toggle blur", e);
			this.isBlurOn = !on ? false : this.isBlurOn; // keep consistent
			this.segmentationService.enableBlur(this.isBlurOn);
			this._syncLoop();
			this.statusEl.textContent = "Failed to toggle blur";
			throw e;
		}
	}

	previewUsesCanvas() {
		return this.isHighContrastOn || this.isBlurOn;
	}

	getState() {
		return { highContrast: this.isHighContrastOn, blur: this.isBlurOn };
	}
}
