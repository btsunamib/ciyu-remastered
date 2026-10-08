import { marked } from './vendor/marked.js';
import DOMPurify from './vendor/purify.js';

// Only display reasoning explicitly returned by the service, including providers
// that wrap it in a leading <think> block instead of reasoning_content.
export function splitChatResponse(content = '', reasoning = '') {
  let answer = String(content), thought = String(reasoning), thinking = false;
  while (true) {
    const trimmed = answer.trimStart();
    if (trimmed && /^<think>$/i.test(trimmed.slice(0, 7))) {
      const end = trimmed.toLowerCase().indexOf('</think>', 7);
      if (end < 0) { thought += trimmed.slice(7); answer = ''; thinking = true; break; }
      thought += trimmed.slice(7, end); answer = trimmed.slice(end + 8); continue;
    }
    // Avoid flashing a half-received reasoning marker into the answer.
    if (trimmed && '<think>'.startsWith(trimmed.toLowerCase())) answer = '';
    break;
  }
  return { content: answer.trimStart(), reasoning: thought, thinking };
}

export function markdownHTML(source) {
  const parsed = marked.parse(String(source), { gfm: true, breaks: true, async: false });
  return DOMPurify.sanitize(parsed, {
    ALLOWED_TAGS: ['p','br','strong','em','del','code','pre','blockquote','ul','ol','li','h1','h2','h3','h4','h5','h6','hr','a','table','thead','tbody','tr','th','td'],
    ALLOWED_ATTR: ['href','title','start'],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
    // Do not let model output load remote images or create controls in the chat.
  });
}
