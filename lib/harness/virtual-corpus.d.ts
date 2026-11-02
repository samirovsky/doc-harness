declare module "virtual:doc-harness/corpus" {
  import type { Corpus } from "./domain/document";

  const payload: {
    caseId: string | null;
    manifestFileIds: string[];
    corpus: Corpus;
    ingestedAt: string;
  };
  export default payload;
}
