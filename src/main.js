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
    <h1>Guided Selfie</h1>
    <section class="preview">
      <div class="video-placeholder">Awaiting camera…</div>
      <video autoplay playsinline hidden></video>
      <img alt="snapshot" hidden />
    </section>
    <section class="actions">
      <button type="button" data-action="capture">Take photo</button>
      <button type="button" data-action="retake" hidden>Retake</button>
      <button type="button" data-action="download" hidden disabled>Download</button>
    </section>
    <p class="status"></p>
	<p class="debug"></p>
  </main>
`;

const video = app.querySelector("video");
const photo = app.querySelector("img");
const captureBtn = app.querySelector('[data-action="capture"]');
const retakeBtn = app.querySelector('[data-action="retake"]');
const downloadBtn = app.querySelector('[data-action="download"]');
const status = app.querySelector(".status");
const debug = app.querySelector(".debug");
const placeholder = app.querySelector(".video-placeholder");
const preview = app.querySelector(".preview");

const faceBoxElements = [];

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
	CAPTURED: "captured",
	ERROR: "error",
};

const stateView = {
	[State.LOADING]: {
		video: false,
		photo: false,
		placeholder: true,
		capture: false,
		retake: false,
		download: false,
		downloadDisabled: true,
		placeholderText: defaultPlaceholderText,
		message: "Awaiting camera…",
	},
	[State.CAMERA_READY]: {
		video: true,
		photo: false,
		placeholder: false,
		capture: false,
		retake: false,
		download: false,
		downloadDisabled: true,
		placeholderText: defaultPlaceholderText,
		message: "Initializing face detector...",
	},
	[State.READY]: {
		video: true,
		photo: false,
		placeholder: false,
		capture: true,
		retake: false,
		download: false,
		downloadDisabled: true,
		placeholderText: defaultPlaceholderText,
		message: "Look at the camera",
	},
	[State.CAPTURED]: {
		video: false,
		photo: true,
		placeholder: false,
		capture: false,
		retake: true,
		download: true,
		downloadDisabled: false,
		placeholderText: defaultPlaceholderText,
		message: "Done. Snap again?",
	},
	[State.ERROR]: {
		video: false,
		photo: false,
		placeholder: true,
		capture: false,
		retake: false,
		download: false,
		downloadDisabled: true,
		placeholderText: "Camera unavailable",
		message: "Camera unavailable",
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
			faceService.start(video, handleDetections, (error) => {
				console.error("Face detection error:", error);
			});
			break;
		case State.CAPTURED:
		case State.ERROR:
			debug.textContent = "";
			faceService.stop();
			faceBoxElements.forEach((e) => void e.remove());
			faceBoxElements.length = 0;
			break;
	}

	setVisible(video, view.video);
	setVisible(photo, view.photo);
	setVisible(placeholder, view.placeholder);
	setVisible(retakeBtn, view.retake);
	setVisible(downloadBtn, view.download);

	captureBtn.disabled = !view.capture;
	downloadBtn.disabled = view.downloadDisabled;

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
	drawFaceBoxes(detections, videoWidth);
}

// https://ai.google.dev/edge/api/mediapipe/js/tasks-vision.boundingbox
function generateDebugInfo(detections, videoWidth, videoHeight) {
	let debugInfo = `Video size: ${videoWidth}x${videoHeight}\n`;

	detections.forEach((detection, index) => {
		const boundingBox = detection.boundingBox;
		debugInfo += `Detect face ${index + 1} at [${boundingBox.originX}, ${boundingBox.originY}] with width ${boundingBox.width}, height ${boundingBox.height} and angle ${boundingBox.angle}\n`;
		const keypoints = detection.keypoints;
		debugInfo += `Keypoints:\n`;
		keypoints.forEach((keypoint, kpIndex) => {
			const x = keypoint.x * videoWidth;
			const y = keypoint.y * videoHeight;
			debugInfo += `keypoint ${kpIndex + 1} at [${x.toFixed(2)}, ${y.toFixed(2)}]\n`;
		});
	});
	return debugInfo;
}

// Refers to the official MediaPipe Face Detection demo: https://codepen.io/mediapipe-preview/pen/OJByWQr
function drawFaceBoxes(detections, videoWidth) {
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
	});
}

captureBtn.addEventListener("click", async () => {
	try {
		status.textContent = "Capturing…";
		const photoURL = await photoService.capture();
		photo.src = photoURL;
		setState(State.CAPTURED, "Done. Snap again?");
	} catch (error) {
		status.textContent = `Capture failed: ${error.message}`;
	}
});

retakeBtn.addEventListener("click", () => {
	photoService.clearPhoto();
	photo.removeAttribute("src");
	setState(State.READY, "Look at the camera");
});

downloadBtn.addEventListener("click", () => {
	try {
		photoService.download(`selfie-${Date.now()}.jpg`);
	} catch (error) {
		status.textContent = error.message;
	}
});

window.addEventListener("beforeunload", () => {
	photoService.dispose();
	video.srcObject = null;
});

setupCamera();
