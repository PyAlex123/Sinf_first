/** Short synthesized sounds for right / wrong answers (the author's `beep`), no audio files. */
let context: AudioContext | null = null;

export function beep(ok: boolean): void {
  try {
    context ??= new AudioContext();
    const ctx = context;
    const notes = ok ? [660, 880] : [220];
    notes.forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = ctx.currentTime + i * 0.12;
      osc.frequency.value = frequency;
      osc.type = ok ? 'triangle' : 'sawtooth';
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(ok ? 0.25 : 0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.3);
    });
  } catch {
    // audio unavailable
  }
}
