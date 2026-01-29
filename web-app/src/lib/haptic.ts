/* eslint-disable @typescript-eslint/no-explicit-any */

export const hapticFeedback = (type: HapticType) => {
  if (type === "none" || typeof window === "undefined") return;

  try {
    const AudioContext =
      window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();
    const now = ctx.currentTime;

    switch (type) {
      case "heavy": {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(180, now);
        oscillator.frequency.exponentialRampToValueAtTime(40, now + 0.15);

        gainNode.gain.setValueAtTime(0.4, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

        oscillator.start(now);
        oscillator.stop(now + 0.15);
        break;
      }

      case "light": {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(800, now);

        gainNode.gain.setValueAtTime(0.15, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

        oscillator.start(now);
        oscillator.stop(now + 0.08);
        break;
      }

      case "pop": {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(1200, now);
        oscillator.frequency.exponentialRampToValueAtTime(300, now + 0.05);

        gainNode.gain.setValueAtTime(0.3, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.05);

        oscillator.start(now);
        oscillator.stop(now + 0.05);
        break;
      }

      case "soft": {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(400, now);
        oscillator.frequency.exponentialRampToValueAtTime(300, now + 0.1);

        gainNode.gain.setValueAtTime(0.08, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);

        oscillator.start(now);
        oscillator.stop(now + 0.1);
        break;
      }

      case "double": {
        // First tap
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.connect(gain1);
        gain1.connect(ctx.destination);

        osc1.type = "sine";
        osc1.frequency.setValueAtTime(600, now);
        gain1.gain.setValueAtTime(0.2, now);
        gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.04);
        osc1.start(now);
        osc1.stop(now + 0.04);

        // Second tap
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);

        osc2.type = "sine";
        osc2.frequency.setValueAtTime(800, now + 0.06);
        gain2.gain.setValueAtTime(0.25, now + 0.06);
        gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc2.start(now + 0.06);
        osc2.stop(now + 0.1);
        break;
      }

      case "swoosh": {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = "sawtooth";
        oscillator.frequency.setValueAtTime(200, now);
        oscillator.frequency.exponentialRampToValueAtTime(1000, now + 0.08);
        oscillator.frequency.exponentialRampToValueAtTime(400, now + 0.12);

        gainNode.gain.setValueAtTime(0.1, now);
        gainNode.gain.linearRampToValueAtTime(0.15, now + 0.06);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

        oscillator.start(now);
        oscillator.stop(now + 0.12);
        break;
      }
    }
  } catch (e) {
    console.error("Audio haptic failed", e);
  }
};
