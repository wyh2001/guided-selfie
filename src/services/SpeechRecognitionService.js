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

    // [SR_DEBUG] Debug tracking for mobile TTS truncation diagnosis
    this._debugSessionId = 0;
    this._debugLastStatusChange = 0;

    // [SR_DEBUG] Log initialization
    console.log('[SR_DEBUG] SpeechRecognitionService initialized', {
      userAgent: navigator.userAgent,
      isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
      timestamp: Date.now()
    });

    this.init();
  }

  _setStatus(s) {
    const prevStatus = this.status;
    const now = Date.now();
    const timeSinceLastChange = this._debugLastStatusChange ? now - this._debugLastStatusChange : 'first';

    this.status = s;
    this.isListening = (s === "listening");
    this._debugLastStatusChange = now;

    // [SR_DEBUG] Log status transitions - hypothesis: rapid transitions may indicate conflicts
    console.log('[SR_DEBUG] status changed', {
      from: prevStatus,
      to: s,
      isListening: this.isListening,
      timeSinceLastChange,
      // Hypothesis: Very rapid status changes may indicate race conditions
      possibleRaceCondition: typeof timeSinceLastChange === 'number' && timeSinceLastChange < 100,
      timestamp: now
    });
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
      // [SR_DEBUG] Log result events
      console.log('[SR_DEBUG] onresult event', {
        resultIndex: event.resultIndex,
        resultsLength: event.results.length,
        timestamp: Date.now()
      });

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (!res?.isFinal) continue; // Only handle final results
        const transcript = res[0].transcript.toLowerCase().trim();
        if (!transcript) continue;

        console.log('[SR_DEBUG] Final result received', {
          transcript: transcript.substring(0, 50),
          confidence: res[0].confidence,
          timestamp: Date.now()
        });

        this.onResult?.(transcript);
      }
    };

    rec.onstart = () => {
      const sessionId = ++this._debugSessionId;
      // [SR_DEBUG] Log session start
      console.log(`[SR_DEBUG] onstart event - session #${sessionId}`, {
        timestamp: Date.now()
      });
      this._setStatus("listening");
      this.onStart?.();
    };

    rec.onend = () => {
      // [SR_DEBUG] Log session end
      console.log(`[SR_DEBUG] onend event - session #${this._debugSessionId}`, {
        previousStatus: this.status,
        timestamp: Date.now()
      });
      this._setStatus("idle");
      this.onEnd?.();
    };

    rec.onerror = (event) => {
      // [SR_DEBUG] Detailed error logging
      console.log('[SR_DEBUG] onerror event', {
        error: event.error,
        message: event.message,
        // Hypothesis: 'aborted' errors during TTS may indicate audio conflict
        timestamp: Date.now()
      });
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
    const startTime = Date.now();

    // [SR_DEBUG] Log start attempts
    console.log('[SR_DEBUG] start() called', {
      currentStatus: this.status,
      hasRecognition: !!this.recognition,
      hasStartingPromise: !!this._startingPromise,
      hasStoppingPromise: !!this._stoppingPromise,
      timestamp: startTime
    });

    const rec = this.recognition;
    if (!rec) return false;

    // Already listening
    if (this.status === "listening") {
      console.log('[SR_DEBUG] start() - already listening, returning true', { timestamp: Date.now() });
      return true;
    }

    if (this._startingPromise) {
      console.log('[SR_DEBUG] start() - already starting, returning existing promise', { timestamp: Date.now() });
      return this._startingPromise;
    }

    // Wait for ongoing stop
    if (this._stoppingPromise) {
      console.log('[SR_DEBUG] start() - waiting for stop to complete', { timestamp: Date.now() });
      await this._stoppingPromise;
      console.log('[SR_DEBUG] start() - stop completed, proceeding', { timestamp: Date.now() });
    }

    this._setStatus("starting");

    this._startingPromise = new Promise((resolve) => {
      const cleanup = () => {
        rec.removeEventListener("start", onStart);
        rec.removeEventListener("error", onError);
        this._startingPromise = null;
      };

      const onStart = () => {
        console.log('[SR_DEBUG] start() - onStart callback fired', { timestamp: Date.now() });
        cleanup();
        resolve(true);
      };
      const onError = () => {
        console.log('[SR_DEBUG] start() - onError callback fired', { timestamp: Date.now() });
        cleanup();
        resolve(false);
      };

      rec.addEventListener("start", onStart, { once: true });
      rec.addEventListener("error", onError, { once: true });

      try {
        console.log('[SR_DEBUG] start() - calling rec.start()', { timestamp: Date.now() });
        rec.start();
        console.log('[SR_DEBUG] start() - rec.start() returned', { timestamp: Date.now() });
      } catch (e) {
        console.error("Failed to start recognition:", e);
        console.log('[SR_DEBUG] start() - rec.start() threw exception', { error: e.message, timestamp: Date.now() });
        cleanup();
        this._setStatus("idle");
        resolve(false);
      }
    });

    const ok = await this._startingPromise;
    console.log('[SR_DEBUG] start() - completed', { success: ok, timestamp: Date.now() });
    if (!ok) this._setStatus("idle");
    return ok;
  }

  /**
   * Stop listening for speech input
   * Has 4s timeout to force abort if no end event
   * @returns {Promise<boolean>} true if stopped successfully
   */
  async stop() {
    const stopTime = Date.now();

    // [SR_DEBUG] Log stop attempts with context
    console.log('[SR_DEBUG] stop() called', {
      currentStatus: this.status,
      hasRecognition: !!this.recognition,
      hasStartingPromise: !!this._startingPromise,
      hasStoppingPromise: !!this._stoppingPromise,
      callStack: new Error().stack?.split('\n').slice(1, 4).join(' <- '),
      timestamp: stopTime
    });

    const rec = this.recognition;
    if (!rec) return false;

    // Already stopped
    if (this.status === "idle") {
      console.log('[SR_DEBUG] stop() - already idle, returning true', { timestamp: Date.now() });
      return true;
    }

    // Merge concurrent stop calls
    if (this._stoppingPromise) {
      console.log('[SR_DEBUG] stop() - already stopping, returning existing promise', { timestamp: Date.now() });
      return this._stoppingPromise;
    }

    // If starting, abort first
    if (this._startingPromise && this.status === "starting") {
      console.log('[SR_DEBUG] stop() - aborting during start', { timestamp: Date.now() });
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
        console.log('[SR_DEBUG] stop() - finish called', { ok, timestamp: Date.now() });
        cleanup();
        this._setStatus("idle");
        resolve(ok);
      };

      const onEnd = () => {
        console.log('[SR_DEBUG] stop() - onEnd callback fired', { timestamp: Date.now() });
        finish(true);
      };
      const onError = () => {
        console.log('[SR_DEBUG] stop() - onError callback fired (treating as stopped)', { timestamp: Date.now() });
        finish(true); // Treat as stopped
      };

      rec.addEventListener("end", onEnd, { once: true });
      rec.addEventListener("error", onError, { once: true });

      const guard = setTimeout(() => {
        console.log('[SR_DEBUG] stop() - guard timeout triggered, forcing abort', { timestamp: Date.now() });
        try { rec.abort(); } catch {}
      }, STOP_TIMEOUT_MS);

      try {
        if (this.status === "listening" || this.status === "stopping") {
          console.log('[SR_DEBUG] stop() - calling rec.stop()', { timestamp: Date.now() });
          rec.stop();
        } else {
          console.log('[SR_DEBUG] stop() - calling rec.abort()', { timestamp: Date.now() });
          rec.abort();
        }
      } catch (e) {
        console.warn("Failed to stop recognition:", e);
        console.log('[SR_DEBUG] stop() - exception during stop/abort', { error: e.message, timestamp: Date.now() });
        cleanup();
        this._setStatus("idle");
        resolve(false);
      }
    });

    const result = await this._stoppingPromise;
    console.log('[SR_DEBUG] stop() - completed', { success: result, timestamp: Date.now() });
    return result;
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