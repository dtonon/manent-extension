import { Readability } from '@mozilla/readability';

export interface ExtractedArticle {
  title: string;
  text: string;
}

export default defineUnlistedScript((): ExtractedArticle | null => {
  try {
    const doc = document.cloneNode(true) as Document;
    const article = new Readability(doc).parse();
    if (!article?.textContent?.trim()) return null;
    const result: ExtractedArticle = {
      title: article.title ?? document.title,
      text: article.textContent.trim(),
    };
    (window as any).__manentArticle = result;
    return result;
  } catch {
    return null;
  }
});
