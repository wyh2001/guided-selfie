/* AI usage disclosure: 

Around 50% of the code in this file is written with AI assistance
(up till when the commit with this disclosure is pushed).

The overall structure is designed and developed by human.

GitHub Copilot is used to generate the initial HTML and the CSS, then modified to fit the desired style.

Some autocomplete suggestions given by GitHub Copilot's are taken, especially for
those repeated code patterns.

ChatGPT is used to give suggestions about how to refactor the state management, and
the statemachine pattern is written with the help of GitHub Copilot. 

This disclosure itself is written by human, but some autocomplete suggestions 
given by GitHub Copilot are taken.

This will be updated over time when the project evolves.

*/
import "./style.css";
import { z } from "zod";
import { fetchBackendStatus } from "./services/backend-config.js";
import { performCapture as sharedPerformCapture } from "./services/capture-flow.js";
import { EffectsController } from "./services/effects.js";
import { FaceDetect } from "./services/face-detect.js";
import { LLMService } from "./services/llm-service.js";
import { PhotoCapture } from "./services/photo-capture.js";
import { PhotoStore } from "./services/photo-store.js";
import { SpeechManager } from "./services/SpeechManager.js";
import { SelfieSegmentation } from "./services/selfie-segmentation.js";
import { setupSpeechControlUI } from "./services/speech-control-ui.js";
import { ToolManager } from "./services/tool-manager.js";

// ?key=... -> localStorage('user_key'), then clean URL
// Temporary solution, should be done in more secure way
(function applyMagicKeyFromURL() {
	try {
		const url = new URL(window.location.href);
		const rawKey = url.searchParams.get("key");
		const v = rawKey?.trim();
		if (v) {
			try {
				localStorage.setItem("user_key", v);
			} catch (_) {}
			url.searchParams.delete("key");
			const qs = url.searchParams.toString();
			const cleanPath = url.pathname + (qs ? `?${qs}` : "") + url.hash;
			window.history.replaceState({}, "", cleanPath);
		}
	} catch (_) {}
})();

// Warm backend to avoid cold-start delays
(async function warmBackendStatusIfKey() {
	try {
		const key = localStorage.getItem("user_key");
		if (!key) return;
		const status = await fetchBackendStatus();
		if (!status?.enabled) {
			console.warn("[backend-status] Unexpected status", status);
		}
	} catch (error) {
		console.warn("[backend-status] Warm-up failed", error);
	}
})();

const app = document.querySelector("#app");
const photoService = new PhotoCapture();
const photoStore = new PhotoStore();
const faceService = new FaceDetect();
const segmentationService = new SelfieSegmentation();
const toolManager = new ToolManager();
const llmService = new LLMService();

// Initialize speech services
const speechManager = new SpeechManager();
speechManager.enableTTS(true);

app.innerHTML = `
  <main class="capture">
    <section class="preview">
      <div class="video-placeholder">Awaiting camera…</div>
      <video autoplay playsinline hidden></video>
      <canvas id="segmentation-canvas" hidden aria-label="High contrast video preview"></canvas>
      <img alt="snapshot" hidden />
    </section>
    <section class="actions">
    </section>
    <p class="status" hidden></p>
	<p class="debug" hidden></p>
  </main>
  <section class="album-view" hidden>
    <header class="album-header">
      <button type="button" data-action="back-to-camera" aria-label="Back to camera">Back</button>
      <button type="button" class="album-delete-btn" data-action="delete-photo" aria-label="Delete current photo">Delete</button>
    </header>
    <div class="album-viewer">
      <div class="album-placeholder" role="status" hidden>
        <p>No photos yet</p>
        <p>Take a photo to get started</p>
      </div>
      <button type="button" class="album-nav-btn album-prev" data-action="prev-photo" aria-label="Previous photo">‹</button>
      <img class="album-photo" alt="Photo">
      <button type="button" class="album-nav-btn album-next" data-action="next-photo" aria-label="Next photo">›</button>
      <div class="album-counter" role="status" aria-live="polite"></div>
    </div>
  </section>
    <div class="bottom-bar" role="toolbar" aria-label="Camera controls">
      <button
        type="button"
        class="album-button"
        data-action="album"
        aria-label="Open album"
      ></button>
      <button
        type="button"
        class="capture-button"
        data-action="capture"
        aria-label="Take photo"
      ></button>
      <button
        type="button"
        class="mode-toggle-button"
        data-action="toggle-mode"
        aria-label="Toggle control mode"
		aria-pressed="false"
        title="Switch between Simple Mode and Voice Control Mode"
      >GUIDE</button>
    </div>
`;

const video = app.querySelector("video");
const canvas = app.querySelector("#segmentation-canvas");
const photo = app.querySelector("img");
const captureBtn = app.querySelector('[data-action="capture"]');
const status = app.querySelector(".status");
const debug = app.querySelector(".debug");
const placeholder = app.querySelector(".video-placeholder");

const preview = app.querySelector(".preview");
const albumBtn = app.querySelector(".album-button");
const albumView = app.querySelector(".album-view");
const albumPhoto = app.querySelector(".album-photo");
const albumCounter = app.querySelector(".album-counter");
const albumPlaceholder = app.querySelector(".album-placeholder");
const prevBtn = app.querySelector('[data-action="prev-photo"]');
const nextBtn = app.querySelector('[data-action="next-photo"]');
const backBtn = app.querySelector('[data-action="back-to-camera"]');
const deleteBtn = app.querySelector('[data-action="delete-photo"]');
const captureView = app.querySelector(".capture");
const modeToggleBtn = app.querySelector('[data-action="toggle-mode"]');

