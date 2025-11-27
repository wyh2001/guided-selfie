/**
 * SpeechRecognitionService
 * Independent service for handling speech recognition.
 * Manages its own state and can be called from anywhere.
 */

const STOP_TIMEOUT_MS = 4000;

export class SpeechRecognitionService {
  constructor() {
    this.recognition = null;
    this.isListening = false;
    this.language = 'en-US';
    
    // idle | starting | listening | stopping
    this.status = "idle";

    // Concurrency control
    this._startingPromise = null;
    this._stoppingPromise = null;
    
    // Callbacks that can be set from outside
    this.onResult = null;
    this.onError = null;
    this.onStart = null;
    this.onEnd = null;
    
    this.init();
  }

  _setStatus(s) {
    this.status = s;
    this.isListening = (s === "listening");
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
    
    this._setupHandlers();
  }

  _setupHandlers() {
    const rec = this.recognition;
    if (!rec) return;

    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (!res?.isFinal) continue; // Only handle final results
        const transcript = res[0].transcript.toLowerCase().trim();
        if (!transcript) continue;
        this.onResult?.(transcript);
      }
    };

    rec.onstart = () => {
      this._setStatus("listening");
      this.onStart?.();
    };

    rec.onend = () => {
      this._setStatus("idle");
      this.onEnd?.();
    };

    rec.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      if (this.status !== "idle") this._setStatus("idle");
      this.onError?.(event?.error ?? event);
    };
  }

  /**
   * Start listening for speech input
   * @returns {Promise<boolean>} true if started successfully
   */
  async start() {
    const rec = this.recognition;
    if (!rec) return false;

    // Already listening
    if (this.status === "listening") return true;

    if (this._startingPromise) return this._startingPromise;

    // Wait for ongoing stop
    if (this._stoppingPromise) await this._stoppingPromise;

    this._setStatus("starting");

    this._startingPromise = new Promise((resolve) => {
      const cleanup = () => {
        rec.removeEventListener("start", onStart);
        rec.removeEventListener("error", onError);
        this._startingPromise = null;
      };

      const onStart = () => { cleanup(); resolve(true); };
      const onError = () => { cleanup(); resolve(false); };

      rec.addEventListener("start", onStart, { once: true });
      rec.addEventListener("error", onError, { once: true });

      try {
        rec.start();
      } catch (e) {
        console.error("Failed to start recognition:", e);
        cleanup();
        this._setStatus("idle");
        resolve(false);
      }
    });

    const ok = await this._startingPromise;
    if (!ok) this._setStatus("idle");
    return ok;
  }

  /**
   * Stop listening for speech input
   * Has 4s timeout to force abort if no end event
   * @returns {Promise<boolean>} true if stopped successfully
   */
  async stop() {
    const rec = this.recognition;
    if (!rec) return false;

    // Already stopped
    if (this.status === "idle") return true;

    // Merge concurrent stop calls
    if (this._stoppingPromise) return this._stoppingPromise;

    // If starting, abort first
    if (this._startingPromise && this.status === "starting") {
      try { rec.abort(); } catch {}
      try { await this._startingPromise; } catch {}
    }

    this._setStatus("stopping");

    this._stoppingPromise = new Promise((resolve) => {
      let settled = false;

      const cleanup = () => {
        settled = true;
        clearTimeout(guard);
        rec.removeEventListener("end", onEnd);
        rec.removeEventListener("error", onError);
        this._stoppingPromise = null;
      };

      const finish = (ok) => {
        if (settled) return;
        cleanup();
        this._setStatus("idle");
        resolve(ok);
      };

      const onEnd = () => finish(true);
      const onError = () => finish(true); // Treat as stopped

      rec.addEventListener("end", onEnd, { once: true });
      rec.addEventListener("error", onError, { once: true });

      const guard = setTimeout(() => {
        try { rec.abort(); } catch {}
      }, STOP_TIMEOUT_MS);

      try {
        if (this.status === "listening" || this.status === "stopping") {
          rec.stop();
        } else {
          rec.abort();
        }
      } catch (e) {
        console.warn("Failed to stop recognition:", e);
        cleanup();
        this._setStatus("idle");
        resolve(false);
      }
    });

    return await this._stoppingPromise;
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
   * Auto-restarts if currently listening
   * @param {string} lang - Language code (e.g., 'en-US', 'es-ES')
   */
  setLanguage(lang) {
    this.language = lang;
    if (this.recognition) {
      const shouldRestart = this.isActive();
      this.recognition.lang = lang;
      if (shouldRestart) {
        this.stop().then(() => this.start());
      }
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