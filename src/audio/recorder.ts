import { downsample } from "../core/resample";

export const TARGET_SAMPLE_RATE = 16000;
export const MAX_RECORDING_MS = 60_000;

export interface Recording {
  samples: Float32Array;
  sampleRate: number;
  durationMs: number;
}

export class Recorder {
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private startedAt = 0;

  async start(): Promise<void> {
    if (this.recorder) throw new Error("录音已在进行中。");

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this.chunks = [];
    this.startedAt = Date.now();

    this.recorder = new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start();
  }

  async stop(): Promise<Recording> {
    const recorder = this.recorder;
    const stream = this.stream;
    if (!recorder || !stream) throw new Error("当前没有进行中的录音。");

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType }));
      recorder.stop();
    });

    stream.getTracks().forEach((track) => track.stop());
    this.recorder = undefined;
    this.stream = undefined;

    const durationMs = Date.now() - this.startedAt;
    return decodeToMono16k(blob, durationMs);
  }

  get isRecording(): boolean {
    return this.recorder !== undefined;
  }
}

async function decodeToMono16k(blob: Blob, durationMs: number): Promise<Recording> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioCtx();

  try {
    const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
    const channel = decoded.getChannelData(0);
    const samples = downsample(channel, decoded.sampleRate, TARGET_SAMPLE_RATE);
    return { samples, sampleRate: TARGET_SAMPLE_RATE, durationMs };
  } finally {
    void context.close();
  }
}