const speechControlBar = setupSpeechControlUI(speechManager);
const contrastBtn = document.getElementById("contrastToggle");
const blurBtn = document.getElementById("blurToggle");

// false = Simple Mode, true = Voice Control Mode
// Enable Voice Control Mode if user_key is set
let isVoiceControlMode = (() => {
	try {
		return !!localStorage.getItem("user_key");
	} catch (_) {
		return false;
	}
})();

if (isVoiceControlMode) {
	modeToggleBtn.textContent = "VOICE";
	modeToggleBtn.classList.add("voice-mode");
	modeToggleBtn.setAttribute("aria-pressed", "true");
	speechManager.enableVADMode();
}

albumPhoto.addEventListener("error", () => {
	console.warn("Failed to load image:", albumPhoto.src);
});

const faceBoxElements = [];
/**
 * Array of stored photos. Each entry is an object { id: number, url: string, createdAt: number }
 * @type {Array<{id: number, url: string, createdAt: number}>}
 */
const storedPhotos = [];
let currentPhotoIndex = 0;
const effectsCtx = {
	segmentationService,
	videoEl: video,
	canvasEl: canvas,
	statusEl: status,
};
const effects = new EffectsController(effectsCtx);

const captureCtx = {
	effects,
	segmentationService,
	photoService,
	photoStore,
	statusEl: status,
	storedPhotos,
	refreshAlbumThumbnail,
};

const defaultPlaceholderText = placeholder.textContent;
let isGuidingActive = false;
let stopGuidingCallback = null;

const setVisible = (element, visible) => {
	if (!element) {
		return;
	}
	element.hidden = !visible;
	element.setAttribute("aria-hidden", !visible);
};

const State = {
	LOADING: "loading",
	CAMERA_READY: "camera_ready",
	READY: "ready",
	ERROR: "error",
	ALBUM_EMPTY: "album_empty",
	ALBUM_NOT_EMPTY: "album_not_empty",
};

const stateView = {
	[State.LOADING]: {
		video: false,
		photo: false,
		placeholder: true,
		capture: false,
		captureView: true,
		albumView: false,
		placeholderText: defaultPlaceholderText,
		message: "Awaiting camera…",
	},
	[State.CAMERA_READY]: {
		video: true,
		photo: false,
		placeholder: false,
		capture: false,
		captureView: true,
		albumView: false,
		placeholderText: defaultPlaceholderText,
		message: "Initializing face detector...",
	},
	[State.READY]: {
		video: true,
		photo: false,
		placeholder: false,
		capture: true,
		captureView: true,
		albumView: false,
		placeholderText: defaultPlaceholderText,
		message: "Look at the camera",
	},
	[State.ERROR]: {
		video: false,
		photo: false,
		placeholder: true,
		capture: false,
		captureView: true,
		albumView: false,
		placeholderText: "Camera unavailable",
		message: "Camera unavailable",
	},
	[State.ALBUM_EMPTY]: {
		video: false,
		photo: false,
		placeholder: false,
		capture: false,
		captureView: false,
		albumView: true,
		placeholderText: defaultPlaceholderText,
		message: "No photos yet",
	},
	[State.ALBUM_NOT_EMPTY]: {
		video: false,
		photo: false,
		placeholder: false,
		capture: false,
		captureView: false,
		albumView: true,
		placeholderText: defaultPlaceholderText,
		message: "Browse your photos",
	},
};

const updatePreviewVisibility = () => {
	const useCanvas = effects.previewUsesCanvas();
	setVisible(video, !useCanvas);
	setVisible(canvas, useCanvas);
};

const setState = (state, overrideMessage) => {
	const view = stateView[state];
	if (!view) {
		return;
	}

	if (state !== State.READY) {
		stopGuidanceIfAny();
	}

	switch (state) {
		case State.LOADING:
		case State.CAMERA_READY:
			break;
		case State.READY:
			faceService.stop();
			faceService.start(video, handleDetections, (error) => {
				console.error("Face detection error:", error);
			});
			break;
		case State.ERROR:
			debug.textContent = "";
			faceService.stop();
			faceBoxElements.forEach((e) => void e.remove());
			faceBoxElements.length = 0;
			break;
		case State.ALBUM_EMPTY:
			currentPhotoIndex = 0;
			faceService.stop();
			setAlbumVisibility(false);
			break;
		case State.ALBUM_NOT_EMPTY:
			faceService.stop();
			if (storedPhotos.length === 0) {
				setAlbumVisibility(false);
				break;
			}
			setAlbumVisibility(true);
			updateAlbumPhoto();
			break;
	}

	setVisible(captureView, view.captureView);
	setVisible(albumView, view.albumView);
	setVisible(video, view.video);
	setVisible(canvas, view.video);
	if (view.video) {
		updatePreviewVisibility();
	}
	setVisible(photo, view.photo);
	setVisible(placeholder, view.placeholder);

	captureBtn.disabled = !view.capture;
	setVisible(captureBtn, !view.albumView);
	setVisible(albumBtn, !view.albumView);
	setVisible(speechControlBar, !view.albumView);

	placeholder.textContent = view.placeholderText;
	status.textContent = overrideMessage ?? view.message;
};

