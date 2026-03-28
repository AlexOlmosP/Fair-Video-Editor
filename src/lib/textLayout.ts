/**
 * Break text into wrapped lines, respecting \n and word boundaries.
 *
 * @param ctx - Canvas 2D context with the desired font already set
 * @param text - Source text (may contain \n for manual line breaks)
 * @param maxWidth - Maximum allowed line width in measureText units
 */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const lines: string[] = [];

  for (const para of text.split('\n')) {
    if (para === '') {
      lines.push('');
      continue;
    }
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }

  return lines.length > 0 ? lines : [''];
}
