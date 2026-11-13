// Client for the in-browser team chat model. Opt-in: nothing downloads until enable().
import { buildPrompt, cleanReply } from './brain-prompt.ts';
import type { BrainRequest } from './brain-prompt.ts';

// Chosen by testing on the real prompt in the browser: Llama 3.2 1B stays in persona and on the
// facts; Qwen2.5 0.5B drifted off topic (and loops at half precision). WebGPU only: on the CPU
// path replies took ~10 s and were worse than the scripted answers they would replace.
export const BRAIN_MODEL = {
  id: 'onnx-community/Llama-3.2-1B-Instruct-ONNX',
  dtype: 'q4f16',
  size: 'about 1 GB',
};
export const NO_WEBGPU = 'Team chat needs WebGPU (a recent Chrome, Edge or Safari). The scripted team radio still answers your questions.';
type Pending = { resolve: (data: { text?: string }) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export class TeamBrain {
  state: 'off' | 'loading' | 'ready' | 'error' = 'off';
  onStatus: (text: string, error?: boolean) => void = () => {};
  private worker: Worker | null = null;
  private serial = 0;
  private turn = 0;
  private loading: Promise<void> | null = null;
  private pending = new Map<number, Pending>();
  private chain: Promise<unknown> = Promise.resolve();

  get ready() { return this.state === 'ready'; }

  private request(message: Record<string, unknown>, timeout: number): Promise<{ text?: string }> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./brain-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        if (data.type === 'progress') { if (this.state === 'loading') this.onStatus(`Downloading team chat model · ${Math.round(data.progress)}%`); return; }
        const p = this.pending.get(data.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(data.id);
        if (data.type === 'error') p.reject(new Error(data.error));
        else p.resolve(data);
      };
      this.worker.onerror = () => this.reset('Team chat worker failed to start.');
    }
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.reset('Team chat model timed out.'), timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ id, ...message });
    });
  }

  private reset(reason = 'Team chat stopped.') {
    this.worker?.terminate();
    this.worker = null;
    this.loading = null;this.state='error';this.turn++;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(reason)); }
    this.pending.clear();
    this.onStatus(reason,true);
  }

  /** Download (first time only; the browser caches it) and start the model. */
  enable(): Promise<void> {
    if (this.loading) return this.loading;
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      this.state = 'error';
      this.onStatus(NO_WEBGPU, true);
      return Promise.reject(new Error(NO_WEBGPU));
    }
    this.state = 'loading';
    this.onStatus(`Loading team chat model · ${BRAIN_MODEL.size}, first time only`);
    this.loading = this.request({ type: 'load', model: BRAIN_MODEL.id, dtype: BRAIN_MODEL.dtype }, 900000)
      .then(() => {
        this.state = 'ready';
        this.onStatus('Team chat ready · runs on this device’s GPU');
      })
      .catch(e => {
        this.state = 'error';
        this.loading = null;
        this.reset();
        this.onStatus(`Team chat unavailable: ${e instanceof Error ? e.message : String(e)}`, true);
        throw e;
      });
    return this.loading;
  }

  /** Invalidate both the active reply and queued turns when the player keys the radio. */
  cancelReplies(){this.turn++;}

  /** One in-character reply, cleaned and fact-checked. Requests run one at a time. */
  reply(req: BrainRequest): Promise<string | null> {
    const turn=this.turn;
    const run = async () => {
      if(turn!==this.turn||!this.ready)return null;
      const data = await this.request({ type: 'chat', messages: buildPrompt(req), maxTokens: 48 }, 30000);
      return turn===this.turn?cleanReply(data.text ?? '', req):null;
    };
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => {});
    return result;
  }
}