setState(State.LOADING, "Awaiting camera…");

async function setupCamera() {
	try {
		const stream = await photoService.init();
		video.srcObject = stream;

		if (photoService.getFacingMode() === "user") {
			video.style.transform = "scaleX(-1)";
			canvas.style.transform = "scaleX(-1)";
		} else {
			video.style.transform = "none";
			canvas.style.transform = "none";
		}

		setState(State.CAMERA_READY);
		await faceService.init();
		setState(State.READY, "Look at the camera");
	} catch (error) {
		setState(State.ERROR, `Camera unavailable: ${error.message}`);
	}
}

async function loadStoredPhotos() {
	try {
		const items = await photoStore.getAllPhotos();
		// Ensure stable order regardless of backend/index implementation
		items.sort((a, b) => a.createdAt - b.createdAt);
		items.forEach((item) => {
			const url = URL.createObjectURL(item.blob);
			storedPhotos.push({ id: item.id, url, createdAt: item.createdAt });
		});
		refreshAlbumThumbnail();
	} catch (error) {
		console.error("Failed to load stored photos:", error);
	}
}

function handleDetections(detections) {
	const videoWidth = video.videoWidth;
	const videoHeight = video.videoHeight;

	// Sort detections by size (area) descending so the largest face is first
	detections.sort((a, b) => {
		const areaA = a.boundingBox.width * a.boundingBox.height;
		const areaB = b.boundingBox.width * b.boundingBox.height;
		return areaB - areaA;
	});

	debug.textContent = generateDebugInfo(detections, videoWidth, videoHeight);
	drawFaceBoxes(detections, videoWidth, videoHeight);
	const evals = evaluateFacePosition(detections, videoWidth, videoHeight);
	evals.forEach((evaluation, index) => {
		debug.textContent += `Face ${index + 1}: position: ${evaluation.positions.join("-")}, distance: ${evaluation.distance}\n`;
	});
	guideUser(evals, detections.length);
}

// https://ai.google.dev/edge/api/mediapipe/js/tasks-vision.boundingbox
function computeDetectionContext(detection, videoWidth, videoHeight) {
	const boundingBox = detection.boundingBox;
	const normalizedCenterX =
		1 - (boundingBox.originX + boundingBox.width / 2) / videoWidth;
	const normalizedCenterY =
		(boundingBox.originY + boundingBox.height / 2) / videoHeight;
	const normalizedSize =
		(boundingBox.width * boundingBox.height) / (videoWidth * videoHeight);
	const normalizedWidth = boundingBox.width / videoWidth;
	const normalizedHeight = boundingBox.height / videoHeight;
	const angle = boundingBox.angle;
	const keypoints = detection.keypoints.map((keypoint) => ({
		x: keypoint.x,
		y: keypoint.y,
	}));
	return {
		normalizedCenterX,
		normalizedCenterY,
		normalizedSize,
		normalizedWidth,
		normalizedHeight,
		angle,
		keypoints,
	};
}

function generateDebugInfo(detections, videoWidth, videoHeight) {
	let debugInfo = `Video size: ${videoWidth}x${videoHeight}\n`;

	detections.forEach((detection, index) => {
		const {
			normalizedCenterX,
			normalizedCenterY,
			normalizedSize,
			normalizedWidth,
			normalizedHeight,
			angle,
			keypoints,
		} = computeDetectionContext(detection, videoWidth, videoHeight);
		debugInfo += `Detect face ${index + 1} at [${normalizedCenterX.toFixed(2)}, `;
		debugInfo += `${normalizedCenterY.toFixed(2)}] `;
		debugInfo += `with size ${normalizedSize.toFixed(2)}, `;
		debugInfo += `width ${normalizedWidth.toFixed(2)}, `;
		debugInfo += `height ${normalizedHeight.toFixed(2)} `;
		debugInfo += `and angle ${angle}\n`;
		debugInfo += `Keypoints:\n`;
		keypoints.forEach((keypoint, kpIndex) => {
			const x = keypoint.x;
			const y = keypoint.y;
			debugInfo += `keypoint ${kpIndex + 1} at [${x.toFixed(2)}, ${y.toFixed(2)}]\n`;
		});
	});
	return debugInfo;
}

// Refers to the official MediaPipe Face Detection demo: https://codepen.io/mediapipe-preview/pen/OJByWQr
function drawFaceBoxes(detections, videoWidth, videoHeight) {
	faceBoxElements.forEach((e) => void e.remove());
	faceBoxElements.length = 0;
	const ratio = preview.clientWidth / videoWidth;

	detections.forEach((detection) => {
		const boundingBox = detection.boundingBox;
		const faceBoxElement = document.createElement("div");
		faceBoxElement.className = "face-box";
		faceBoxElement.style.left = `${(videoWidth - (boundingBox.originX + boundingBox.width)) * ratio}px`;
		faceBoxElement.style.top = `${boundingBox.originY * ratio}px`;
		faceBoxElement.style.width = `${boundingBox.width * ratio}px`;
		faceBoxElement.style.height = `${boundingBox.height * ratio}px`;
		preview.appendChild(faceBoxElement);
		faceBoxElements.push(faceBoxElement);

		const keypoints = detection.keypoints;
		keypoints.forEach((keypoint, index) => {
			const keypointElement = document.createElement("div");
			keypointElement.className = "key-point";
			keypointElement.style.top = `${keypoint.y * videoHeight * ratio}px`;
			keypointElement.style.left = `${(1 - keypoint.x) * videoWidth * ratio}px`;
			keypointElement.textContent = index + 1;
			preview.appendChild(keypointElement);
			faceBoxElements.push(keypointElement);
		});
	});
}

