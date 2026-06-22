// lib/blockToHtml.ts
import { EmailBlock } from "./types"; // Make sure to import the shared EmailBlock type

/**
 * Generates the HTML string for a single email block.
 * This is a helper function used by generateHtmlFromBlocks.
 * @param block The EmailBlock object to convert to HTML.
 * @returns An HTML string representation of the block.
 */
function generateBlockHTML(block: EmailBlock): string {
    // Convert the style object into an inline CSS string
    const styleString = Object.entries(block.styles)
        .map(([key, value]) => {
            // Convert camelCase to kebab-case (e.g., fontSize -> font-size)
            const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
            return `${cssKey}: ${value}`;
        })
        .join('; ');

    switch (block.type) {
        case 'text':
            // Using a div container allows for padding and background colors on the text block
            return `<div style="${styleString}">${block.content}</div>`;
        
        case 'image':
            // Images are often centered and need responsive styling
            return `<div style="text-align: center; ${block.styles.padding ? `padding: ${block.styles.padding};` : ''}">
                <img src="${block.content as string}" style="${styleString}" class="responsive-img" alt="Email Image" />
            </div>`;
            
        case 'button':
            const buttonLink = block.link || '#';
            // Buttons are links styled to look like buttons for maximum email client compatibility
            return `<div style="text-align: center; padding: 20px;">
                <a href="${buttonLink}" style="${styleString}; text-decoration: none; display: inline-block;">${block.content}</a>
            </div>`;
            
        case 'divider':
            return `<hr style="${styleString}" />`;
            
        case 'columns':
            const columnContent = block.content as { left: string; right: string };
            // Table-based layouts are essential for email client compatibility (especially Outlook)
            return `<table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
                <tr>
                    <td width="50%" style="padding: 15px; vertical-align: top;">${columnContent.left}</td>
                    <td width="50%" style="padding: 15px; vertical-align: top;">${columnContent.right}</td>
                </tr>
            </table>`;
            
        case 'social':
            const socialLinks = block.content as string[];
            return `<div style="text-align: center; padding: 30px;">
                ${socialLinks.map(social => 
                    `<a href="#" style="display: inline-block; margin: 0 8px;">
                        <img src="https://via.placeholder.com/32x32/?text=${social.charAt(0).toUpperCase()}" alt="${social}" style="width: 32px; height: 32px;" />
                    </a>`
                ).join('')}
            </div>`;
            
        default:
            return '';
    }
}


/**
 * Takes an array of EmailBlock objects and generates a full, email-safe HTML document.
 * @param blocks The array of EmailBlock objects from the Zustand store.
 * @returns A complete HTML string for the email.
 */
export const generateHtmlFromBlocks = (blocks: EmailBlock[]): string => {
    const emailBody = blocks.map(generateBlockHTML).join('');

    // This is the boilerplate that wraps your content.
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Email</title>
    <style>
        body { margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5; }
        .email-container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .responsive-img { max-width: 100%; height: auto; display: block; }
        @media only screen and (max-width: 600px) {
            .email-container { width: 100% !important; }
        }
    </style>
</head>
<body>
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td align="center" style="background-color: #f5f5f5;">
                <div class="email-container">
                    ${emailBody}
                </div>
            </td>
        </tr>
    </table>
</body>
</html>`;
};