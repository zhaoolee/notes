/** ZIP 导出和 GitHub 发布共享 Hugo 并发预算；关闭排队任务会及时释放监听器。 */
export class SiteBuildGate {
  private active = new Set<string>();
  private waiting: Array<{ owner: string; signal: AbortSignal; resolve: (release: () => void) => void; reject: (error: unknown) => void; abort: () => void }> = [];
  constructor(private capacity = 2) {}
  tryAcquire(owner: string): (() => void) | null {
    if (this.active.has(owner) || this.active.size >= this.capacity) return null;
    this.active.add(owner);
    let released = false;
    return () => {
      if (released) return;
      released = true; this.active.delete(owner); this.drain();
    };
  }
  acquire(owner: string, signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    const release = this.tryAcquire(owner);
    if (release) return Promise.resolve(release);
    return new Promise((resolve, reject) => {
      const entry = { owner, signal, resolve, reject, abort: () => {
        this.waiting = this.waiting.filter((candidate) => candidate !== entry);
        signal.removeEventListener("abort", entry.abort); reject(signal.reason);
      } };
      this.waiting.push(entry); signal.addEventListener("abort", entry.abort, { once: true });
      if (signal.aborted) entry.abort();
    });
  }
  private drain() {
    for (let index = 0; index < this.waiting.length;) {
      const entry = this.waiting[index];
      const release = this.tryAcquire(entry.owner);
      if (!release) { index++; continue; }
      this.waiting.splice(index, 1); entry.signal.removeEventListener("abort", entry.abort); entry.resolve(release);
    }
  }
}
export const siteBuildGate = new SiteBuildGate();
