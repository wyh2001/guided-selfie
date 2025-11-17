/**
 * SpeechManager
 * Unified interface for speech recognition and text-to-speech.
 * This is the main entry point for all speech functionality.
 */
import { SpeechRecognitionService } from './SpeechRecognitionService.js';
import { TextToSpeechService } from './TextToSpeechService.js';

export class SpeechManager {
  constructor() {
    this.recognition = new SpeechRecognitionService();
    this.tts = new TextToSpeechService();
    this.commandHandlers = new Map();
    
    // Set up command processing
    this.setupCommandProcessing();
  }

  setupCommandProcessing() {
    this.recognition.onResult = (transcript) => {
      this.processCommand(transcript);
    };
  }

  // TEXT-TO-SPEECH METHODS

  /**
   * Speak text (respects enabled state)
   * @param {string} text - Text to speak
   * @param {Object} options - Optional speech parameters
   */
  speak(text, options = {}) {
    return this.tts.speak(text, options);
  }

  /**
   * Enable or disable TTS
   * @param {boolean} enabled
   */
  enableTTS(enabled) {
    this.tts.setEnabled(enabled);
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
  }

  // SPEECH RECOGNITION METHODS (can be called anywhere)


  /**
   * Start listening for voice commands
   */
  startListening() {
    return this.recognition.start();
  }

  /**
   * Stop listening for voice commands
   */
  stopListening() {
    return this.recognition.stop();
  }

  /**
   * Toggle listening state
   */
  toggleListening() {
    return this.recognition.toggle();
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
   * Process a recognized transcript and execute matching commands
   * @param {string} transcript - The recognized speech text
   */
  processCommand(transcript) {
    const text = transcript.toLowerCase().trim();
    
    // Try to match against registered command handlers
    for (const [pattern, handler] of this.commandHandlers.entries()) {
      let matched = false;
      
      if (typeof pattern === 'string') {
        matched = text.includes(pattern.toLowerCase());
      } else if (pattern instanceof RegExp) {
        matched = pattern.test(text);
      }
      
      if (matched) {
        try {
          handler(transcript, text);
        } catch (error) {
          console.error('Error executing command handler:', error);
        }
      }
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
}