/**
 * @file Interface sound effects, synthesised with the Web Audio API (no audio
 * files needed): cursor, confirm, cancel, buzzer and message "blip". Audio
 * starts muted by the browser until the first user gesture; `unlock()` is
 * called on the first key press or touch.
 */

/** Available interface sounds. */
export type UiSound = 'cursor' | 'ok' | 'cancel' | 'buzzer' | 'blip';

/** Tiny synthesiser for interface sounds. */
export class UiAudio {
  private ctx: AudioContext | null = null;
  /** Volume 0–1 (from the options). */
  volume = 0.5;

  /** Creates or resumes the audio context (must follow a user gesture). */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(freq: number, start: number, duration: number, type: OscillatorType, gain: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
    g.gain.setValueAtTime(0, ctx.currentTime + start);
    g.gain.linearRampToValueAtTime(gain * this.volume, ctx.currentTime + start + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + duration + 0.02);
  }

  /**
   * Plays a sound file (event sound effects).
   * @param url - File URL.
   * @param volume - 0–100.
   * @param pitch - 50–150 (playback rate in percent).
   */
  playFile(url: string, volume: number, pitch: number): void {
    if (this.volume <= 0) return;
    const audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, (this.volume * volume) / 100));
    audio.playbackRate = Math.max(0.5, Math.min(1.5, pitch / 100));
    void audio.play().catch(() => undefined);
  }

  /** Plays an interface sound. */
  play(sound: UiSound): void {
    if (!this.ctx || this.volume <= 0) return;
    switch (sound) {
      case 'cursor':
        this.tone(880, 0, 0.05, 'square', 0.08);
        break;
      case 'ok':
        this.tone(660, 0, 0.06, 'square', 0.1);
        this.tone(990, 0.05, 0.08, 'square', 0.1);
        break;
      case 'cancel':
        this.tone(520, 0, 0.06, 'square', 0.1);
        this.tone(390, 0.05, 0.08, 'square', 0.1);
        break;
      case 'buzzer':
        this.tone(120, 0, 0.18, 'sawtooth', 0.12);
        break;
      case 'blip':
        this.tone(1200, 0, 0.02, 'triangle', 0.04);
        break;
    }
  }
}
