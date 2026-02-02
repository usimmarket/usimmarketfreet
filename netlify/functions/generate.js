const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts } = require("pdf-lib");

// Optional: enables font subsetting for TTF/OTF (highly recommended to keep PDF size small)
let fontkit = null;
try {
  fontkit = require("@pdf-lib/fontkit");
} catch (e) {
  // If this is missing, Korean fonts will embed as full font (often huge) and may exceed Netlify response limits.
  fontkit = null;
}

function safeJsonParse(s) {
  try { return JSON.parse(s || "{}"); } catch { return {}; }
}

function isNonAscii(str) {
  return /[^\x00-\x7F]/.test(str);
}

async function loadFontLazy(pdfDoc, rootDir) {
  // Only load/embed when needed
  const fontPath = path.join(rootDir, "malgun.ttf");
  if (!fs.existsSync(fontPath)) return null;

  const bytes = fs.readFileSync(fontPath);

  // If fontkit is available, subset to keep output small
  if (fontkit) {
    pdfDoc.registerFontkit(fontkit);
    return await pdfDoc.embedFont(bytes, { subset: true });
  }

  // Without fontkit, embedding Malgun as full font is huge and often breaks Netlify limits.
  // Fail fast with a clear message instead of generating a too-large response.
  throw new Error("Korean font subsetting requires @pdf-lib/fontkit. Install it (npm i @pdf-lib/fontkit) and redeploy.");
}

exports.handler = async (event) => {
  // Accept POST only
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const rootDir = path.resolve(__dirname, "..", "..");

    const templatePath = path.join(rootDir, "template.pdf");
    const mappingPath = path.join(rootDir, "mappings", "mapping.json");

    const templateBytes = fs.readFileSync(templatePath);
    const mapping = safeJsonParse(fs.readFileSync(mappingPath, "utf8"));
    const data = safeJsonParse(event.body);

    const pdfDoc = await PDFDocument.load(templateBytes);

    // Standard (ASCII) font
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Lazy-load Korean font only when we actually need it
    let krFont = null;

    const pages = pdfDoc.getPages();
    const fields = (mapping && mapping.fields) ? mapping.fields : {};

    for (const [key, field] of Object.entries(fields)) {
      const pageIndex = (Number(field.page || 1) - 1);
      const page = pages[pageIndex];
      if (!page) continue;

      const x = Number(field.x || 0);
      const y = Number(field.y || 0);
      const size = Number(field.size || 10);

      const src =
        Array.isArray(field.source) ? (field.source[0] || "") :
        (typeof field.source === "string" ? field.source : "");

      // Value lookup priority:
      // 1) source[0] if present
      // 2) fallback to key (useful for output-only keys)
      const rawVal = (src && Object.prototype.hasOwnProperty.call(data, src)) ? data[src] : data[key];
      const valStr = (rawVal === undefined || rawVal === null) ? "" : String(rawVal);

      // Treat as checkbox if:
      // - explicit type is checkbox
      // - OR on_value/onValue exists (older studio versions sometimes forgot to set type)
      const isCheckbox =
        String(field.type || "").toLowerCase() === "checkbox" ||
        Object.prototype.hasOwnProperty.call(field, "on_value") ||
        Object.prototype.hasOwnProperty.call(field, "onValue");

      if (isCheckbox) {
        const onValue = (field.on_value ?? field.onValue ?? "");
        if (String(valStr) === String(onValue)) {
          // User requested: use simple 'V'
          page.drawText("V", { x, y, size: Math.max(10, size), font: helvetica });
        }
        continue;
      }

      if (!valStr) continue;

      // Choose font: Korean text needs a Korean-capable TTF, otherwise you get garbage like &&&&
      let fontToUse = helvetica;
      if (isNonAscii(valStr)) {
        if (!krFont) krFont = await loadFontLazy(pdfDoc, rootDir);
        if (krFont) fontToUse = krFont;
      }

      page.drawText(valStr, { x, y, size, font: fontToUse });
    }

    const pdfBytes = await pdfDoc.save(); // object streams ON by default (smaller)
    const b64 = Buffer.from(pdfBytes).toString("base64");

    // If this blows up again, it usually means the Korean font was embedded as full (fontkit missing)
    if (b64.length > 5_800_000) {
      console.warn("Generated PDF is large (base64 length):", b64.length);
      if (!fontkit) {
        console.warn("Tip: install @pdf-lib/fontkit to enable subsetting and reduce PDF size.");
      }
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        // Let frontend decide whether to open tab or download
        "Content-Disposition": "inline; filename=freet.pdf",
        "Cache-Control": "no-store",
      },
      body: b64,
      isBase64Encoded: true,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: String(err && err.message ? err.message : err),
        stack: err && err.stack ? String(err.stack) : null,
        hint: "If you see ResponseSizeTooLarge, ensure @pdf-lib/fontkit is installed so malgun.ttf is subset-embedded.",
      }),
    };
  }
};
