/** Owns active runs so a project switch cannot outpace their finalizers. */
export class RunCompletion {
  private readonly active = new Set<Promise<void>>();
  private suspended = false;

  track(start: () => Promise<void>): Promise<void> {
    if (this.suspended) {
      return Promise.reject(
        new Error("The project is switching; retry the message after it finishes."),
      );
    }
    const run = start();
    this.active.add(run);
    void run.then(
      () => this.active.delete(run),
      () => this.active.delete(run),
    );
    return run;
  }

  async wait(): Promise<void> {
    const results = await Promise.allSettled([...this.active]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }

  /** Stop accepting new runs, then wait for old callbacks and persistence to finish. */
  async suspend(abort: () => void): Promise<() => void> {
    if (this.suspended) throw new Error("A project switch is already in progress.");
    this.suspended = true;
    try {
      abort();
      await Promise.allSettled([...this.active]);
    } catch (error) {
      this.suspended = false;
      throw error;
    }
    return () => {
      this.suspended = false;
    };
  }
}
