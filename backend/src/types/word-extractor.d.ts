// word-extractor ships no types; declare just the surface we use to read
// legacy .doc CVs (the pre-2007 Word format mammoth cannot open).
declare module 'word-extractor' {
  class Document {
    getBody(): string;
  }
  class WordExtractor {
    extract(source: Buffer | string): Promise<Document>;
  }
  export = WordExtractor;
}
