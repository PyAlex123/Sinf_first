/** Reads a task aloud with the browser's Russian voice, if there is one (lesson content is in Russian). */
export function speak(text: string): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ru-RU';
    utterance.rate = 0.9;
    const voice = synth.getVoices().find((v) => v.lang.startsWith('ru'));
    if (voice) utterance.voice = voice;
    synth.speak(utterance);
  } catch {
    // no speech on this device
  }
}

export function stopSpeaking(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // ignore
  }
}
