import { constants } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export async function openSourceFile(path: string): Promise<FileHandle> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      // A quiescent NFS writer can retain a delegation until this open recalls it.
      // Keep nonblocking/no-follow protection; never wait indefinitely for a lease.
      if (attempt >= 20 || code !== "EAGAIN" && code !== "EWOULDBLOCK") throw cause;
      await delay(100);
    }
  }
}
