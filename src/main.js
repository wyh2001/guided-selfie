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
import { FaceDetect } from "./services/faceDetect.js";
import { PhotoCapture } from "./services/photoCapture.js";

const app = document.querySelector("#app");
const photoService = new PhotoCapture();
const faceService = new FaceDetect();

app.innerHTML = `
  <main class="capture">
    <section class="preview">
      <div class="video-placeholder">Awaiting camera…</div>
      <video autoplay playsinline hidden></video>
      <img alt="snapshot" hidden />
    </section>
    <section class="actions">
    </section>
    <p class="status" hidden></p>
	<p class="debug" hidden></p>
  </main>
  <section class="album-view" hidden>
    <div class="album-header">
      <button type="button" data-action="back-to-camera" aria-label="Back to camera">← Back</button>
    </div>
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
    <div class="bottom-bar">
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
    </div>
`;

const video = app.querySelector("video");
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
const captureView = app.querySelector(".capture");

const faceBoxElements = [];
const storedPhotos = []; // (photoURL, timestamp) pairs
let currentPhotoIndex = 0;

const defaultPlaceholderText = placeholder.textContent;

const setVisible = (element, visible) => {
	if (!element) {
		return;
	}
	element.hidden = !visible;
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

const setState = (state, overrideMessage) => {
	const view = stateView[state];
	if (!view) {
		return;
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
	setVisible(photo, view.photo);
	setVisible(placeholder, view.placeholder);

	captureBtn.disabled = !view.capture;
	setVisible(captureBtn, !view.albumView);
	setVisible(albumBtn, !view.albumView);

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
		} else {
			video.style.transform = "none";
		}

		setState(State.CAMERA_READY);
		await faceService.init();
		setState(State.READY, "Look at the camera");
	} catch (error) {
		setState(State.ERROR, `Camera unavailable: ${error.message}`);
	}
}

function handleDetections(detections) {
	const videoWidth = video.videoWidth;
	const videoHeight = video.videoHeight;
	debug.textContent = generateDebugInfo(detections, videoWidth, videoHeight);
	drawFaceBoxes(detections, videoWidth, videoHeight);
	const evals = evaluateFacePosition(detections, videoWidth, videoHeight);
	evals.forEach((evaluation, index) => {
		debug.textContent += `Face ${index + 1}: position: ${evaluation.positions.join("-")}, distance: ${evaluation.distance}\n`;
	});
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
	const latestPhotoURL = storedPhotos[storedPhotos.length - 1][0];
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
	const [url, timestamp] = storedPhotos[actualIndex];
	albumPhoto.src = url;
	albumPhoto.alt = `Photo ${currentPhotoIndex + 1} taken at ${new Date(timestamp).toLocaleString()}`;
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

captureBtn.addEventListener("click", async () => {
	try {
		status.textContent = "Capturing…";
		const photoURL = await photoService.capture();
		storedPhotos.push([photoURL, Date.now()]);
		refreshAlbumThumbnail();
		status.textContent = "Photo saved";
		setTimeout(() => {
			status.textContent = "Look at the camera";
		}, 1000);
	} catch (error) {
		status.textContent = `Capture failed: ${error.message}`;
	}
});

albumBtn.addEventListener("click", () => {
	initializeAlbumView(0);
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

window.addEventListener("beforeunload", () => {
	photoService.dispose();
	faceService.dispose();
	video.srcObject = null;
});

setupCamera();
