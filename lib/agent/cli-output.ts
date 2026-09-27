import { StringDecoder } from "node:string_decoder";
import type { CliEvent } from "./cli-events";

const MAX_LINE_BYTES = 1024 * 1024;
const QUEUE_BYTES = 2 * 1024 * 1024;
const QUEUE_EVENTS = 128;

// These are backpressure high-water marks, not hard queue caps: the current
// chunk can contain multiple events, and exit drains the remaining pipe bytes.
// An individual malformed line has its own limit before it becomes an event.
export class CliOutput {
  private readonly decoder = new StringDecoder("utf8");
  private line = "";
  private bytes = 0;
  private events: Array<{ event: CliEvent; bytes: number }> = [];

  constructor(private readonly parse: (line: string) => CliEvent[]) {}

  get length(): number { return this.events.length; }
  get full(): boolean { return this.bytes >= QUEUE_BYTES || this.length >= QUEUE_EVENTS; }

  push(event: CliEvent): void {
    const bytes = Buffer.byteLength(JSON.stringify(event));
    this.events.push({ event, bytes });
    this.bytes += bytes;
  }

  shift(): CliEvent | undefined {
    const next = this.events.shift();
    if (!next) return undefined;
    this.bytes -= next.bytes;
    return next.event;
  }

  write(chunk: Buffer): void { this.consume(this.decoder.write(chunk)); }

  end(): void {
    this.consume(this.decoder.end());
    if (this.line.trim()) this.parse(this.line).forEach((event) => this.push(event));
    this.line = "";
  }

  private consume(text: string): void {
    const lines = (this.line + text).split("\n");
    this.line = "";
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new Error("The build agent emitted a log line larger than 1 MiB. The run was stopped; saved source is retained.");
      if (index === lines.length - 1) this.line = line;
      else if (line.trim()) this.parse(line).forEach((event) => this.push(event));
    }
  }
}
