declare module 'virtual:font-manifest' {
  export type FontFace = {
    name: string;
    href: string;
    family: string;
    style: 'normal' | 'italic';
    weight: number;
  };
  export function fontsForPage(pageId: string | null | undefined): FontFace[];
  export const fontFaceCss: string;
  const manifest: { faces: FontFace[]; pages: Record<string, string[]> };
  export default manifest;
}

declare module 'subset-font' {
  type VariationAxisPin = number | { min?: number; max?: number; default?: number };
  type SubsetOptions = {
    targetFormat?: 'sfnt' | 'woff' | 'woff2' | 'truetype';
    variationAxes?: Record<string, VariationAxisPin>;
    keepAllGlyphs?: boolean;
    keepFeatures?: string[];
    preserveNameIds?: number[];
    noHinting?: boolean;
    noLayoutClosure?: boolean;
    glyphNames?: boolean;
    dropTables?: string[];
  };
  const subsetFont: (
    font: Buffer,
    text: string | null | undefined,
    options?: SubsetOptions,
  ) => Promise<Buffer>;
  export default subsetFont;
}
