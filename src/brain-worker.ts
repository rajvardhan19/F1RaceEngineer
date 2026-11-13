// Team chat model, running entirely in the browser on WebGPU.
// The WebGPU path uses transformers.js' default ONNX runtime, served by its CDN: that build is
// larger than static hosts accept per file, so unlike the voice workers it is not self-hosted.
import { env, pipeline } from '@huggingface/transformers';
import type { TextGenerationPipeline } from '@huggingface/transformers';
import type { ChatMessage } from './brain-prompt.ts';

env.allowLocalModels = false;
interface LoadMessage { id: number; type: 'load'; model: string; dtype: string }
interface ChatRequest { id: number; type: 'chat'; messages: ChatMessage[]; maxTokens: number }

let generator: TextGenerationPipeline | null = null;
let loading: Promise<void> | null = null;

async function gpuDtype(preferred: string) {
  const gpu = (self.navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
  const adapter = await gpu?.requestAdapter();
  if (!adapter) throw new Error('WebGPU is not available on this device. The scripted team radio still answers your questions.');
  // Half-precision weights need shader-f16; full-precision activations work everywhere.
  return preferred === 'q4f16' && !adapter.features.has('shader-f16') ? 'q4' : preferred;
}

async function load(m: LoadMessage) {
  const dtype = await gpuDtype(m.dtype);
  generator = await pipeline('text-generation', m.model, {
    device: 'webgpu',
    dtype: dtype as 'q4',
    progress_callback: p => {
      // Report the weights download only; tokenizer and config files are tiny.
      if ('progress' in p && 'file' in p && /onnx/.test(String(p.file))) self.postMessage({ type: 'progress', progress: p.progress });
    },
  }) as TextGenerationPipeline;
  // One tiny run compiles the shaders so the first real reply is quick.
  await generator('Hi', { max_new_tokens: 1 });
}

self.onmessage = async (event: MessageEvent<LoadMessage | ChatRequest>) => {
  const data = event.data;
  try {
    if (data.type === 'load') {
      if (!loading) loading = load(data).catch(e => { loading = null; generator = null; throw e; });
      await loading;
      self.postMessage({ id: data.id, type: 'ready' });
      return;
    }
    if (!generator) throw new Error('Team chat model is not loaded.');
    const started = performance.now();
    const prompt = generator.tokenizer.apply_chat_template(data.messages, {
      tokenize: false, add_generation_prompt: true,
    }) as unknown as string;
    const output = await generator(prompt, {
      // Greedy: sampling made small models wander, and a repetition penalty pushes them away from the fact sheet.
      max_new_tokens: data.maxTokens, do_sample: false, return_full_text: false,
    }) as { generated_text: string }[];
    self.postMessage({ id: data.id, type: 'reply', text: output[0]?.generated_text ?? '', ms: performance.now() - started });
  } catch (error) {
    self.postMessage({ id: data.id, type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
};
