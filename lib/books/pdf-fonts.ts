import path from "node:path";
import { Font } from "@react-pdf/renderer";

/** Font có đủ dấu tiếng Việt (Liberation Serif, SIL OFL 1.1 — assets/fonts). Helvetica chuẩn của PDF thiếu nhiều ký tự (ạ, ố, ữ…). */
export const BOOK_FONT = "LiberationSerif";
let done = false;
export function registerBookFonts(): void {
  if (done) return;
  const dir = path.join(process.cwd(), "assets", "fonts");
  Font.register({
    family: BOOK_FONT,
    fonts: [
      { src: path.join(dir, "LiberationSerif-Regular.ttf"), fontWeight: 400 },
      { src: path.join(dir, "LiberationSerif-Bold.ttf"), fontWeight: 700 },
      { src: path.join(dir, "LiberationSerif-Italic.ttf"), fontWeight: 400, fontStyle: "italic" },
    ],
  });
  Font.registerHyphenationCallback((w) => [w]);
  done = true;
}
