/**
 * Speech Debug UI
 * Optional debug interface for speech recognition and TTS.
 * Can be enabled/disabled as needed during development.
 */

/**
 * Set up debug UI for speech services
 * @param {SpeechManager} manager - The SpeechManager instance to connect to
 */
export function setupSpeechDebugUI(manager) {
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
    manager.toggleListening();
  });

  // Language selector
  voiceLang.addEventListener('change', (e) => {
    manager.setLanguage(e.target.value);
  });

  // TTS toggle
  ttsToggle.addEventListener('change', (e) => {
    manager.enableTTS(e.target.checked);
  });

  // Update UI when recognition starts
  manager.onRecognitionStart(() => {
    voiceStatus.textContent = 'Voice: listening...';
    micBtn.setAttribute('aria-pressed', 'true');
    micBtn.style.background = 'rgba(255, 0, 0, 0.3)';
    micBtn.style.borderColor = 'rgba(255, 100, 100, 0.6)';
  });

  // Update UI when recognition ends
  manager.onRecognitionEnd(() => {
    voiceStatus.textContent = 'Voice: off';
    micBtn.setAttribute('aria-pressed', 'false');
    micBtn.style.background = 'transparent';
    micBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
  });

  // Update UI when recognition errors occur
  manager.onRecognitionError((error) => {
    voiceStatus.textContent = `Voice: error (${error})`;
    console.error('Recognition error:', error);
  });

  // Update UI when TTS state changes
  manager.onTTSEnabledChange((enabled) => {
    ttsToggle.checked = enabled;
  });

  // Check if speech features are supported
  const support = manager.isSupported();
  
  if (!support.recognition) {
    console.warn('Speech Recognition is not supported in this browser');
    voiceStatus.textContent = 'Voice: unsupported';
    micBtn.disabled = true;
  }
  
  if (!support.tts) {
    console.warn('Text-to-Speech is not supported in this browser');
    ttsToggle.disabled = true;
  }

  console.log('Speech debug UI initialized');
}