// album helper functions
function refreshAlbumThumbnail() {
	if (storedPhotos.length === 0) {
		albumBtn.style.backgroundImage = "none";
		return;
	}
	const latestPhotoURL = storedPhotos[storedPhotos.length - 1].url;
	albumBtn.style.backgroundImage = `url(${latestPhotoURL})`;
}

function setAlbumVisibility(hasPhotos) {
	setVisible(albumPlaceholder, !hasPhotos);
	setVisible(albumPhoto, hasPhotos);
	setVisible(prevBtn, hasPhotos);
	setVisible(nextBtn, hasPhotos);
	setVisible(albumCounter, hasPhotos);
	if (!hasPhotos) {
		albumPhoto.removeAttribute("src");
		albumPhoto.alt = "";
		albumCounter.textContent = "";
		prevBtn.disabled = true;
		nextBtn.disabled = true;
	}
}

function updateAlbumPhoto() {
	if (storedPhotos.length === 0) {
		return;
	}
	if (currentPhotoIndex < 0) currentPhotoIndex = 0;
	if (currentPhotoIndex > storedPhotos.length - 1)
		currentPhotoIndex = storedPhotos.length - 1;

	const actualIndex = storedPhotos.length - 1 - currentPhotoIndex;
	const { url, createdAt } = storedPhotos[actualIndex];
	albumPhoto.src = url;
	albumPhoto.alt = `Photo ${currentPhotoIndex + 1} taken at ${new Date(createdAt).toLocaleString()}`;
	albumCounter.textContent = `${currentPhotoIndex + 1} / ${storedPhotos.length}`;
	prevBtn.disabled = currentPhotoIndex === 0;
	nextBtn.disabled = currentPhotoIndex === storedPhotos.length - 1;
}

function initializeAlbumView(startIndex = 0) {
	if (storedPhotos.length === 0) {
		currentPhotoIndex = 0;
		setState(State.ALBUM_EMPTY);
		return;
	}
	currentPhotoIndex = startIndex;
	if (currentPhotoIndex < 0) currentPhotoIndex = 0;
	if (currentPhotoIndex > storedPhotos.length - 1)
		currentPhotoIndex = storedPhotos.length - 1;
	setState(State.ALBUM_NOT_EMPTY);
}

const facePosition = {
	CENTERED: "centered",
	LEFT: "left",
	RIGHT: "right",
	BOTTOM: "bottom",
	TOP: "top",
};

const faceDistance = {
	CLOSE: "close",
	FAR: "far",
	NORMAL: "normal",
};

function evaluateFacePosition(detections, videoWidth, videoHeight) {
	if (detections.length === 0) {
		return [];
	}
	const evals = [];
	detections.forEach((detection) => {
		const { normalizedCenterX, normalizedCenterY, normalizedSize } =
			computeDetectionContext(detection, videoWidth, videoHeight);

		const positions = [];
		const horizontalOffsetThreshold = 0.1;
		const positionTopThreshold = 0.5;
		const positionBottomThreshold = 0.65;
		if (normalizedCenterX < 0.5 - horizontalOffsetThreshold) {
			positions.push(facePosition.LEFT);
		} else if (normalizedCenterX > 0.5 + horizontalOffsetThreshold) {
			positions.push(facePosition.RIGHT);
		}
		if (normalizedCenterY < positionTopThreshold) {
			positions.push(facePosition.TOP);
		} else if (normalizedCenterY > positionBottomThreshold) {
			positions.push(facePosition.BOTTOM);
		}

		if (positions.length === 0) {
			positions.push(facePosition.CENTERED);
		}

		let distance = faceDistance.NORMAL;
		const sizeCloseThreshold = 0.17;
		const sizeFarThreshold = 0.09;
		if (normalizedSize > sizeCloseThreshold) {
			distance = faceDistance.CLOSE;
		} else if (normalizedSize < sizeFarThreshold) {
			distance = faceDistance.FAR;
		}

		evals.push({ positions, distance });
	});
	return evals;
}

let lastGuidanceTime = 0;
let lastGuidanceState = null;
const GUIDANCE_INTERVAL = 4000;
let isProcessingCommand = false;
let lastLlmSpeakEndedAt = 0;

function stopGuidanceIfAny() {
	if (isGuidingActive && typeof stopGuidingCallback === "function") {
		try {
			stopGuidingCallback();
		} catch (_) {}
	}
}

