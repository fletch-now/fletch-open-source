const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export class ToolOutput {
  private readonly chunks: Record<"stdout" | "stderr", Buffer[]> = { stdout: [], stderr: [] };
  private bytes = 0;
  exceeded = false;

  append(stream: "stdout" | "stderr", chunk: Buffer): void {
    if (this.exceeded) return;
    if (this.bytes + chunk.length > MAX_OUTPUT_BYTES) {
      this.exceeded = true;
      return;
    }
    this.chunks[stream].push(chunk);
    this.bytes += chunk.length;
  }

  read(stream: "stdout" | "stderr"): string {
    return Buffer.concat(this.chunks[stream]).toString("utf8");
  }
}
