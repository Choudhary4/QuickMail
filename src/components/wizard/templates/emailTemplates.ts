// src/components/wizard/templates/emailTemplates.ts

const baseStyles = `
  body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; max-width: 100%; }
  table { border-collapse: collapse !important; }
  body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; font-family: Arial, sans-serif; }
`;

// This function now takes the generated HTML body from the canvas and wraps it
// in a full, responsive email document.
export const wrapInEmailTemplate = (canvasHtmlContent: string): string => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Email</title>
    <style>${baseStyles}</style>
</head>
<body style="margin: 0 !important; padding: 0 !important; background-color: #f4f4f4;">
    <center>
        <table border="0" cellpadding="0" cellspacing="0" width="600" style="width: 100%; max-width: 600px;">
            <tr>
                <td align="center">
                    <!-- This is the container for our canvas content -->
                    <div style="position: relative; width: 600px; height: 800px; margin: auto; background-color: #ffffff;">
                        ${canvasHtmlContent}
                    </div>
                </td>
            </tr>
        </table>
    </center>
</body>
</html>
`;