function guideUser(evals, faceCount) {
	if (evals.length === 0) {
		return;
	}

	// In Voice Control Mode, disable auto-guidance (guidance can still be called)
	if (isVoiceControlMode) {
		return;
	}

	// If user is currently speaking/listening, or LLM is processing, DO NOT interrupt with guidance
	if (
		speechManager.isListening() ||
		speechManager.isSpeakingNow() ||
		isProcessingCommand
	) {
		return;
	}

	// Cooldown after LLM finished speaking
	const now = Date.now();
	if (now - lastLlmSpeakEndedAt < 500) {
		return;
	}

	const evaluation = evals[0];
	const positions = evaluation.positions;
	const distance = evaluation.distance;

	// Check if centered and proper distance
	if (
		positions.includes(facePosition.CENTERED) &&
		distance === faceDistance.NORMAL
	) {
		if (lastGuidanceState !== "centered") {
			let message = "Perfect. Ready to take a photo.";
			if (faceCount > 1) {
				message += " I also see other people in the frame.";
			}
			speechManager.speak(message);
			lastGuidanceState = "centered";
			lastGuidanceTime = Date.now();
		}
		return;
	}

	if (now - lastGuidanceTime < GUIDANCE_INTERVAL) {
		return;
	}

	let message = "";

	// Priority 1: Distance
	if (distance === faceDistance.CLOSE) {
		message = "Move phone away";
	} else if (distance === faceDistance.FAR) {
		message = "Move phone closer";
	}
	// Priority 2: Vertical
	else if (positions.includes(facePosition.TOP)) {
		message = "Point phone up";
	} else if (positions.includes(facePosition.BOTTOM)) {
		message = "Point phone down";
	}
	// Priority 3: Horizontal
	else if (positions.includes(facePosition.LEFT)) {
		message = "Turn phone left";
	} else if (positions.includes(facePosition.RIGHT)) {
		message = "Turn phone right";
	}

	if (message) {
		speechManager.speak(message);
		lastGuidanceState = message;
		lastGuidanceTime = now;
	}
}

captureBtn.addEventListener("click", () => {
	stopGuidanceIfAny();
	sharedPerformCapture(captureCtx);
});

contrastBtn.addEventListener("click", async () => {
	const target = !effects.isHighContrastOn;
	await effects.setHighContrast(target);
	updatePreviewVisibility();
});

blurBtn.addEventListener("click", async () => {
	const target = !effects.isBlurOn;
	await effects.setBlur(target);
	updatePreviewVisibility();
});

window.addEventListener("effects:blur-changed", (event) => {
	const enabled = !!event.detail?.enabled;
	blurBtn.setAttribute("aria-pressed", enabled);
	blurBtn.textContent = enabled ? "Blur: On" : "Blur: Off";
	blurBtn.classList.toggle("active", enabled);
	updatePreviewVisibility();
});

window.addEventListener("effects:contrast-changed", (event) => {
	const enabled = !!event.detail?.enabled;
	contrastBtn.setAttribute("aria-pressed", enabled);
	contrastBtn.textContent = enabled ? "Contrast: On" : "Contrast: Off";
	contrastBtn.classList.toggle("active", enabled);
	updatePreviewVisibility();
});

albumBtn.addEventListener("click", () => {
	stopGuidanceIfAny();
	initializeAlbumView(0);
});

modeToggleBtn.addEventListener("click", () => {
	stopGuidanceIfAny();
	isVoiceControlMode = !isVoiceControlMode;

	if (isVoiceControlMode) {
		modeToggleBtn.textContent = "VOICE";
		modeToggleBtn.classList.add("voice-mode");
		modeToggleBtn.setAttribute("aria-pressed", "true");
		speechManager.enableVADMode();
	} else {
		modeToggleBtn.textContent = "GUIDE";
		modeToggleBtn.classList.remove("voice-mode");
		modeToggleBtn.setAttribute("aria-pressed", "false");
		speechManager.disableVADMode();
	}
});

backBtn.addEventListener("click", () => {
	setState(State.READY, "Look at the camera");
});

prevBtn.addEventListener("click", () => {
	if (currentPhotoIndex > 0) {
		currentPhotoIndex--;
		updateAlbumPhoto();
	}
});

nextBtn.addEventListener("click", () => {
	if (currentPhotoIndex < storedPhotos.length - 1) {
		currentPhotoIndex++;
		updateAlbumPhoto();
	}
});

deleteBtn.addEventListener("click", async () => {
	if (storedPhotos.length === 0) {
		return;
	}

	const confirmDelete = confirm(
		"Delete this photo permanently? This action cannot be undone.",
	);
	if (!confirmDelete) {
		return;
	}

	const actualIndex = storedPhotos.length - 1 - currentPhotoIndex;
	const { id, url } = storedPhotos[actualIndex];
	try {
		if (id !== undefined) {
			await photoStore.deletePhoto(id);
		}
	} catch (err) {
		console.error("Failed to delete photo from storage:", err);
	}
	try {
		URL.revokeObjectURL(url);
	} catch (_) {}
	storedPhotos.splice(actualIndex, 1);

	if (storedPhotos.length === 0) {
		currentPhotoIndex = 0;
		setState(State.ALBUM_EMPTY);
		refreshAlbumThumbnail();
		return;
	}
	if (currentPhotoIndex > storedPhotos.length - 1) {
		currentPhotoIndex = storedPhotos.length - 1;
	}
	refreshAlbumThumbnail();
	setState(State.ALBUM_NOT_EMPTY);
});

window.addEventListener("beforeunload", () => {
	photoService.dispose();
	faceService.dispose();
	segmentationService.dispose();
	video.srcObject = null;
	storedPhotos.forEach(({ url }) => {
		URL.revokeObjectURL(url);
	});
});

(async () => {
	await loadStoredPhotos();
	setupCamera();
})();

