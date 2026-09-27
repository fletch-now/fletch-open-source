import { brandCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og";
export const alt = "Publish your app with Fletch";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export default async function Image(): Promise<Response> {
  return brandCard({
    title: "Give your app\na public home.",
    subtitle: "Publish when you are ready. · Fletch apps beta",
  });
}
