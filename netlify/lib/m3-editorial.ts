import sanitizeHtml from 'sanitize-html';

/** A feed body needs prose and links, never editor styles, embeds or scripts. */
export function cleanM3Editorial(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'a', 'br', 'blockquote', 'hr'],
    allowedAttributes: { a: ['href', 'title'] },
    allowedSchemes: ['https'],
    allowProtocolRelative: false,
    nestingLimit: 12,
  });
}

export function hasM3Editorial(html: string): boolean {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&(?:nbsp|#160);/gi, ' ').trim().length > 0;
}
