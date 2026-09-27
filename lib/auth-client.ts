import { createAuthClient } from "better-auth/react";
import { adminClient, customSessionClient, siweClient } from "better-auth/client/plugins";
import type { auth } from "@/lib/auth";
import { APP_URL } from "@/lib/config";

export const authClient = createAuthClient({
  baseURL: APP_URL,
  plugins: [siweClient(), adminClient(), customSessionClient<typeof auth>()],
});
