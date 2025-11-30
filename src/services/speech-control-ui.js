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
    <button id="contrastToggle" class="speech-control-btn" aria-pressed="false" title="Toggle high contrast">
      Contrast: Off
    </button>
    <button id="blurToggle" class="speech-control-btn" aria-pressed="false" title="Toggle background blur">
      Blur: Off
    </button>
	<button id="tokenBtn" class="speech-control-btn" aria-pressed="false" title="Set user key">
	  Key: None
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
	const tokenBtn = document.getElementById("tokenBtn");

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
		// startSound.play().catch(() => {});
	});

	// Update UI when recognition ends
	manager.onRecognitionEnd(() => {
		updateVoiceButton(false);
		// stopSound.play().catch(() => {});
	});

	// Update UI when TTS state changes
	manager.onTTSEnabledChange((enabled) => {
		updateTTSButton(enabled);
	});

	// Key button
	tokenBtn.addEventListener("click", () => {
		const input = window.prompt("Enter user key (leave empty to clear):", "");
		if (input === null) return;
		const value = String(input).trim();
		try {
			if (value) {
				localStorage.setItem("user_key", value);
			} else {
				localStorage.removeItem("user_key");
			}
			window.dispatchEvent(new Event("keyupdate"));
		} catch (_) {}
		updateTokenButton();
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
	updateTokenButton();

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

	function updateTokenButton() {
		let exists = false;
		try {
			exists = !!localStorage.getItem("user_key");
		} catch (_) {}
		tokenBtn.setAttribute("aria-pressed", String(exists));
		tokenBtn.textContent = exists ? "Key: Set" : "Key: None";
		tokenBtn.classList.toggle("active", exists);
	}
}
