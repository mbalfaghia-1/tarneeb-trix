/** Card dimensions depend on screen space, never on the number of cards. */
export function handLayout(width: number, available: number, count: number) {
  const step = count > 1 ? Math.max(12, Math.min(width * 0.58, (available - width) / (count - 1))) : width;
  return { width, height: width * 1.4, offset: step - width };
}

/** Reserve capacity for all thirteen ranks before the first card is played. */
export function tableauLayout(height: number, availableWidth: number, count: number) {
  const capacitySteps = 12;
  const fit = (height - 4 * capacitySteps) / (1.4 + 0.2 * capacitySteps);
  const width = Math.max(44, Math.min(110, fit, (availableWidth - 36) / 4));
  const minimumStep = Math.max(14, width * 0.2 + 4);
  const step = count > 1
    ? Math.max(minimumStep, Math.min(width * 0.42, (height - width * 1.4) / (count - 1)))
    : minimumStep;
  return { width, height: width * 1.4, step };
}