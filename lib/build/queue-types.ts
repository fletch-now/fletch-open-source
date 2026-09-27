import type { WorkerAvailability } from "./worker-health";
import type { BuildMaintenanceSnapshot } from "./maintenance";
import type { BuildSelection } from "@/lib/agent/selection";
import type { BuildAttachment } from "@/lib/build/types";

export interface BuildQueueState {
  position: number;
  ahead: number;
  running: number;
  reserved: number;
  capacity: number;
  memoryManaged?: boolean;
  worker?: WorkerAvailability;
  maintenance?: BuildMaintenanceSnapshot;
}

export interface QueuedBuildDraft {
  prompt: string;
  attachments: BuildAttachment[];
  projectId: string | null;
  selection: BuildSelection;
}
