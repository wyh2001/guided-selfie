/**
 * SpeechManager
 * Unified interface for speech recognition and text-to-speech.
 * This is the main entry point for all speech functionality.
 */
import { HarkService } from './hark-service.js';
import { SpeechRecognitionService } from './SpeechRecognitionService.js';
import { TextToSpeechService } from './TextToSpeechService.js';
import { VADService } from './vad-service.js';
import { VoskRecognitionService } from './vosk-recognition-service.js';

export class SpeechManager {
  constructor() {
    // Fallback
    const hasWebSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    this.recognition = hasWebSpeech
      ? new SpeechRecognitionService()
      : new VoskRecognitionService();

    console.log(`Using ${hasWebSpeech ? 'Web Speech API' : 'Vosk'} for recognition`);

    this.tts = new TextToSpeechService();
    this.vad = new VADService();
    this.hark = new HarkService();
    this.commandHandlers = new Map();
    this._expectReplyTimer = null;
    this._expectReplyDeadline = 0;
    
    this._currentSpeakToken = null; // Make sure only latest speak resumes listening
    this._suspendedByTTS = false;
    this._wantListening = false; // Whether user wants listening active
    this._speakQueue = Promise.resolve();
    this._lastTranscript = { text: '', at: 0 };
    // Set up command processing
    this.setupCommandProcessing();

    // Use VAD to control recognition
    this.vad.onSpeechStart = async () => {
      // If TTS is speaking, cancel it
      if (this.shouldIgnoreSpeechStart()) {
        return;
      }
      // Start recognition if not already active
      if (!this.isListening()) {
        try {
          await this.recognition.start();
        } catch (e) {
          console.error('Failed to start recognition on VAD speechStart:', e);
        }
      }
    };

    this.vad.onSpeechEnd = async () => {
      if (this._isExpectReplyActive()) {
        return;
      }
      if (this.isListening()) {
        try {
          await this.recognition.stop();
        } catch (e) {
          console.error('Failed to stop recognition on VAD speechEnd:', e);
        }
      }
    };

    // Use Hark fallback with the same logic
    this.hark.onSpeechStart = async () => {
      if (this.shouldIgnoreSpeechStart()) {
        return;
      }
      if (!this.isListening()) {
        try {
          await this.recognition.start();
        } catch (e) {
          console.error('Failed to start recognition on Hark speechStart:', e);
        }
      }
    };
    this.hark.onSpeechEnd = async () => {
      if (this._isExpectReplyActive()) {
        return;
      }
      if (this.isListening()) {
        try {
          await this.recognition.stop();
        } catch (e) {
          console.error('Failed to stop recognition on Hark speechEnd:', e);
        }
      }
    };

    // For debugging
    this.recognition.onEnd = () => {
      if (this._wantListening && this.isVADModeActive()) {
        console.info('Recognition session ended; VAD/Hark will restart on next speech');
      }
    };
  }

  /**
   * Check if VAD or Hark mode is currently active
   */
  isVADModeActive() {
    return this.vad.isActive() || this.hark.isActive();
  }

  setupCommandProcessing() {
    this.recognition.onResult = (transcript) => {
      this.processCommand(transcript);
    };
  }

  // TEXT-TO-SPEECH METHODS

  /**
   * Speak text with automatic listening suspension and restoration
   * @param {string} text - Text to speak
   * @param {Object} options - Optional speech parameters
   * @returns {Promise<boolean>} - Whether speech was actually spoken
   */
  async speak(text, options = {}) {
    // Do nothing if TTS is disabled or unsupported
    if (!this.tts.isEnabled() || !this.tts.isSupported() || !text?.trim()) {
      return false;
    }

    // Create unique token for this speak operation
    const token = Symbol('speak');
    this._currentSpeakToken = token;

    // Remember if listening (to restore later)
    const wasListening = this.isListening();
    if (wasListening) {
      await this._stopListeningInternal({ markSuspended: true });
    }

    // Speak
    const success = await this.tts.speakAsync(text, options);

    if (this._currentSpeakToken === token) {
      this._currentSpeakToken = null;

      // Restore only if suspended by TTS and previously active
      if (this._suspendedByTTS && wasListening) {
        await this._startListeningInternal();
      }
      this._suspendedByTTS = false;
    }

    return success;
  }

