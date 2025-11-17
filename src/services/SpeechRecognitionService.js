/**
 * SpeechRecognitionService
 * Independent service for handling speech recognition.
 * Manages its own state and can be called from anywhere.
 */
export class SpeechRecognitionService {
  constructor() {
    this.recognition = null;
    this.isListening = false;
    this.language = 'en-US';
    
    // Callbacks that can be set from outside
    this.onResult = null;
    this.onError = null;
    this.onStart = null;
    this.onEnd = null;
    
    this.init();
  }

  init() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      console.error('Speech Recognition API not supported in this browser');
      return;
    }
    
    this.recognition = new SpeechRecognition();
    this.recognition.interimResults = false;
    this.recognition.maxAlternatives = 1;
    this.recognition.continuous = false;
    this.recognition.lang = this.language;
    
    this.setupHandlers();
  }

  setupHandlers() {
    if (!this.recognition) return;

    this.recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript.toLowerCase().trim();
      if (this.onResult) {
        this.onResult(transcript);
      }
    };

    this.recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      this.isListening = false;
      if (this.onError) {
        this.onError(event.error);
      }
    };

    this.recognition.onstart = () => {
      this.isListening = true;
      if (this.onStart) {
        this.onStart();
      }
    };

    this.recognition.onend = () => {
      this.isListening = false;
      if (this.onEnd) {
        this.onEnd();
      }
    };
  }

  /**
   * Start listening for speech input
   */
  start() {
    if (!this.recognition) {
      console.error('Speech recognition not available');
      return false;
    }
    
    if (this.isListening) {
      console.warn('Already listening');
      return false;
    }
    
    try {
      this.recognition.start();
      return true;
    } catch (error) {
      console.error('Failed to start recognition:', error);
      return false;
    }
  }

  /**
   * Stop listening for speech input
   */
  stop() {
    if (!this.recognition) return false;
    
    if (!this.isListening) {
      return false;
    }
    
    try {
      this.recognition.stop();
      return true;
    } catch (error) {
      console.error('Failed to stop recognition:', error);
      return false;
    }
  }

  /**
   * Toggle listening state
   */
  toggle() {
    if (this.isListening) {
      return this.stop();
    } else {
      return this.start();
    }
  }

  /**
   * Set the language for recognition
   * @param {string} lang - Language code (e.g., 'en-US', 'es-ES')
   */
  setLanguage(lang) {
    this.language = lang;
    if (this.recognition) {
      this.recognition.lang = lang;
    }
  }

  /**
   * Get current language
   */
  getLanguage() {
    return this.language;
  }

  /**
   * Check if currently listening
   */
  isActive() {
    return this.isListening;
  }

  /**
   * Check if speech recognition is supported
   */
  isSupported() {
    return this.recognition !== null;
  }
}