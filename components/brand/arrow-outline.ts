// The mark's silhouette, traced from the banner photograph and normalised into a
// 24-box (see components/brand/fletch-mark.tsx for the flat SVG form). Shared by
// every 3D use so the monument's head and the spinning logo are the same shape.
export const ARROW_OUTLINE: Array<[number, number]> = [
  [21.2, 1.0], [17.5, 7.8], [16.6, 11.7], [16.6, 14.0], [17.3, 16.6], [11.0, 16.8], [9.9, 18.0], [7.8, 19.7],
  [4.8, 23.0], [4.5, 21.6], [4.9, 18.2], [6.2, 14.9], [7.3, 13.3], [7.3, 11.4], [6.4, 11.2], [2.8, 11.0],
  [2.9, 10.5], [4.0, 9.1], [5.3, 8.3], [8.2, 6.4], [10.1, 5.3], [11.6, 4.2], [13.1, 3.4], [17.7, 1.7],
];

// The photograph's maps, cut onto a square canvas with 6% padding; a plane at this
// ratio lines up with the extruded outline to within a pixel.
export const ARROW_PLANE = 22 / 6 / (1 - 2 * 0.06);
export const ARROW_MAPS = {
  map: "/brand/arrow-albedo.jpg",
  alpha: "/brand/arrow-alpha.png",
  normal: "/brand/arrow-normal.jpg",
};
