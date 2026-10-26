export interface PrivacyRectangle { x: number; y: number; width: number; height: number }

/** Cover private source pixels before any scaling, camera movement, or compositing. */
export function privacyFilters(rectangles?: PrivacyRectangle[]): string {
  if (rectangles === undefined) return '';
  if (!Array.isArray(rectangles) || rectangles.length > 30) throw new Error('A demo scene has invalid privacy masks.');
  return rectangles.map(rectangle => {
    if (!rectangle || !['x', 'y', 'width', 'height'].every(key => typeof rectangle[key as keyof PrivacyRectangle] === 'number' && Number.isFinite(rectangle[key as keyof PrivacyRectangle])) || rectangle.x < 0 || rectangle.y < 0 || rectangle.width <= 0 || rectangle.height <= 0 || rectangle.x + rectangle.width > 1.000000001 || rectangle.y + rectangle.height > 1.000000001) throw new Error('A demo privacy mask must fit entirely inside the original recording.');
    const value = (n: number) => n.toFixed(9);
    // Round outwards; fractional source pixels must not expose the edge of text.
    return `drawbox=x='floor(iw*${value(rectangle.x)})':y='floor(ih*${value(rectangle.y)})':w='ceil(iw*${value(rectangle.width)})+2':h='ceil(ih*${value(rectangle.height)})+2':color=0xe3e6eb:t=fill`;
  }).join(',');
}
