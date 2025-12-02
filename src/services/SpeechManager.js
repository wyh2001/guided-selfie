/**
 * SpeechManager
 * Unified interface for speech recognition and text-to-speech.
 * This is the main entry point for all speech functionality.
 */
import { HarkService } from './hark-service.js';
import { SpeechRecognitionService } from './SpeechRecognitionService.js';
import { TextToSpeechService } from './TextToSpeechService.js';
import { VADService } from './vad-service.js';

export class SpeechManager {
  constructor() {
    this.recognition = new SpeechRecognitionService();
    this.tts = new TextToSpeechService();
    this.vad = new VADService();
    this.hark = new HarkService();
    this.commandHandlers = new Map();
    this._expectReplyTimer = null;
    this._expectReplyDeadline = 0;

    this._currentSpeakToken = null; // Make sure only latest speak resumes listening
    this._suspendedByTTS = false;
    this._wantListening = false; // Whether user wants listening active
    this._vadModeEnabled = false;
    this._speakQueue = Promise.resolve();
    this._lastTranscript = { text: '', at: 0 };
    this._externalOnEnd = null;

    // [SM_DEBUG] Debug tracking for mobile TTS truncation diagnosis
    this._debugSpeakId = 0;
    this._debugLastTTSStartTime = 0;
    this._debugLastTTSEndTime = 0;

    // [SM_DEBUG] Log initialization
    console.log('[SM_DEBUG] SpeechManager initialized', {
      userAgent: navigator.userAgent,
      isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
      timestamp: Date.now()
    });

    // Set up command processing
    this.setupCommandProcessing();

    // Use VAD to control recognition
    this.vad.onSpeechStart = async () => {
      const now = Date.now();
      const timeSinceLastTTSEnd = this._debugLastTTSEndTime ? now - this._debugLastTTSEndTime : 'never';
      const isTTSSpeaking = this.isSpeakingNow();

      // [SM_DEBUG] CRITICAL: VAD triggered speechStart - this may be causing TTS truncation
      console.log('[SM_DEBUG] vad.onSpeechStart triggered', {
        isTTSCurrentlySpeaking: isTTSSpeaking,
        hasCurrentSpeakToken: !!this._currentSpeakToken,
        timeSinceLastTTSEnd: timeSinceLastTTSEnd,
        wantListening: this._wantListening,
        // Hypothesis: If TTS is speaking when VAD fires, VAD is detecting TTS audio
        possibleTTSDetection: isTTSSpeaking || (typeof timeSinceLastTTSEnd === 'number' && timeSinceLastTTSEnd < 500),
        willIgnore: this.shouldIgnoreSpeechStart(),
        timestamp: now
      });

      // If TTS is speaking, cancel it
      if (this.shouldIgnoreSpeechStart()) {
        console.log('[SM_DEBUG] vad.onSpeechStart - IGNORED (shouldIgnoreSpeechStart=true)', { timestamp: Date.now() });
        return;
      }
      // Start recognition if not already active
      if (!this.isListening()) {
        try {
          console.log('[SM_DEBUG] vad.onSpeechStart - starting recognition', { timestamp: Date.now() });
          // Stop VAD to release microphone before starting SR
          await this.vad.stop();
          await this._startListeningInternal();
        } catch (e) {
          console.error('Failed to start recognition on VAD speechStart:', e);
        }
      }
    };

    this.vad.onSpeechEnd = async () => {
      console.log('[SM_DEBUG] vad.onSpeechEnd triggered', {
        expectReplyActive: this._isExpectReplyActive(),
        timestamp: Date.now()
      });
      if (this._isExpectReplyActive()) {
        return;
      }
    };

    // Use Hark fallback with the same logic
    this.hark.onSpeechStart = async () => {
      const now = Date.now();
      const isTTSSpeaking = this.isSpeakingNow();

      // [SM_DEBUG] Hark triggered speechStart
      console.log('[SM_DEBUG] hark.onSpeechStart triggered', {
        isTTSCurrentlySpeaking: isTTSSpeaking,
        hasCurrentSpeakToken: !!this._currentSpeakToken,
        wantListening: this._wantListening,
        possibleTTSDetection: isTTSSpeaking,
        willIgnore: this.shouldIgnoreSpeechStart(),
        timestamp: now
      });

      if (this.shouldIgnoreSpeechStart()) {
        console.log('[SM_DEBUG] hark.onSpeechStart - IGNORED', { timestamp: Date.now() });
        return;
      }
      if (!this.isListening()) {
        try {
          console.log('[SM_DEBUG] hark.onSpeechStart - starting recognition', { timestamp: Date.now() });
          await this.recognition.start();
        } catch (e) {
          console.error('Failed to start recognition on Hark speechStart:', e);
        }
      }
    };
    this.hark.onSpeechEnd = async () => {
      console.log('[SM_DEBUG] hark.onSpeechEnd triggered', {
        expectReplyActive: this._isExpectReplyActive(),
        isListening: this.isListening(),
        timestamp: Date.now()
      });
      if (this._isExpectReplyActive()) {
        return;
      }
      if (this.isListening()) {
        try {
          console.log('[SM_DEBUG] hark.onSpeechEnd - stopping recognition', { timestamp: Date.now() });
          await this.recognition.stop();
        } catch (e) {
          console.error('Failed to stop recognition on Hark speechEnd:', e);
        }
      }
    };

    this.recognition.onEnd = async () => {
      console.info('Recognition session ended');

      // Restart VAD if _vadModeEnabled OR _wantListening OR VAD is not already running
      if (this._vadModeEnabled && this._wantListening && !this.vad.isActive()) {
        try {
          console.info('Restarting VAD to listen for next speech');
          await this.vad.start();
        } catch (e) {
          console.warn('Failed to restart VAD after recognition ended:', e);
        }
      }

      if (this._externalOnEnd) {
        try {
          this._externalOnEnd();
        } catch (e) {
          console.error('Error in external onEnd callback:', e);
        }
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
    const speakId = ++this._debugSpeakId;
    const startTime = Date.now();

    // [SM_DEBUG] Log speak() entry with full context
    console.log(`[SM_DEBUG] speak() called #${speakId}`, {
      textLength: text?.length,
      textPreview: text?.substring(0, 50),
      ttsEnabled: this.tts.isEnabled(),
      ttsSupported: this.tts.isSupported(),
      vadActive: this.vad.isActive(),
      harkActive: this.hark.isActive(),
      isListening: this.isListening(),
      vadModeEnabled: this._vadModeEnabled,
      wantListening: this._wantListening,
      // Hypothesis: If VAD/Hark is active when speak starts, they may detect TTS
      potentialConflict: this.vad.isActive() || this.hark.isActive(),
      timestamp: startTime
    });

    // Do nothing if TTS is disabled or unsupported
    if (!this.tts.isEnabled() || !this.tts.isSupported() || !text?.trim()) {
      console.log(`[SM_DEBUG] speak() #${speakId} early return - TTS disabled or no text`);
      return false;
    }

    // Create unique token for this speak operation
    const token = Symbol('speak');
    this._currentSpeakToken = token;

    // Remember if listening (to restore later)
    const wasListening = this.isListening();
    const wasVadActive = this.vad.isActive();
    const wasHarkActive = this.hark.isActive();

    console.log(`[SM_DEBUG] speak() #${speakId} state before TTS`, {
      wasListening,
      wasVadActive,
      wasHarkActive,
      // Hypothesis: Not stopping VAD/Hark before TTS may cause them to detect TTS audio
      timestamp: Date.now()
    });

    if (wasListening) {
      console.log(`[SM_DEBUG] speak() #${speakId} stopping listening before TTS`, { timestamp: Date.now() });
      await this._stopListeningInternal({ markSuspended: true });
    }

    // [SM_DEBUG] CRITICAL HYPOTHESIS: VAD active during TTS may cause audio routing issues
    // On mobile, the audio system may need time to switch from input (mic) to output (speaker)
    // This could cause the first few hundred ms of TTS to be "swallowed"
    const vadActiveBeforeTTS = this.vad.isActive();
    const harkActiveBeforeTTS = this.hark.isActive();

    // [SM_DEBUG] Try stopping VAD/Hark before TTS to test hypothesis
    if (vadActiveBeforeTTS || harkActiveBeforeTTS) {
      console.log(`[SM_DEBUG] speak() #${speakId} HYPOTHESIS TEST: VAD/Hark active before TTS - this may cause audio clipping on mobile`, {
        vadActive: vadActiveBeforeTTS,
        harkActive: harkActiveBeforeTTS,
        // Hypothesis: Stopping VAD before TTS may fix the audio clipping issue
        timestamp: Date.now()
      });
    }

    // [SM_DEBUG] Log TTS start
    this._debugLastTTSStartTime = Date.now();
    console.log(`[SM_DEBUG] speak() #${speakId} calling tts.speakAsync()`, {
      vadStillActive: this.vad.isActive(),
      harkStillActive: this.hark.isActive(),
      // Hypothesis: If VAD/Hark still active here, audio routing conflict may clip TTS start
      timestamp: this._debugLastTTSStartTime
    });

    // Speak
    const success = await this.tts.speakAsync(text, options);

    this._debugLastTTSEndTime = Date.now();
    const ttsDuration = this._debugLastTTSEndTime - this._debugLastTTSStartTime;

    console.log(`[SM_DEBUG] speak() #${speakId} tts.speakAsync() returned`, {
      success,
      ttsDuration,
      textLength: text?.length,
      // Hypothesis: If duration is much shorter than expected, speech was truncated
      expectedMinDuration: Math.floor(text.length / 15 * 1000),
      possibleTruncation: ttsDuration < (text.length / 15 * 1000) * 0.5,
      tokenStillValid: this._currentSpeakToken === token,
      timestamp: this._debugLastTTSEndTime
    });

    if (this._currentSpeakToken === token) {
      this._currentSpeakToken = null;

      // Restore only if suspended by TTS and previously active
      if (this._suspendedByTTS && wasListening) {
        console.log(`[SM_DEBUG] speak() #${speakId} restoring listening after TTS`, { timestamp: Date.now() });
        await this._startListeningInternal();
      }
      this._suspendedByTTS = false;
    } else {
      console.log(`[SM_DEBUG] speak() #${speakId} token invalidated - newer speak in progress`, { timestamp: Date.now() });
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
    // [SM_DEBUG] Log queued speech
    console.log('[SM_DEBUG] speakQueued() called', {
      textLength: text?.length,
      textPreview: text?.substring(0, 30),
      // Hypothesis: Rapid queuing may cause issues on mobile
      timestamp: Date.now()
    });

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
    // [SM_DEBUG] Log cancel with context - hypothesis: unexpected cancels may cause truncation
    console.log('[SM_DEBUG] cancelSpeech() called', {
      wasSpeaking: this.tts.isSpeaking(),
      hadToken: !!this._currentSpeakToken,
      callStack: new Error().stack?.split('\n').slice(1, 4).join(' <- '),
      timestamp: Date.now()
    });
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
    this._externalOnEnd = callback;
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
    if (this.vad.isActive()) {
      try {
        await this.vad.stop();
        console.info('Stopped VAD before starting SR to avoid mic conflict');
      } catch (e) {
        console.warn('Failed to stop VAD before starting SR:', e);
      }
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
    // [SM_DEBUG] Log VAD mode enable
    console.log('[SM_DEBUG] enableVADMode() called', {
      currentVadActive: this.vad.isActive(),
      currentHarkActive: this.hark.isActive(),
      isListening: this.isListening(),
      isTTSSpeaking: this.isSpeakingNow(),
      // Hypothesis: Enabling VAD while TTS is playing may cause immediate detection
      timestamp: Date.now()
    });

    this._vadModeEnabled = true;
    this._wantListening = true;

    if (this.isListening()) {
      console.info('SR is running, VAD will start after recognition ends');
      console.log('[SM_DEBUG] enableVADMode - SR running, deferring VAD start', { timestamp: Date.now() });
      return;
    }

    if (!this.vad.isActive()) {
      // Ensure fallback is not running
      try { await this.hark.stop(); } catch {}
      try {
        console.log('[SM_DEBUG] enableVADMode - starting VAD', { timestamp: Date.now() });
        await this.vad.start();
        console.info('Voice detection: VAD enabled');
        console.log('[SM_DEBUG] enableVADMode - VAD started successfully', { timestamp: Date.now() });
        // Ensure hark stays stopped
        try { await this.hark.stop(); } catch {}
      } catch (e) {
        console.warn('VAD failed, falling back to Hark', e);
        console.log('[SM_DEBUG] enableVADMode - VAD failed, trying Hark', { error: e.message, timestamp: Date.now() });
        try { await this.vad.stop(); } catch {}
        await this.hark.start();
        console.info('Voice detection: Hark fallback enabled');
        console.log('[SM_DEBUG] enableVADMode - Hark started as fallback', { timestamp: Date.now() });
      }
    }
  }

  /**
   * Disable VAD-driven listening
   */
  async disableVADMode() {
    // [SM_DEBUG] Log VAD mode disable
    console.log('[SM_DEBUG] disableVADMode() called', {
      vadWasActive: this.vad.isActive(),
      harkWasActive: this.hark.isActive(),
      timestamp: Date.now()
    });

    this._vadModeEnabled = false;
    this._wantListening = false;
    // Stop both detectors
    try { await this.vad.stop(); } catch {}
    try { await this.hark.stop(); } catch {}
    await this.stopListening();
    console.log('[SM_DEBUG] disableVADMode - completed', { timestamp: Date.now() });
  }

  /**
   * Whether we should ignore speech-start events (e.g., during TTS or disabled)
   */
  shouldIgnoreSpeechStart() {
    const shouldIgnore = !this._wantListening || this.isSpeakingNow() || !!this._currentSpeakToken;

    // [SM_DEBUG] Log ignore decision with reasons - CRITICAL for understanding truncation
    console.log('[SM_DEBUG] shouldIgnoreSpeechStart() evaluated', {
      result: shouldIgnore,
      reasons: {
        notWantListening: !this._wantListening,
        isSpeakingNow: this.isSpeakingNow(),
        hasCurrentSpeakToken: !!this._currentSpeakToken
      },
      // Hypothesis: If this returns false while TTS is actually playing, VAD will interrupt
      timestamp: Date.now()
    });

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