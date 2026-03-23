// public/audio-processor.js
// AudioWorklet processor — accumulates 128-sample frames into 4096-sample
// chunks before sending to the main thread. This matches the old
// ScriptProcessorNode(4096) behaviour that AssemblyAI expects.

class PCMProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      // Internal buffer to accumulate samples across multiple process() calls
      // process() gives 128 samples per call at 16kHz = 8ms per call
      // We accumulate until we have 4096 samples (~256ms) before posting
      this._buffer    = [];
      this._bufferSize = 4096;
    }
  
    process(inputs) {
      const channel = inputs[0]?.[0];
  
      // No audio input — keep processor alive
      if (!channel || channel.length === 0) return true;
  
      // Accumulate samples into internal buffer
      for (let i = 0; i < channel.length; i++) {
        this._buffer.push(channel[i]);
      }
  
      // Only post when we have enough samples (4096)
      while (this._buffer.length >= this._bufferSize) {
        // Splice exactly bufferSize samples from the front
        const chunk   = this._buffer.splice(0, this._bufferSize);
        const float32 = new Float32Array(chunk);
  
        // Convert Float32 (-1.0..+1.0) → Int16 (-32768..32767)
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
        }
  
        // Zero-copy transfer to main thread via Transferable
        this.port.postMessage(int16.buffer, [int16.buffer]);
      }
  
      // Return true to keep processor alive
      return true;
    }
  }
  
  registerProcessor("pcm-processor", PCMProcessor);