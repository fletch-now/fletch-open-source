import { brandCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og";
export const alt = "Apps built with Fletch · Beta directory";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export default async function Image(): Promise<Response> {
  return brandCard({
    title: "Apps built\nwith Fletch.",
    subtitle: "Published by their creators. · Beta directory",
  });
}
