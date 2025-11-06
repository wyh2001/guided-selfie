// src/webspeech.js
// Web Speech API integration for guided-selfie
// Listens for simple voice commands (take photo, capture, snap, start, stop, help, zoom in/out, left/right).

(function () {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const root = document.body || document.documentElement;

  // Create a small voice control UI element and append it near the end of body.
  const container = document.createElement('div');
  container.id = 'voice-control-container';
  container.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9999;background:rgba(0,0,0,0.6);color:white;padding:8px 10px;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;display:flex;align-items:center;gap:8px';
  container.innerHTML = `
    <button id="voiceMicBtn" aria-pressed="false" title="Start/stop voice control" style="background:transparent;border:1px solid rgba(255,255,255,0.2);color:white;padding:6px 8px;border-radius:6px;cursor:pointer;">🎤</button>
    <span id="voiceStatus" aria-live="polite" style="min-width:120px">Voice: off</span>
    <select id="voiceLang" title="Recognition language" style="background:transparent;border:1px solid rgba(255,255,255,0.12);color:white;padding:4px;border-radius:6px;">
      <option value="en-US" selected>en-US</option>
      <option value="en-GB">en-GB</option>
      <option value="es-ES">es-ES</option>
      <option value="fr-FR">fr-FR</option>
    </select>
    <label style="display:flex;align-items:center;gap:6px;">
      <input id="ttsToggle" type="checkbox" style="cursor:pointer"> <span style="font-size:12px;margin-left:4px">TTS</span>
    </label>
  `;
  root.appendChild(container);

  const micBtn = document.getElementById('voiceMicBtn');
  const statusEl = document.getElementById('voiceStatus');
  const langEl = document.getElementById('voiceLang');
  const ttsEl = document.getElementById('ttsToggle');

  function setStatus(txt) {
    statusEl.textContent = `Voice: ${txt}`;
  }
  function speakIfEnabled(text) {
    if (!ttsEl || !ttsEl.checked) return;
    if (!('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1;
      u.pitch = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) {
      // ignore
    }
  }

  if (!SpeechRecognition) {
    setStatus('unsupported');
    console.warn('SpeechRecognition unsupported in this browser.');
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false; // restart manually if needed
  recognition.lang = (langEl && langEl.value) || 'en-US';

  let listening = false;

  // Map simple transcripts to handlers
  const exactHandlers = {
    'take photo': () => doCapture('take photo'),
    'take a photo': () => doCapture('take photo'),
    'capture': () => doCapture('capture'),
    'snap': () => doCapture('snap'),
    'start': () => { startListening(); speakIfEnabled('Voice control started'); },
    'stop': () => { stopListening(); speakIfEnabled('Voice control stopped'); },
    'help': () => speakIfEnabled('Say: take photo, capture, snap, start, stop, zoom in, zoom out, left or right.'),
  };

  recognition.onresult = (ev) => {
    const t = (ev.results[0][0].transcript || '').trim().toLowerCase();
    console.log('[voice] transcript:', t);
    setStatus('heard: ' + t);
    // direct match
    if (exactHandlers[t]) {
      exactHandlers[t]();
      return;
    }
    // fuzzy matching
    if (t.includes('photo') || t.includes('take') || t.includes('capture') || t.includes('snap')) {
      doCapture(t);
      return;
    }
    if (t.includes('left') || t.includes('right')) {
      if (t.includes('left')) dispatchVoiceCommand('left');
      if (t.includes('right')) dispatchVoiceCommand('right');
      return;
    }
    if (t.includes('zoom')) {
      if (t.includes('in')) dispatchVoiceCommand('zoom in');
      else if (t.includes('out')) dispatchVoiceCommand('zoom out');
      return;
    }
    speakIfEnabled('Sorry, I did not understand. Say help for available commands.');
  };

  recognition.onerror = (ev) => {
    console.warn('[voice] error', ev);
    setStatus('error: ' + (ev && ev.error ? ev.error : 'unknown'));
    // keep the mic button state consistent
    listening = false;
    micBtn.setAttribute('aria-pressed', 'false');
  };

  recognition.onend = () => {
    // ended - update UI
    listening = false;
    micBtn.setAttribute('aria-pressed', 'false');
    setStatus('off');
  };

  function startListening() {
    if (listening) return;
    try {
      recognition.lang = (langEl && langEl.value) || 'en-US';
      recognition.start();
      listening = true;
      micBtn.setAttribute('aria-pressed', 'true');
      setStatus('listening...');
    } catch (e) {
      console.warn('SpeechRecognition start error', e);
      setStatus('error');
    }
  }

  function stopListening() {
    if (!listening) return;
    recognition.stop();
    listening = false;
    micBtn.setAttribute('aria-pressed', 'false');
    setStatus('off');
  }

  micBtn.addEventListener('click', () => {
    if (listening) {
      stopListening();
    } else {
      startListening();
    }
  });

  langEl.addEventListener('change', () => {
    recognition.lang = langEl.value;
    speakIfEnabled('Language set to ' + langEl.options[langEl.selectedIndex].text);
  });

  // Placeholder implementations for external actions - you can replace these
  function doCapture(command) {
    console.log('[voice] doCapture called with command:', command);
    speakIfEnabled('Taking photo');
    // Try triggering app capture button or window functions
    const btn = document.querySelector('[data-action="capture"]');
    if (btn) {
      btn.click();
    } else if (window.takePhoto) {
      window.takePhoto();
    } else if (window.photoService && typeof window.photoService.capture === 'function') {
      window.photoService.capture();
    } else {
      console.warn('No capture method found.');
    }
  }

  function dispatchVoiceCommand(cmd) {
    console.log('[voice] dispatchVoiceCommand:', cmd);
    speakIfEnabled(`Command ${cmd} executed`);
    // Implement actual logic to handle commands like zoom or left/right movement here
    // For example, dispatch custom events, call other functions, etc.
  }

})();
