/**
 * Set up speech control UI
 * @param {SpeechManager} manager - The SpeechManager instance to connect to
 */
export function setupSpeechControlUI(manager) {
	// Create the voice control UI container
	const container = document.createElement("div");
	container.id = "speech-control-bar";
	container.className = "speech-control-bar";

	container.innerHTML = `
    <button id="ttsToggle" class="speech-control-btn" aria-pressed="false" title="Toggle audio output">
      Audio: Muted
    </button>
    <button id="voiceMicBtn" class="speech-control-btn" aria-pressed="false" title="Toggle listening">
      Listening: Off
    </button>
  `;

	// Insert at the top of the app
	const app = document.querySelector("#app");
	if (app) {
		app.insertBefore(container, app.firstChild);
	}

	// Get UI elements
	const micBtn = document.getElementById("voiceMicBtn");
	const ttsToggle = document.getElementById("ttsToggle");

	// Sound effects
	const startSound = new Audio("/sounds/ding_start.mp3");
	const stopSound = new Audio("/sounds/ding_stop.mp3");

	// UI EVENT HANDLERS

	// Microphone button - toggle listening
	micBtn.addEventListener("click", () => {
		manager.toggleListening();
	});

	// TTS toggle
	ttsToggle.addEventListener("click", () => {
		manager.toggleTTS();
	});

	// Update UI when recognition starts
	manager.onRecognitionStart(() => {
		updateVoiceButton(true);
		startSound.play().catch(() => {});
	});

	// Update UI when recognition ends
	manager.onRecognitionEnd(() => {
		updateVoiceButton(false);
		stopSound.play().catch(() => {});
	});

	// Update UI when TTS state changes
	manager.onTTSEnabledChange((enabled) => {
		updateTTSButton(enabled);
	});

	// Helper functions
	function updateTTSButton(enabled) {
		ttsToggle.setAttribute("aria-pressed", String(enabled));
		ttsToggle.textContent = enabled ? "Audio: On" : "Audio: Muted";
		if (enabled) {
			ttsToggle.classList.add("active");
		} else {
			ttsToggle.classList.remove("active");
		}
	}

	function updateVoiceButton(active) {
		micBtn.setAttribute("aria-pressed", String(active));
		micBtn.textContent = active ? "Listening: On" : "Listening: Off";
		if (active) {
			micBtn.classList.add("active");
		} else {
			micBtn.classList.remove("active");
		}
	}

	// Initialize
	updateTTSButton(manager.isTTSEnabled());
	updateVoiceButton(manager.isListening());

	// Check if speech features are supported
	const support = manager.isSupported();

	if (!support.recognition) {
		console.warn("Speech Recognition is not supported in this browser");
		micBtn.title = "Voice recognition not supported";
		micBtn.disabled = true;
	}

	if (!support.tts) {
		console.warn("Text-to-Speech is not supported in this browser");
		ttsToggle.title = "Text-to-speech not supported";
		ttsToggle.disabled = true;
	}

	console.log("Speech control UI initialized");

	// Return the container so it can be controlled from outside
	return container;
}