// Register Tools
toolManager.registerTool(
	"take_photo",
	"Take one or more photos with optional delay",
	z.object({
		count: z.number().describe("Number of photos to take").default(1),
		delay: z.number().describe("Delay in seconds before each photo").default(0),
	}),
	async ({ count = 1, delay = 0 }) => {
		console.log(`Taking ${count} photos with ${delay}s delay`);
		for (let i = 0; i < count; i++) {
			if (delay > 0) {
				await new Promise((resolve) => setTimeout(resolve, delay * 1000));
			}
			await sharedPerformCapture(captureCtx);
		}
		return "Photos taken";
	},
);

toolManager.registerTool(
	"set_blur",
	"Turn background blur on or off explicitly. You MUST always pass the boolean 'enable' argument to be true or false. You MUST NEVER leave it undefined.",
	z.object({
		enable: z
			.boolean()
			.describe(
				"True to turn background blur ON, false to turn it OFF. This field is REQUIRED and must NEVER be omitted.",
			),
	}),
	async ({ enable }) => {
		console.log("[set_blur] called with enable =", enable);
		await effects.setBlur(enable);
		return `Blur set to ${enable}`;
	},
);

toolManager.registerTool(
	"set_contrast",
	"Turn high contrast mode on or off explicitly. You MUST always pass the boolean 'enable' argument to be true or false. You MUST NEVER leave it undefined.",
	z.object({
		enable: z
			.boolean()
			.describe(
				"True to turn high contrast ON, false to turn it OFF. This field is REQUIRED and must NEVER be omitted.",
			),
	}),
	async ({ enable }) => {
		console.log("[set_contrast] called with enable =", enable);
		await effects.setHighContrast(enable);
		updatePreviewVisibility();
		return `High contrast set to ${enable}`;
	},
);

toolManager.registerTool(
	"describe_photo",
	"Analyze the current camera frame (one still image) with a vision model and return a concise natural-language summary. Inputs: optional 'instruction' string to focus the analysis; omit it for a general brief description. Output: 1-2 short sentences of human-readable text that summarize what is visibly present (e.g., scene, subjects, salient details) and directly address the instruction when provided. The result is plain text (not JSON, not metadata), suitable for voice readout; image bytes are not returned.",
	z.object({
		instruction: z
			.string()
			.describe(
				"Optional analysis instruction. If omitted, briefly describe the image. Output must be 1-2 short sentences (under ~45 words), no prefaces, no reasoning or disclaimers, no model mentions; be concrete and visual, avoid speculation. For background safety checks, look for faces/people, IDs/documents with readable text, screens showing personal info, payment cards, addresses/license plates, weapons, drugs/alcohol, explicit content; if none are visible, respond: No obvious sensitive items detected.",
			)
			.optional(),
		source: z
			.enum(["camera", "album"])
			.describe(
				"Image source. 'camera' captures the current camera frame; 'album' uses a stored photo.",
			)
			.default("camera"),
		index: z
			.number()
			.int()
			.min(0)
			.describe(
				"Album index when source='album': 0 = newest, 1 = next newest, etc.",
			)
			.default(0),
	}),
	async ({ instruction, source = "camera", index = 0 }) => {
		// transitional message
		const preMsg =
			source === "camera"
				? "OK, let me take a look."
				: "OK, let me check this photo.";
		await speechManager.speak(preMsg);

		let blob;
		if (source === "camera") {
			const res = await photoService.captureWithBlob();
			blob = res.blob;
		} else {
			// source === 'album'
			const items = await photoStore.getAllPhotos();
			// Ensure ascending order by createdAt (oldest -> newest)
			items.sort((a, b) => a.createdAt - b.createdAt);
			if (!items.length) {
				return "Album is empty";
			}
			const actualIdx = items.length - 1 - index; // 0 => newest
			if (actualIdx < 0 || actualIdx >= items.length) {
				throw new Error("Album index out of range");
			}
			blob = items[actualIdx].blob;
		}
		const prompt = instruction?.trim()
			? instruction.trim()
			: "Describe the image in 1 short sentence.";
		const system =
			"Answer in at most two short sentences. If the prompt asks a specific question, answer it directly using what is visible; otherwise briefly describe the image. Be concise. Stay grounded in the visible content and avoid judgments or speculation.";
		try {
			const result = await llmService.sendImageAndText({
				imageBlob: blob,
				prompt,
				system,
				maxOutputTokens: 30,
			});
			return result.text?.trim() || "Done";
		} catch (e) {
			console.error("describe_photo tool error:", e);
			throw e;
		}
	},
);

toolManager.registerTool(
	"open_album",
	"Open the photo album",
	z.object({}),
	async () => {
		initializeAlbumView(0);
		return "Album opened";
	},
);

toolManager.registerTool(
	"open_camera",
	"Open the camera view",
	z.object({}),
	async () => {
		setState(State.READY, "Look at the camera");
		return "Camera opened";
	},
);

