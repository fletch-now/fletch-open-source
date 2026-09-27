import type { BuildQueueState } from "./queue-types";

export function describeBuildQueue(queue: BuildQueueState): { title: string; description: string } {
  if (queue.maintenance) {
    return {
      title: "Builder update",
      description: "Builder is being updated. Your build is saved and will start when the update finishes.",
    };
  }
  if (queue.worker?.state === "offline") {
    return { title: "Waiting for the worker", description: "The worker has stopped reporting. Your queued build is saved and will start after service resumes." };
  }
  if (queue.worker?.state === "capacity_wait") {
    return { title: "Waiting for capacity", description: "The worker is checking available capacity. Your place in the queue is saved." };
  }
  if (queue.ahead > 0) {
    return {
      title: "Waiting in queue",
      description: `${queue.ahead} ${queue.ahead === 1 ? "build is" : "builds are"} ahead of yours. Your build will start automatically.`,
    };
  }
  if (queue.running + queue.reserved < queue.capacity) {
    if (queue.memoryManaged) {
      return {
        title: "Waiting to start",
        description: "Your build is next. The worker starts it when a slot and enough memory are available.",
      };
    }
    return {
      title: "Waiting to start",
      description: "Your build is next. Waiting for the worker to pick it up.",
    };
  }
  if (queue.running === 0 && queue.reserved > 0) {
    return {
      title: "Waiting for capacity",
      description: "Capacity is reserved until an earlier interruption is resolved. Your place is saved.",
    };
  }
  return {
    title: "Next in line",
    description: "Your build will start automatically when a slot becomes available.",
  };
}
