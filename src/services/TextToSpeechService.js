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

    // Debug: Track speech timing for mobile truncation diagnosis
    this._debugSpeechId = 0;
    this._debugLastSpeechStart = 0;

    if (!this.synthesis) {
      console.warn('Speech Synthesis API not supported in this browser');
    }

    // [TTS_DEBUG] Log initial synthesis state - hypothesis: mobile may have different initial state
    console.log('[TTS_DEBUG] TextToSpeechService initialized', {
      synthesisAvailable: !!this.synthesis,
      userAgent: navigator.userAgent,
      // Hypothesis: Mobile browsers may have different synthesis implementations
      isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
      timestamp: Date.now()
    });
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
   * @param {Object} options - Optional parameters (rate, pitch, volume)
   * @returns {Promise<boolean>} - Resolves to true if speech completed, false if not started or failed
   */
  async speakAsync(text, options = {}) {
    const speechId = ++this._debugSpeechId;
    const startTime = Date.now();

    // [TTS_DEBUG] Log every speak attempt with hypothesis context
    console.log(`[TTS_DEBUG] speakAsync called #${speechId}`, {
      textLength: text?.length,
      textPreview: text?.substring(0, 50),
      enabled: this.enabled,
      synthesisAvailable: !!this.synthesis,
      // Hypothesis: If speaking is true when we start, previous speech may not have ended cleanly
      currentlySpeaking: this.synthesis?.speaking,
      currentlyPending: this.synthesis?.pending,
      currentlyPaused: this.synthesis?.paused,
      timeSinceLastSpeech: this._debugLastSpeechStart ? startTime - this._debugLastSpeechStart : 'first',
      timestamp: startTime
    });

    // Only speak if enabled
    if (!this.enabled || !this.synthesis || !text?.trim()) {
      console.log(`[TTS_DEBUG] speakAsync #${speechId} early return - not enabled or no text`);
      return Promise.resolve(false);
    }

    // Cancel any ongoing speech
    // [TTS_DEBUG] Hypothesis: cancel() may behave differently on mobile, potentially causing issues
    const wasSpeaking = this.synthesis.speaking;
    console.log(`[TTS_DEBUG] #${speechId} calling synthesis.cancel()`, {
      wasSpeaking,
      wasPending: this.synthesis.pending,
      // Hypothesis: On mobile, rapid cancel+speak may cause truncation
      timestamp: Date.now()
    });
    this.synthesis.cancel();
    await new Promise(r => setTimeout(r, 50));

    const utterance = new SpeechSynthesisUtterance(text);

    // Use custom voice if set
    if (this.voice) {
      utterance.voice = this.voice;
    }

    // Apply options or use defaults
    utterance.rate = options.rate ?? this.rate;
    utterance.pitch = options.pitch ?? this.pitch;
    utterance.volume = options.volume ?? this.volume;

    // [TTS_DEBUG] Log utterance configuration
    console.log(`[TTS_DEBUG] #${speechId} utterance configured`, {
      rate: utterance.rate,
      pitch: utterance.pitch,
      volume: utterance.volume,
      voiceName: utterance.voice?.name || 'default',
      lang: utterance.lang || 'default'
    });

    return new Promise((resolve) => {
      let utteranceStartTime = null;
      let boundaryCount = 0;

      // [TTS_DEBUG] Track utterance start - hypothesis: onstart may fire but speech gets cut
      utterance.onstart = () => {
        utteranceStartTime = Date.now();
        this._debugLastSpeechStart = utteranceStartTime;
        const timeSinceRequest = utteranceStartTime - startTime;
        console.log(`[TTS_DEBUG] #${speechId} utterance.onstart fired`, {
          timeSinceRequest,
          synthesisState: {
            speaking: this.synthesis.speaking,
            pending: this.synthesis.pending,
            paused: this.synthesis.paused
          },
          // Hypothesis: Long delay between request and start may indicate queue issues
          timestamp: utteranceStartTime
        });

        // [TTS_DEBUG] CRITICAL: Log audio context state if available
        // Hypothesis: AudioContext may be in a state that causes initial audio to be clipped
        try {
          const audioCtx = window.AudioContext || window.webkitAudioContext;
          if (audioCtx) {
            const ctx = new audioCtx();
            console.log(`[TTS_DEBUG] #${speechId} AudioContext state at TTS start`, {
              state: ctx.state,
              sampleRate: ctx.sampleRate,
              baseLatency: ctx.baseLatency,
              outputLatency: ctx.outputLatency,
              // Hypothesis: High latency values may indicate audio system busy with mic input
              timestamp: Date.now()
            });
            ctx.close();
          }
        } catch (e) {
          console.log(`[TTS_DEBUG] #${speechId} Could not check AudioContext`, { error: e.message });
        }
      };

      // [TTS_DEBUG] Track word boundaries - hypothesis: speech may be cut mid-word
      // CRITICAL: First boundary event tells us when audio actually starts being heard
      let firstBoundaryTime = null;
      utterance.onboundary = (event) => {
        boundaryCount++;
        if (boundaryCount === 1) {
          firstBoundaryTime = Date.now();
          const timeSinceOnStart = utteranceStartTime ? firstBoundaryTime - utteranceStartTime : 'unknown';
          // [TTS_DEBUG] CRITICAL: Time from onstart to first boundary = audio actually audible
          console.log(`[TTS_DEBUG] #${speechId} FIRST BOUNDARY - audio now audible`, {
            name: event.name,
            charIndex: event.charIndex,
            timeSinceOnStart,
            // Hypothesis: If charIndex > 0 at first boundary, initial text was already "spoken" but not heard
            // This would confirm audio clipping at start
            initialCharsClipped: event.charIndex,
            textPreview: text.substring(0, event.charIndex + 10),
            // Hypothesis: Long timeSinceOnStart with charIndex > 0 = audio system delay clipping start
            possibleStartClipping: event.charIndex > 0,
            timestamp: firstBoundaryTime
          });
        }
        // Log every 5th boundary to avoid spam, but always log first few
        if (boundaryCount <= 3 || boundaryCount % 5 === 0) {
          console.log(`[TTS_DEBUG] #${speechId} utterance.onboundary #${boundaryCount}`, {
            name: event.name,
            charIndex: event.charIndex,
            charLength: event.charLength,
            elapsedTime: event.elapsedTime,
            // Hypothesis: If charIndex is less than text length at onend, speech was truncated
            textLength: text.length,
            timestamp: Date.now()
          });
        }
      };

      // [TTS_DEBUG] Track pause events - hypothesis: mobile may pause unexpectedly
      utterance.onpause = () => {
        console.log(`[TTS_DEBUG] #${speechId} utterance.onpause fired`, {
          duration: utteranceStartTime ? Date.now() - utteranceStartTime : 'unknown',
          // Hypothesis: Unexpected pause may be caused by audio focus loss to VAD/mic
          timestamp: Date.now()
        });
      };

      // [TTS_DEBUG] Track resume events
      utterance.onresume = () => {
        console.log(`[TTS_DEBUG] #${speechId} utterance.onresume fired`, {
          timestamp: Date.now()
        });
      };

      utterance.onend = () => {
        const endTime = Date.now();
        const duration = utteranceStartTime ? endTime - utteranceStartTime : 'unknown';
        console.log(`[TTS_DEBUG] #${speechId} utterance.onend fired`, {
          duration,
          totalBoundaries: boundaryCount,
          textLength: text.length,
          // Hypothesis: Very short duration relative to text length indicates truncation
          // Rough estimate: ~150 words/min = ~750 chars/min = ~12.5 chars/sec
          expectedMinDuration: Math.floor(text.length / 15 * 1000), // conservative estimate
          possibleTruncation: typeof duration === 'number' && duration < (text.length / 15 * 1000) * 0.5,
          // [TTS_DEBUG] CRITICAL: If totalBoundaries is 0, we have no boundary events
          // This means we can't detect mid-speech clipping, only timing-based truncation
          noBoundaryEvents: boundaryCount === 0,
          synthesisState: {
            speaking: this.synthesis.speaking,
            pending: this.synthesis.pending,
            paused: this.synthesis.paused
          },
          timestamp: endTime
        });

        // [TTS_DEBUG] CRITICAL SUMMARY for this speech
        if (boundaryCount === 0) {
          console.log(`[TTS_DEBUG] #${speechId} ⚠️ NO BOUNDARY EVENTS - cannot detect word-level clipping`, {
            text: text.substring(0, 50),
            // Hypothesis: Some browsers/devices don't fire boundary events
            // This makes it impossible to detect if initial words were clipped
            timestamp: Date.now()
          });
        }

        resolve(true);
      };

      utterance.onerror = (error) => {
        const errorTime = Date.now();
        // [TTS_DEBUG] Detailed error logging - hypothesis: specific error types may indicate VAD interference
        console.warn(`[TTS_DEBUG] #${speechId} utterance.onerror`, {
          error: error.error,
          errorMessage: error.message,
          errorType: error.type,
          // Hypothesis: 'interrupted' or 'canceled' errors may be caused by VAD triggering
          charIndex: error.charIndex,
          elapsedTime: error.elapsedTime,
          duration: utteranceStartTime ? errorTime - utteranceStartTime : 'unknown',
          totalBoundaries: boundaryCount,
          textLength: text.length,
          timestamp: errorTime
        });
        console.warn('Speech synthesis error:', error);
        resolve(false);
      };

    try {
      console.log(`[TTS_DEBUG] #${speechId} calling synthesis.speak()`, {
        timestamp: Date.now()
      });
      this.synthesis.speak(utterance);
      // [TTS_DEBUG] Log state immediately after speak() call
      console.log(`[TTS_DEBUG] #${speechId} after synthesis.speak()`, {
        speaking: this.synthesis.speaking,
        pending: this.synthesis.pending,
        paused: this.synthesis.paused,
        // Hypothesis: If not speaking/pending immediately, something may be wrong
        timestamp: Date.now()
      });
    } catch (error) {
        console.error(`[TTS_DEBUG] #${speechId} synthesis.speak() threw exception`, error);
        console.error('Failed to initiate speech:', error);
        resolve(false);
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
      // [TTS_DEBUG] Log cancel calls - hypothesis: external cancel calls may be causing truncation
      console.log('[TTS_DEBUG] cancel() called externally', {
        wasSpeaking: this.synthesis.speaking,
        wasPending: this.synthesis.pending,
        // Hypothesis: If this is called while speaking, it may be from VAD interference
        callStack: new Error().stack?.split('\n').slice(1, 5).join(' <- '),
        timestamp: Date.now()
      });
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
    const speaking = this.synthesis ? this.synthesis.speaking : false;
    // [TTS_DEBUG] Log isSpeaking checks occasionally - hypothesis: frequent checks during speech may indicate polling
    if (this._debugIsSpeakingLogCount === undefined) {
      this._debugIsSpeakingLogCount = 0;
    }
    this._debugIsSpeakingLogCount++;
    // Log every 20th call to avoid spam
    if (this._debugIsSpeakingLogCount % 20 === 0) {
      console.log('[TTS_DEBUG] isSpeaking() polled', {
        result: speaking,
        pending: this.synthesis?.pending,
        paused: this.synthesis?.paused,
        callCount: this._debugIsSpeakingLogCount,
        timestamp: Date.now()
      });
    }
    return speaking;
  }
}