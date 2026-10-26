/** Offsets are percentages of the available canvas, independent of DPI. */
export function avatarLayout(width: number, height: number, naturalWidth: number, naturalHeight: number, scale = 1, offsetX = 0, offsetY = 0) {
  return {
    scale: Math.min(width / Math.max(1, naturalWidth), height / Math.max(1, naturalHeight)) * 0.9 * scale,
    x: width * (0.5 + offsetX / 100),
    y: height * (0.5 + offsetY / 100),
  };
}
