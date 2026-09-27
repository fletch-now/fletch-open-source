import { brandCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og";

export const alt = "Every Fletch guide and API reference in one document";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(): Promise<Response> {
  return brandCard({ title: "Every guide.\nOne document.", subtitle: "Fletch documentation" });
}
