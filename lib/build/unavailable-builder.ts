import type { BuildEvent, Builder } from "@/lib/build/types";

// Used in production when no model provider is configured. It fails the build,
// which refunds the user's credit, instead of falling through to the demo builder
// and presenting a fabricated contract and deployment as real work.
export class UnavailableBuilder implements Builder {
  async *run(): AsyncIterable<BuildEvent> {
    yield {
      phase: "error",
      text: "Builds are temporarily unavailable. Your credit has not been used.",
    };
  }
}
