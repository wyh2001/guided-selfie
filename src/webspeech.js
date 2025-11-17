/**
 * Web Speech Integration
 * This file sets up the speech services and UI.
 * The actual speech logic is in separate service files.
 */
import { SpeechManager } from './services/SpeechManager.js';

const speechManager = new SpeechManager();

// COMMAND HANDLERS

function setupCommands() {
  // Capture/photo commands
  speechManager.registerCommand('take', (transcript) => {
    if (transcript.includes('photo') || transcript.includes('capture') || transcript.includes('snap')) {
      dispatchVoiceCommand('take-photo');
      speechManager.speak('Photo captured');
    }
  });

  speechManager.registerCommand('capture', () => {
    dispatchVoiceCommand('take-photo');
    speechManager.speak('Capturing photo');
  });

  speechManager.registerCommand('snap', () => {
    dispatchVoiceCommand('take-photo');
    speechManager.speak('Snap');
  });

  // Movement commands
  speechManager.registerCommand('left', () => {
    dispatchVoiceCommand('left');
    speechManager.speak('Moving left');
  });

  speechManager.registerCommand('right', () => {
    dispatchVoiceCommand('right');
    speechManager.speak('Moving right');
  });

  // Zoom commands
  speechManager.registerCommand('zoom in', () => {
    dispatchVoiceCommand('zoom-in');
    speechManager.speak('Zooming in');
  });

  speechManager.registerCommand('zoom out', () => {
    dispatchVoiceCommand('zoom-out');
    speechManager.speak('Zooming out');
  });
}

function dispatchVoiceCommand(command) {
  // Dispatch custom event that other parts of the app can listen to
  document.dispatchEvent(new CustomEvent('voice:command', {
    detail: { command }
  }));

  console.log('Voice command dispatched:', command);
}

// UI SETUP

function setupUI() {
  // Create the voice control UI container
  const container = document.createElement('div');
  container.id = 'voice-control-container';
  container.style.cssText = `
    position: fixed;
    right: 12px;
    bottom: 12px;
    z-index: 9999;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    padding: 8px 10px;
    border-radius: 8px;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 8px;
  `;

  container.innerHTML = `
    <button id="voiceMicBtn" aria-pressed="false" title="Start/stop voice control" style="background:transparent;border:1px solid rgba(255,255,255,0.2);color:white;padding:6px 8px;border-radius:6px;cursor:pointer;">🎤</button>
    <span id="voiceStatus" aria-live="polite" style="min-width:120px">Voice: off</span>
    <select id="voiceLang" title="Recognition language" style="background:transparent;border:1px solid rgba(255,255,255,0.12);color:white;padding:4px;border-radius:6px;">
      <option value="en-US" selected>English (US)</option>
      <option value="en-GB">English (UK)</option>
      <option value="es-ES">Spanish</option>
      <option value="fr-FR">French</option>
      <option value="de-DE">German</option>
      <option value="it-IT">Italian</option>
      <option value="ja-JP">Japanese</option>
      <option value="zh-CN">Chinese</option>
    </select>
    <label style="display:flex;align-items:center;gap:6px;">
      <input id="ttsToggle" type="checkbox" style="cursor:pointer">
      <span style="font-size:12px">TTS</span>
    </label>
  `;

  document.body.appendChild(container);

  // Get UI elements
  const micBtn = document.getElementById('voiceMicBtn');
  const voiceStatus = document.getElementById('voiceStatus');
  const voiceLang = document.getElementById('voiceLang');
  const ttsToggle = document.getElementById('ttsToggle');

  // UI EVENT HANDLERS

  // Microphone button - toggle listening
  micBtn.addEventListener('click', () => {
    speechManager.toggleListening();
  });

  // Language selector
  voiceLang.addEventListener('change', (e) => {
    speechManager.setLanguage(e.target.value);
  });

  // TTS toggle
  ttsToggle.addEventListener('change', (e) => {
    speechManager.enableTTS(e.target.checked);
  });

  // Update UI when recognition starts
  speechManager.onRecognitionStart(() => {
    voiceStatus.textContent = 'Voice: listening...';
    micBtn.setAttribute('aria-pressed', 'true');
    micBtn.style.background = 'rgba(255, 0, 0, 0.3)';
    micBtn.style.borderColor = 'rgba(255, 100, 100, 0.6)';
  });

  // Update UI when recognition ends
  speechManager.onRecognitionEnd(() => {
    voiceStatus.textContent = 'Voice: off';
    micBtn.setAttribute('aria-pressed', 'false');
    micBtn.style.background = 'transparent';
    micBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
  });

  // Update UI when recognition errors occur
  speechManager.onRecognitionError((error) => {
    voiceStatus.textContent = `Voice: error (${error})`;
    console.error('Recognition error:', error);
  });

  // Update UI when TTS state changes
  speechManager.onTTSEnabledChange((enabled) => {
    ttsToggle.checked = enabled;
  });
}

// INITIALIZATION

function init() {
  // Check if speech features are supported
  const support = speechManager.isSupported();
  
  if (!support.recognition) {
    console.warn('Speech Recognition is not supported in this browser');
  }
  
  if (!support.tts) {
    console.warn('Text-to-Speech is not supported in this browser');
  }

  // Set up command handlers
  setupCommands();

  // Set up UI
  setupUI();

  console.log('Speech services initialized');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Export for module usage
export { speechManager };