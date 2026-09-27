export const DEVICE_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  phone: { width: 390, height: 844 },
} as const;

export type PreviewDevice = "responsive" | keyof typeof DEVICE_VIEWPORTS;

export function previewViewport(width: number, height: number, device: PreviewDevice): { width: number; height: number } {
  if (device === "responsive") return { width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) };
  return DEVICE_VIEWPORTS[device];
}

export function fitPreview(
  width: number,
  height: number,
  device: PreviewDevice,
): number {
  if (device === "responsive") return 1;
  const viewport = DEVICE_VIEWPORTS[device];
  return Math.max(
    0,
    Math.min(width / viewport.width, height / viewport.height, 1),
  );
}
