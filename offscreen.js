chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PLAY_SOUND') playSound();
});

function playSound() {
  const ctx = new AudioContext();

  // Two-tone chime: high then slightly lower
  const tones = [880, 660];
  tones.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.value = freq;

    const start = ctx.currentTime + i * 0.18;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.3, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);

    osc.start(start);
    osc.stop(start + 0.35);
  });
}
