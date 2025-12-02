/**
 * TextToSpeechService
 * Independent service for text-to-speech functionality.
 * Manages its own enabled/disabled state internally.
 */
export class TextToSpeechService {
  constructor() {
    this.enabled = false;
    this.synthesis = window.speechSynthesis;
    this.voice = null;
    this.rate = 1.0;
    this.pitch = 1.0;
    this.volume = 1.0;
    
    // Callback for when enabled state changes
    this.onEnabledChange = null;
    
    if (!this.synthesis) {
      console.warn('Speech Synthesis API not supported in this browser');
    }
  }

  /**
   * Speak the given text (only if TTS is enabled)
   * @param {string} text - Text to speak
   * @param {Object} options - Optional parameters (rate, pitch, volume, onEnd, onError)
   * @returns {boolean} - Whether speech was initiated
   * @deprecated Use speakAsync for better control flow
   */
  speak(text, options = {}) {
    // Compatibility wrapper
    this.speakAsync(text, options).then(
      (success) => {
        if (success && typeof options.onEnd === 'function') {
          options.onEnd();
        }
      },
      (error) => {
        if (typeof options.onError === 'function') {
          options.onError(error);
        }
      }
    );
    
    // Return if speak
    return this.enabled && !!this.synthesis && !!text?.trim();
  }

  /**
   * Speak the given text asynchronously (Promise-based)
   * @param {string} text - Text to speak
   * @param {Object} options - Optional parameters (rate, pitch, volume, timeout)
   * @returns {Promise<boolean>} - Resolves to true if speech completed, false if not started or failed
   */
  speakAsync(text, options = {}) {
    // Only speak if enabled
    if (!this.enabled || !this.synthesis || !text?.trim()) {
      return Promise.resolve(false);
    }
    
    // Cancel any ongoing speech
    this.synthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Use custom voice if set
    if (this.voice) {
      utterance.voice = this.voice;
    }
    
    // Apply options or use defaults
    utterance.rate = options.rate ?? this.rate;
    utterance.pitch = options.pitch ?? this.pitch;
    utterance.volume = options.volume ?? this.volume;

    return new Promise((resolve) => {
      let timeoutId = null;
      let resolved = false;

      const cleanup = (result) => {
        if (resolved) return;
        resolved = true;
        if (timeoutId) clearTimeout(timeoutId);
        resolve(result);
      };

      utterance.onend = () => cleanup(true);
      utterance.onerror = (error) => {
        console.warn('Speech synthesis error:', error);
        cleanup(false);
      };

      const timeout = options.timeout ?? 3000;
      timeoutId = setTimeout(() => {
        console.warn('Speech synthesis timeout after', timeout, 'ms');
        this.synthesis.cancel();
        cleanup(false);
      }, timeout);

    try {
      this.synthesis.speak(utterance);
    } catch (error) {
        console.error('Failed to initiate speech:', error);
        cleanup(false);
      }
    });
  }

  /**
   * Enable or disable TTS
   * @param {boolean} enabled - Whether TTS should be enabled
   */
  setEnabled(enabled) {
    const wasEnabled = this.enabled;
    this.enabled = !!enabled;
    
    // Notify listeners of state change
    if (this.onEnabledChange && wasEnabled !== enabled) {
      this.onEnabledChange(enabled);
    }
  }

  /**
   * Check if TTS is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Toggle TTS enabled state
   */
  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  /**
   * Cancel any ongoing speech
   */
  cancel() {
    if (this.synthesis) {
      this.synthesis.cancel();
    }
  }

  /**
   * Set the voice to use for speech
   * @param {SpeechSynthesisVoice} voice - Voice object
   */
  setVoice(voice) {
    this.voice = voice;
  }

  /**
   * Get list of available voices
   */
  getAvailableVoices() {
    if (!this.synthesis) return [];
    return this.synthesis.getVoices();
  }

  /**
   * Set speech rate (0.1 to 10)
   */
  setRate(rate) {
    this.rate = Math.max(0.1, Math.min(10, rate));
  }

  /**
   * Set speech pitch (0 to 2)
   */
  setPitch(pitch) {
    this.pitch = Math.max(0, Math.min(2, pitch));
  }

  /**
   * Set speech volume (0 to 1)
   */
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  /**
   * Check if speech synthesis is supported
   */
  isSupported() {
    return this.synthesis !== null;
  }

  /**
   * Check if currently speaking
   */
  isSpeaking() {
    return this.synthesis ? this.synthesis.speaking : false;
  }
}