  /**
   * Queue speech to avoid overlapping segments
   * @param {string} text - Text to speak
   * @param {Object} options - Optional speech parameters
   * @returns {Promise<boolean>} - Resolves after this queued speech completes
   */
  speakQueued(text, options = {}) {
    const run = async () => {
      try {
        return await this.speak(text, options);
      } catch (error) {
        console.error('Queued speak failed:', error);
        return false;
      }
    };

    this._speakQueue = this._speakQueue.catch(() => {}).then(run);
    return this._speakQueue;
  }

  /**
   * Enable or disable TTS
   * @param {boolean} enabled
   */
  enableTTS(enabled) {
    // Cancle if disabling while speaking
    if (!enabled && this.tts.isSpeaking()) {
      this.cancelSpeech();
    }
    this.tts.setEnabled(!!enabled);
  }

  /**
   * Toggle TTS on/off
   */
  toggleTTS() {
    return this.tts.toggle();
  }

  /**
   * Check if TTS is enabled
   */
  isTTSEnabled() {
    return this.tts.isEnabled();
  }

  /**
   * Cancel any ongoing speech
   */
  cancelSpeech() {
    this.tts.cancel();
    this._currentSpeakToken = null;
    this._suspendedByTTS = false;
  }

  // SPEECH RECOGNITION METHODS (can be called anywhere)


  /**
   * Start listening for voice commands
   */
  async startListening() {
    this._wantListening = true;
    // If currently speaking, cancle it
    if (this.isSpeakingNow()) {
      this.cancelSpeech();
    }
    await this._startListeningInternal();
  }

  /**
   * Stop listening for voice commands
   */
  async stopListening() {
    this._wantListening = false;
    await this._stopListeningInternal({ markSuspended: false });
  }

  /**
   * Toggle listening state
   */
  toggleListening() {
    if (this.isListening()) {
      return this.stopListening();
    }
    return this.startListening();
  }

  /**
   * Check if currently listening
   */
  isListening() {
    return this.recognition.isActive();
  }

  /**
   * Set recognition language
   * @param {string} lang - Language code (e.g., 'en-US')
   */
  setLanguage(lang) {
    this.recognition.setLanguage(lang);
  }

  /**
   * Get current recognition language
   */
  getLanguage() {
    return this.recognition.getLanguage();
  }


  // COMMAND HANDLING


  /**
   * Register a command handler
   * @param {string|RegExp} pattern - Command pattern to match
   * @param {Function} handler - Function to call when command matches
   */
  registerCommand(pattern, handler) {
    this.commandHandlers.set(pattern, handler);
  }

  /**
   * Unregister a previously registered command handler
   * @param {string|RegExp} pattern - The exact pattern object/string used in registerCommand
   */
  unregisterCommand(pattern) {
    this.commandHandlers.delete(pattern);
  }

  /**
   * Process a recognized transcript and execute matching commands
   * @param {string} transcript - The recognized speech text
   */
  processCommand(transcript) {
    if (this._isExpectReplyActive()) {
      this._clearExpectReplyMode();
      try { this.recognition.stop(); } catch (_) {}
    }
    // Ignore echo of TTS
    if (this.isSpeakingNow() || this._currentSpeakToken) {
      return;
    }
    const text = transcript.toLowerCase().trim();
    const now = Date.now();
    if (
      text === this._lastTranscript.text &&
      now - this._lastTranscript.at < 1200
    ) {
      return;
    }
    this._lastTranscript = { text, at: now };
    let commandMatched = false;
    
    // Try to match against registered command handlers
    for (const [pattern, handler] of this.commandHandlers.entries()) {
      let matched = false;
      
      if (typeof pattern === 'string') {
        matched = text.includes(pattern.toLowerCase());
      } else if (pattern instanceof RegExp) {
        matched = pattern.test(text);
      }
      
      if (matched) {
        commandMatched = true;
        try {
          handler(transcript, text);
        } catch (error) {
          console.error('Error executing command handler:', error);
        }
      }
    }

    // If no command matched, dispatch as raw transcript for LLM
    if (!commandMatched) {
      document.dispatchEvent(new CustomEvent('voice:command', {
        detail: { command: `transcript:${transcript}` }
      }));
    }
  }

