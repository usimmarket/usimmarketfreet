/* Netlify Function: generate PDF from form data + mapping.json
   - Fixes: StandardFonts ReferenceError
   - Checkbox outputs: prints 'V' for selected options
   - Long-name print fields: *_print auto line-break every 25 chars
*/

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

// fontkit is optional. If present, we can embed TTF (e.g., malgun.ttf).
let fontkit = null;
try {
  // eslint-disable-next-line import/no-extraneous-dependencies
  fontkit = require('@pdf-lib/fontkit');
} catch (e) {
  // ignore
}

function readJsonIfExists(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function normalizeBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (v == null) return false;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'on' || s === 'yes' || s === 'y';
}

function splitEvery(str, n) {
  if (!str) return '';
  const s = String(str);
  if (s.length <= n) return s;
  const parts = [];
  for (let i = 0; i < s.length; i += n) parts.push(s.slice(i, i + n));
  return parts.join('\n');
}

function optionFromKey(key) {
  // supports: base__option  OR base_option
  if (key.includes('__')) {
    const [base, opt] = key.split('__');
    return { base, opt };
  }
  const m = key.match(/^(.*)_(sk|kt|new|port|foreigner|native|usim|esim|bank|card|prepaid|postpaid|skt|lgu|mvno)$/i);
  if (m) return { base: m[1], opt: m[2].toLowerCase() };
  return null;
}

function isCheckboxKey(key) {
  // Common option groups we want to support even if mapping type was mistakenly left as "text".
  return (
    key.startsWith('freet_group_') ||
    key.startsWith('join_type_') ||
    key.startsWith('customer_type_') ||
    key.startsWith('sim_type_') ||
    key.startsWith('autopay_method_') ||
    key.startsWith('port_paytype_') ||
    key.startsWith('prev_carrier_')
  );
}

exports.handler = async (event) => {
  try {
    // CORS / preflight
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
        },
        body: 'ok',
      };
    }

    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ error: 'Method Not Allowed' }),
      };
    }

    const data = event.body ? JSON.parse(event.body) : {};

    const repoRoot = path.resolve(__dirname, '..', '..');

    const templatePath = fs.existsSync(path.join(repoRoot, 'template.pdf'))
      ? path.join(repoRoot, 'template.pdf')
      : path.join(repoRoot, 'template.pdf');

    // mapping location support
    const mappingPath1 = path.join(repoRoot, 'mappings', 'mapping.json');
    const mappingPath2 = path.join(repoRoot, 'mapping.json');
    const mapping = readJsonIfExists(mappingPath1) || readJsonIfExists(mappingPath2);
    if (!mapping || !mapping.fields) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'mapping.json not found or invalid' }),
      };
    }

    const templateBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(templateBytes);

    if (fontkit) {
      try {
        pdfDoc.registerFontkit(fontkit);
      } catch (e) {
        // ignore
      }
    }

    // Prefer malgun.ttf if available, else fallback to StandardFonts.
    let font = null;
    const malgunPath = path.join(repoRoot, 'malgun.ttf');
    if (fontkit && fs.existsSync(malgunPath)) {
      try {
        font = await pdfDoc.embedFont(fs.readFileSync(malgunPath));
      } catch (e) {
        font = null;
      }
    }
    if (!font) {
      // Standard font always available
      font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    }

    const fields = mapping.fields;

    // draw loop
    for (const [key, f] of Object.entries(fields)) {
      const pageIndex = Math.max(0, (f.page || 1) - 1);
      const page = pdfDoc.getPage(pageIndex);

      const x = Number(f.x || 0);
      const y = Number(f.y || 0);
      const size = Number(f.size || 10);

      const type = (f.type || 'text').toLowerCase();
      const src = Array.isArray(f.source) && f.source.length ? f.source[0] : null;

      const val = src ? data[src] : data[key];

      const treatAsCheckbox = type === 'checkbox' || isCheckboxKey(key) || f.on_value != null;

      if (treatAsCheckbox) {
        // Determine if checked
        let checked = false;

        if (f.on_value != null) {
          // If mapping explicitly provides on_value, compare against the source value (or base option key).
          const compareVal = src ? data[src] : (data[src || key] ?? val);
          checked = String(compareVal ?? '') === String(f.on_value);
        } else {
          // Infer from key pattern: base_option
          const optInfo = optionFromKey(key);
          if (optInfo) {
            const baseVal = data[optInfo.base];
            checked = String(baseVal ?? '').toLowerCase() === String(optInfo.opt).toLowerCase();
          } else {
            // boolean style
            checked = normalizeBool(val);
          }
        }

        if (checked) {
          page.drawText('V', {
            x,
            y,
            size,
            font,
          });
        }
        continue;
      }

      // text field
      let text = val == null ? '' : String(val);

      if (key.endsWith('_print') && text.length > 25) {
        text = splitEvery(text, 25);
      }

      if (text) {
        page.drawText(text, {
          x,
          y,
          size,
          font,
          lineHeight: size + 2,
        });
      }
    }

    const pdfBytesOut = await pdfDoc.save();

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/pdf',
        // Let the frontend choose inline vs attachment. Default to inline.
        'Content-Disposition': 'inline; filename="freet.pdf"',
        'Cache-Control': 'no-store',
      },
      body: Buffer.from(pdfBytesOut).toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ error: String(err && err.message ? err.message : err), stack: err && err.stack }),
    };
  }
};