toolManager.registerTool(
	"start_guide",
	"Start guiding the user to position their face correctly for a selfie. This tool will continuously provide voice instructions until the user's face is perfectly centered and at the correct distance. The tool blocks until the perfect position is achieved.",
	z.object({}),
	async () => {
		const GUIDE_INTERVAL = 4000;
		const CHECK_INTERVAL = 300;

		if (isGuidingActive) {
			return "Guide is already running";
		}
		isGuidingActive = true;

		// Temporarily disable VAD
		const wasVADActive = speechManager.isVADModeActive();
		if (wasVADActive) {
			try {
				await speechManager.disableVADMode();
			} catch (_) {}
		}

		let lastGuideTime = 0;

		await speechManager.speak("Let me help you position for a perfect selfie.");

		return new Promise((resolve) => {
			const canSpeakNow = () => {
				if (speechManager.isSpeakingNow()) {
					return false;
				}
				return true;
			};
			const finishGuidance = async (message) => {
				if (!isGuidingActive) return;
				isGuidingActive = false;
				stopGuidingCallback = null;
				try {
					await speechManager.speak(message);
				} catch (_) {}
				if (wasVADActive) {
					try {
						await speechManager.enableVADMode();
					} catch (_) {}
				}
				resolve("Done");
			};

			stopGuidingCallback = () => {
				finishGuidance("Guidance stopped");
			};

			const checkPosition = () => {
				if (!isGuidingActive) return;

				const videoWidth = video.videoWidth;
				const videoHeight = video.videoHeight;

				if (!videoWidth || !videoHeight) {
					setTimeout(checkPosition, CHECK_INTERVAL);
					return;
				}

				const detections = faceService.detections;
				if (!detections || detections.length === 0) {
					const now = Date.now();
					if (now - lastGuideTime >= GUIDE_INTERVAL) {
						if (canSpeakNow()) {
							speechManager.speak(
								"I can't detect your face yet. Try holding the phone at arm's length in front of you.",
							);
							lastGuideTime = now;
						}
					}
					setTimeout(checkPosition, CHECK_INTERVAL);
					return;
				}

				const evals = evaluateFacePosition(detections, videoWidth, videoHeight);
				if (evals.length === 0) {
					setTimeout(checkPosition, CHECK_INTERVAL);
					return;
				}

				const evaluation = evals[0];
				const positions = evaluation.positions;
				const distance = evaluation.distance;

				if (
					positions.includes(facePosition.CENTERED) &&
					distance === faceDistance.NORMAL
				) {
					const ending =
						"Perfect! Your face is centered and at a good distance. Ready to take a photo. " +
						"I will stop guidance. Let me know if you want to take a photo right now, or need further assistance.";
					finishGuidance(ending);
					return;
				}

				const now = Date.now();
				if (now - lastGuideTime >= GUIDE_INTERVAL) {
					let message = "";

					// Longer instructions
					if (distance === faceDistance.CLOSE) {
						message = "Too close. Move the phone further away.";
					} else if (distance === faceDistance.FAR) {
						message = "Too far. Bring the phone closer.";
					} else if (positions.includes(facePosition.TOP)) {
						message = "Point the phone upward a little.";
					} else if (positions.includes(facePosition.BOTTOM)) {
						message = "Point the phone downward a little.";
					} else if (positions.includes(facePosition.LEFT)) {
						message = "Turn the phone slightly to your left.";
					} else if (positions.includes(facePosition.RIGHT)) {
						message = "Turn the phone slightly to your right.";
					}

					if (message) {
						if (canSpeakNow()) {
							speechManager.speak(message);
							lastGuideTime = now;
						}
					}
				}

				setTimeout(checkPosition, CHECK_INTERVAL);
			};

			checkPosition();
		});
	},
);

toolManager.registerTool(
	"stop_guide",
	"Stop the ongoing guidance if it is running.",
	z.object({}),
	async () => {
		if (isGuidingActive && typeof stopGuidingCallback === "function") {
			stopGuidingCallback();
			return "Guidance stopped";
		}
		return "Guidance was not running";
	},
);

window.toolManager = toolManager;

function buildSystemPromptWithState() {
	const { highContrast, blur } = effects.getState();
	const isAlbumView = !albumView.hidden;
	const photoCount = storedPhotos.length;

	const stateLine =
		`STATE: view=${isAlbumView ? "ALBUM" : "CAMERA"}, ` +
		`blur=${blur ? "ON" : "OFF"}, ` +
		`contrast=${highContrast ? "ON" : "OFF"}, ` +
		`photos=${photoCount}.`;

	// Include the most recent tool
	let recentActionLine = "RECENT_ACTION: none.";
	try {
		const last = toolManager.getLastAction?.();
		if (last?.name) {
			const argStr =
				last.args === undefined ? "" : `(${JSON.stringify(last.args)})`;
			recentActionLine = `RECENT_ACTION: ${last.name}${argStr}.`;
		}
	} catch (_) {}

	return `${SYSTEM_PROMPT}\n\n${stateLine}\n${recentActionLine}`;
}

// Conversation context for maintaining chat history
const SYSTEM_PROMPT = `You are a helpful selfie camera assistant. 
You can take photos, control camera settings like blur, and describe what you see. 
Use the available tools to fulfill the user's request. Always respond to the last user message.

If the user asks to take a photo, use the take_photo tool.
If they want to blur the background, use the set_blur tool.
If they want to change high contrast mode, use the set_contrast tool.
If they want to open the photo album, use the open_album tool.
If they want to return to the camera view, use the open_camera tool.
If they want to know what a photo looks like, including simply describing the photo or looking for specific details, use the describe_photo tool.

When the user simply say they want a photo: if the recent action is start_guide (or the user just finished guidance), take_photo immediately. Otherwise ask: "Do you want me to guide you first, or take the photo now?" Then follow their answer—start_guide then take_photo, or just take_photo. Keep the question short.

After executing a tool, you MUST provide a short verbal confirmation to the user (e.g., 'Photo taken', 'Blur enabled/disabled'). The input is transcribed speech from the user, so it may contain some recognition errors. Try to interpret their intent as best as you can. Keep it minds that users won't say something unrelated. If you are unsure, ask for clarification, like 'Did you mean to ...?'. Don't say you can't do something, instead guessing what the user want to do. IMPORTANT: When you asked a clarification question in the previous turn, and the user answers like "yes/no/okay", treat it as a confirmation and proceed to call the appropriate tool, then give a short verbal confirmation.`;