  /**
   * Clear all registered command handlers
   */
  clearCommands() {
    this.commandHandlers.clear();
  }

  // CALLBACKS FOR UI/EXTERNAL INTEGRATION

  /**
   * Set callback for when recognition starts
   */
  onRecognitionStart(callback) {
    this.recognition.onStart = callback;
  }

  /**
   * Set callback for when recognition ends
   */
  onRecognitionEnd(callback) {
    this.recognition.onEnd = callback;
  }

  /**
   * Set callback for recognition errors
   */
  onRecognitionError(callback) {
    this.recognition.onError = callback;
  }

  /**
   * Set callback for when TTS enabled state changes
   */
  onTTSEnabledChange(callback) {
    this.tts.onEnabledChange = callback;
  }

  // UTILITY METHODS

  /**
   * Check if speech features are supported
   */
  isSupported() {
    return {
      recognition: this.recognition.isSupported(),
      tts: this.tts.isSupported()
    };
  }

  /**
   * Get current state
   */
  getState() {
    return {
      listening: this.recognition.isActive(),
      ttsEnabled: this.tts.isEnabled(),
      language: this.recognition.getLanguage()
    };
  }

  /**
   * Check if TTS is currently speaking
   */
  isSpeakingNow() {
    return this.tts.isSpeaking();
  }

  /**
   * Internal method to start listening
   * @private
   */
  async _startListeningInternal() {
    if (this.isListening()) {
      return;
    }
    // Ensure no TTS is speaking
    if (this.isSpeakingNow()) {
      this.cancelSpeech();
    }
    try {
      await this.recognition.start();
    } catch (error) {
      console.error('Failed to start listening:', error);
    }
  }

  /**
   * Enable VAD-driven listening
   */
  async enableVADMode() {
    this._wantListening = true;
    // Ensure fallback is not running
    try { await this.hark.stop(); } catch {}
    try {
      await this.vad.start();
      console.info('Voice detection: VAD enabled');
      // Ensure hark stays stopped
      try { await this.hark.stop(); } catch {}
    } catch (e) {
      console.warn('VAD failed, falling back to Hark', e);
      try { await this.vad.stop(); } catch {}
      await this.hark.start();
      console.info('Voice detection: Hark fallback enabled');
    }
  }

  /**
   * Disable VAD-driven listening
   */
  async disableVADMode() {
    this._wantListening = false;
    // Stop both detectors
    try { await this.vad.stop(); } catch {}
    try { await this.hark.stop(); } catch {}
    await this.stopListening();
  }

  /**
   * Whether we should ignore speech-start events (e.g., during TTS or disabled)
   */
  shouldIgnoreSpeechStart() {
    if (!this._wantListening) return true;
    if (this.isSpeakingNow()) return true;
    if (this._currentSpeakToken) return true;
    return false;
  }
 
  /**
   * Internal method to stop listening
   * @param {Object} options - { markSuspended: boolean }
   * @private
   */
  async _stopListeningInternal({ markSuspended }) {
    try {
      await this.recognition.stop();
    } catch (error) {
      console.error('Failed to stop listening:', error);
    } finally {
      if (markSuspended) {
        this._suspendedByTTS = true;
      }
    }
  }

  expectShortReply(timeoutMs = 4500) {
    if (timeoutMs <= 0) return;
    this._clearExpectReplyMode();
    this._expectReplyDeadline = Date.now() + timeoutMs;
    this._expectReplyTimer = setTimeout(() => {
      this._clearExpectReplyMode();
      try { this.recognition.stop(); } catch (_) {}
    }, timeoutMs);
    this._startListeningInternal();
  }

  _isExpectReplyActive() {
    return this._expectReplyTimer != null && Date.now() <= this._expectReplyDeadline;
  }

  _clearExpectReplyMode() {
    if (this._expectReplyTimer) {
      clearTimeout(this._expectReplyTimer);
      this._expectReplyTimer = null;
    }
    this._expectReplyDeadline = 0;
  }
}