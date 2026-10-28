// Runs in the browser's audio thread. Turns the laptop mic into the same
// audio the glasses send: 16 kHz, 16-bit, mono PCM, in 100 ms chunks. Also
// reports the loudness, for the level meter.

const TARGET_RATE = 16000;
const CHUNK = 1600; // 100 ms at 16 kHz

class MicWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / TARGET_RATE; // input samples per output sample
    this.pos = 0;
    this.out = new Int16Array(CHUNK);
    this.n = 0;
    this.sum = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    // Average the input samples that fall into each output sample.
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i];
      this.pos += 1;
      if (this.pos >= this.step) {
        const v = Math.max(-1, Math.min(1, this.sum / this.pos));
        this.out[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        this.pos -= this.step;
        this.sum = 0;
        if (this.n === CHUNK) {
          let sq = 0;
          for (let k = 0; k < CHUNK; k++) sq += this.out[k] * this.out[k];
          const pcm = this.out.slice(0);
          this.port.postMessage({ pcm: pcm.buffer, level: Math.sqrt(sq / CHUNK) }, [pcm.buffer]);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('mic-worklet', MicWorklet);
