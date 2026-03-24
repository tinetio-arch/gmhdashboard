/**
 * Rich Text Renderer for PDFKit
 *
 * Parses markdown-like content from AI-generated notes and renders it
 * with proper formatting: bold headers, bullet indentation, numbered lists,
 * horizontal rules, and paragraph spacing.
 *
 * IMPORTANT: Avoids PDFKit's `continued: true` for inline bold switching —
 * that approach causes width inheritance bugs. Instead, strips markdown
 * and renders bold-only lines as headers, everything else as plain text.
 */

interface RenderOptions {
    x: number;
    width: number;
    fontSize?: number;
    lineGap?: number;
    color?: string;
    headerColor?: string;
}

/**
 * Render rich text content into a PDFKit document.
 * Handles: **bold** headers, bullet points, numbered lists, horizontal rules, paragraphs.
 */
export function renderRichText(doc: any, text: string, options: RenderOptions): void {
    if (!text) return;

    const {
        x,
        width,
        fontSize = 9,
        lineGap = 2,
        color = '#333333',
        headerColor = '#1a1a2e',
    } = options;

    const listIndent = 16;
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];

        // Skip empty lines — add paragraph spacing
        if (!raw.trim()) {
            doc.y += 6;
            continue;
        }

        // Page break check
        if (doc.y > 700) doc.addPage();

        // ─── Horizontal rule (--- or ***) ───
        if (/^[-*_]{3,}\s*$/.test(raw.trim())) {
            doc.y += 4;
            doc.moveTo(x, doc.y).lineTo(x + width, doc.y)
                .lineWidth(0.5).strokeColor('#cccccc').stroke();
            doc.y += 6;
            continue;
        }

        // ─── Heading lines (# Heading) ───
        const headingMatch = raw.match(/^(#{1,3})\s+(.+)/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const headingText = stripInline(headingMatch[2]);
            const headingSize = level === 1 ? 12 : level === 2 ? 11 : 10;
            doc.y += 6;
            doc.fontSize(headingSize).font('Helvetica-Bold').fillColor(headerColor)
                .text(headingText, x, doc.y, { width, lineGap });
            doc.y += 4;
            continue;
        }

        // ─── Bold-only line (sub-header): "**Something:**" or "**Something**" ───
        const boldLineMatch = raw.trim().match(/^\*\*(.+?)\*\*:?\s*$/);
        if (boldLineMatch) {
            doc.y += 5;
            // Avoid double colon: if the captured group already ends with ":", don't add another
            let headerText = boldLineMatch[1];
            if (!headerText.endsWith(':') && raw.trim().includes('**:')) {
                headerText += ':';
            }
            doc.fontSize(fontSize + 0.5).font('Helvetica-Bold').fillColor(headerColor)
                .text(headerText, x, doc.y, { width, lineGap });
            doc.y += 3;
            continue;
        }

        // ─── Bullet point: "- text", "* text", "• text" ───
        const bulletMatch = raw.match(/^[\s]*[-*•]\s+(.*)/);
        if (bulletMatch) {
            const bulletText = stripInline(bulletMatch[1]);
            doc.fontSize(fontSize).font('Helvetica').fillColor(color)
                .text('•', x, doc.y, { lineBreak: false });
            doc.text(bulletText, x + listIndent, doc.y, { width: width - listIndent, lineGap });
            doc.y += 3;
            continue;
        }

        // ─── Numbered list: "1. **Bold text (code):** rest of line" ───
        const numberedMatch = raw.match(/^[\s]*(\d+)\.\s+(.*)/);
        if (numberedMatch) {
            const numLabel = numberedMatch[1] + '.';
            const itemText = stripInline(numberedMatch[2]);

            // Check if the item starts with a bold diagnosis like "**Testosterone Deficiency (E29.1):**"
            const boldStartMatch = numberedMatch[2].match(/^\*\*(.+?)\*\*:?\s*(.*)/);
            if (boldStartMatch) {
                let boldPart = boldStartMatch[1];
                if (!boldPart.endsWith(':') && numberedMatch[2].includes('**:')) {
                    boldPart += ':';
                }
                const restPart = stripInline(boldStartMatch[2]);

                // Render number
                doc.fontSize(fontSize).font('Helvetica').fillColor(color)
                    .text(numLabel, x, doc.y, { lineBreak: false });
                // Render bold part
                doc.fontSize(fontSize).font('Helvetica-Bold').fillColor(headerColor)
                    .text(boldPart, x + listIndent, doc.y, { width: width - listIndent, lineGap });
                // Render rest if any
                if (restPart.trim()) {
                    doc.fontSize(fontSize).font('Helvetica').fillColor(color)
                        .text(restPart, x + listIndent, doc.y, { width: width - listIndent, lineGap });
                }
            } else {
                // Plain numbered item
                doc.fontSize(fontSize).font('Helvetica').fillColor(color)
                    .text(numLabel, x, doc.y, { lineBreak: false });
                doc.text(itemText, x + listIndent, doc.y, { width: width - listIndent, lineGap });
            }
            doc.y += 3;
            continue;
        }

        // ─── Regular line — render as plain text (strip markdown) ───
        const plainText = stripInline(raw);
        doc.fontSize(fontSize).font('Helvetica').fillColor(color)
            .text(plainText, x, doc.y, { width, lineGap });
    }
}

/**
 * Strip inline markdown formatting, returning clean plain text.
 */
function stripInline(text: string): string {
    return text
        .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .trim();
}
