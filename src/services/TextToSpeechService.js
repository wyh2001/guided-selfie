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
   * @param {Object} options - Optional parameters (rate, pitch, volume)
   */
  speak(text, options = {}) {
    // Only speak if enabled
    if (!this.enabled) {
      return false;
    }
    
    if (!this.synthesis) {
      console.error('Speech synthesis not available');
      return false;
    }
    
    if (!text || text.trim() === '') {
      return false;
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
    
    this.synthesis.speak(utterance);
    return true;
  }

  /**
   * Enable or disable TTS
   * @param {boolean} enabled - Whether TTS should be enabled
   */
  setEnabled(enabled) {
    const wasEnabled = this.enabled;
    this.enabled = enabled;
    
    // If disabling, cancel any ongoing speech
    if (!enabled && wasEnabled) {
      this.cancel();
    }
    
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