// Only last assistant message from previous turn
let lastAssistantMessage = null;

/**
 * Generate acknowledgment message from tool results
 * @param {Array} toolResults - Tool execution results
 * @returns {string} Acknowledgment message
 */
function ackFromToolResults(toolResults = []) {
	if (!toolResults.length) return "";
	const last = toolResults[toolResults.length - 1];
	switch (last.toolName) {
		case "take_photo":
			return "Photo taken";
		case "set_blur":
			return "Background blur updated";
		case "start_guide": {
			const r = last.output;
			if (typeof r === "string") {
				if (r === "Done") return "";
				return r;
			}
			return "Guidance started";
		}
		// TBD
		case "stop_guide": {
			const r = last.output;
			if (typeof r === "string") return r;
			return "Guidance stopped";
		}
		case "open_album":
			return "Album opened";
		case "open_camera":
			return "Camera view opened";
		case "describe_photo": {
			const r = last.output;
			if (typeof r === "string") return r;
			return "Done";
		}
		default:
			return "Done";
	}
}

// Handle voice commands
document.addEventListener("voice:command", async (event) => {
	const { command } = event.detail;
	console.log("Received voice command:", command);

	// If it's a raw transcript (not a pre-defined command), send to LLM
	if (command.startsWith("transcript:")) {
		const transcript = command.replace("transcript:", "").trim();
		console.log("Processing transcript with LLM:", transcript);

		status.textContent = "Thinking...";
		isProcessingCommand = true;

		try {
			// Last assistant (if any) + current user
			const messages = [];
			if (lastAssistantMessage) {
				messages.push({ role: "assistant", content: lastAssistantMessage });
			}
			messages.push({ role: "user", content: transcript });

			const result = await llmService.sendMessagesStream(messages, {
				tools: toolManager.getTools(),
				system: buildSystemPromptWithState(),
				maxSteps: 5,
			});

			console.log("LLM Result:", result);

			const ack = ackFromToolResults(result.toolResults);
			const hasToolResults =
				Array.isArray(result.toolResults) && result.toolResults.length > 0;

			// avoid interrupting tool execution flow
			if (hasToolResults || !result.textStream) {
				const text = result.text?.trim();
				const ackIsDoneOnly = ack === "Done" && !text;
				if (ackIsDoneOnly) {
					lastAssistantMessage = text || "";
					status.textContent = "";
					return;
				}
				const ackIsEmpty = hasToolResults && !ack && !text;
				if (ackIsEmpty) {
					lastAssistantMessage = text || "";
					status.textContent = "";
					return;
				}

				const say = ack && ack !== "Done" ? ack : text || ack || "Done";
				lastAssistantMessage = say;

				await speechManager.speak(say);
				lastLlmSpeakEndedAt = Date.now();
				status.textContent = say;
				try {
					if (/[?]\s*$/.test(say)) {
						speechManager.expectShortReply(4500);
					}
				} catch (_) {}
				return;
			}

			// sentence by sentence, then decide whether to expect a reply
			let fullText = "";
			let buffer = "";
			let lastSpeakPromise = Promise.resolve(false);
			const sentenceEndChars = /[.!?]/;

			const flushCompleteSentences = () => {
				while (buffer.length > 0) {
					let endIndex = -1;
					for (let i = 0; i < buffer.length; i++) {
						if (!sentenceEndChars.test(buffer[i])) {
							continue;
						}
						const nextChar = buffer[i + 1];
						if (!nextChar || /\s/.test(nextChar)) {
							endIndex = i + 1;
							break;
						}
					}
					if (endIndex === -1) {
						return;
					}
					const sentence = buffer.slice(0, endIndex).trim();
					buffer = buffer.slice(endIndex).replace(/^\s+/, "");
					if (sentence) {
						lastSpeakPromise = speechManager.speakQueued(sentence);
					}
				}
			};

			for await (const delta of result.textStream) {
				if (!delta) continue;
				fullText += delta;
				buffer += delta;
				flushCompleteSentences();
			}

			const remaining = buffer.trim();
			if (remaining) {
				lastSpeakPromise = speechManager.speakQueued(remaining);
			}

			const say = fullText.trim() || ack || "Done";
			lastAssistantMessage = say;

			await lastSpeakPromise;
			lastLlmSpeakEndedAt = Date.now();
			status.textContent = say;
			try {
				if (/[?]\s*$/.test(say)) {
					speechManager.expectShortReply(4500);
				}
			} catch (_) {}
		} catch (error) {
			console.error("LLM Error:", error);
			status.textContent = "Sorry, I encountered an error.";
			await speechManager.speak("Sorry, I encountered an error.");
		} finally {
			isProcessingCommand = false;
		}
		return;
	}

	switch (command) {
		case "take-photo":
			if (captureBtn && !captureBtn.disabled) {
				captureBtn.click();
			}
			break;
		default:
			console.log(`Unhandled voice command: ${command}`);
	}
});
