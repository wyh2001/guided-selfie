/**
 * Speech Commands Registration
 * Contains default voice command handlers.
 * Can be imported and registered with SpeechManager by main entry point.
 */

/**
 * Dispatch a voice command as a custom event
 * @param {string} command - Command name to dispatch
 */
function dispatchVoiceCommand(command) {
  // document.dispatchEvent(new CustomEvent('voice:command', {
  //   detail: { command }
  // }));
  // console.log('Voice command dispatched:', command);
}

/**
 * Register default voice commands with a SpeechManager instance
 * @param {SpeechManager} manager - The SpeechManager instance to register commands on
 */
export function registerDefaultVoiceCommands(manager) {
  // Capture/photo commands
  // manager.registerCommand('take', (transcript) => {
  //   if (transcript.includes('photo') || transcript.includes('capture') || transcript.includes('snap')) {
  //     dispatchVoiceCommand('take-photo');
  //     manager.speak('Photo captured');
  //   }
  // });

  // manager.registerCommand('capture', () => {
  //   dispatchVoiceCommand('take-photo');
  //   manager.speak('Capturing photo');
  // });

  // manager.registerCommand('snap', () => {
  //   dispatchVoiceCommand('take-photo');
  //   manager.speak('Snap');
  // });
  
  // console.log('Default voice commands registered');
}
