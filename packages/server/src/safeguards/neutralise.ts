// Provides neutraliseOutbound (§4.5): the one function through which every text the server
// returns passes. It replaces MosAIc's own markup (`<use_tool`, `<mosaic_ui`) and its payment
// signal (`__payment_required`), whatever their case, with text that is not acted on. None of the
// replacements contains a quote or a backslash, so a JSON text stays valid JSON.

const REPLACEMENTS: readonly (readonly [RegExp, string])[] = [
  [/<use_tool/gi, "[neutralised: use_tool]"],
  [/<mosaic_ui/gi, "[neutralised: mosaic_ui]"],
  // The quotes around the name, if any, stay: the key is gone, and the text stays valid JSON.
  [/__payment_required/gi, "[neutralised: payment_required]"],
];

export function neutraliseOutbound(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REPLACEMENTS) out = out.replace(pattern, replacement);
  return out;
}
