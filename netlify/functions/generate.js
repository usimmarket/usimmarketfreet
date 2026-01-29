// netlify/functions/generate.js
// Server-side PDF overlay using pdf-lib.
//
// POST JSON:
// {
//   "data": {...},                         // form data
//   "templateUrl": "/template.pdf",
//   "mappingUrl": "/mappings/mapping.json",
//   "fontUrl": "/fonts/malgun.ttf"        // optional (recommended for Korean)
// }
//
// mapping.json field spec (per key):
// {
//   "page": 1,
//   "x": 100,
//   "y": 700,
//   "size": 10,
//   "type": "text" | "checkbox",
//   "source": "subscriber_name_print",     // which data key to read (string)
//   "on_value": "new"                      // checkbox only: compare data[source] === on_value
// }

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");

function getOrigin(event) {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (base) return base.replace(/\/$/, "");
  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host;
  return `${proto}://${host}`;
}

async function fetchBinary(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return await res.json();
}

function isTruthy(v) {
  if (v === true) return true;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return ["y", "yes", "true", "1", "on", "v", "checked"].includes(s);
  }
  return !!v;
}

function drawMultiline(page, font, text, x, y, size) {
  const lines = String(text ?? "").split("\n");
  const lineHeight = Math.round(size * 1.2);
  let yy = y;
  for (const line of lines) {
    if (line === "") { yy -= lineHeight; continue; }
    page.drawText(line, { x, y: yy, size, font, color: rgb(0,0,0) });
    yy -= lineHeight;
  }
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const body = JSON.parse(event.body || "{}");
    const data = body.data || {};
    const origin = getOrigin(event);

    const templateUrl = (body.templateUrl || "/template.pdf").startsWith("http")
      ? body.templateUrl
      : origin + (body.templateUrl || "/template.pdf");

    const mappingUrl = (body.mappingUrl || "/mappings/mapping.json").startsWith("http")
      ? body.mappingUrl
      : origin + (body.mappingUrl || "/mappings/mapping.json");

    const fontUrl = body.fontUrl
      ? (body.fontUrl.startsWith("http") ? body.fontUrl : origin + body.fontUrl)
      : null;

    const [pdfBytes, mapping] = await Promise.all([
      fetchBinary(templateUrl),
      fetchJson(mappingUrl),
    ]);

    const pdfDoc = await PDFDocument.load(pdfBytes);
    pdfDoc.registerFontkit(fontkit);

    let font = null;
    if (fontUrl) {
      try {
        const fontBytes = await fetchBinary(fontUrl);
        font = await pdfDoc.embedFont(fontBytes, { subset: true });
      } catch (e) {
        font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      }
    } else {
      font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    }

    const fields = (mapping && mapping.fields) ? mapping.fields : {};
    const pages = pdfDoc.getPages();

    for (const [key, specRaw] of Object.entries(fields)) {
      const spec = specRaw || {};
      const pageIndex = Math.max(0, (spec.page || 1) - 1);
      const page = pages[pageIndex];
      if (!page) continue;

      const x = Number(spec.x || 0);
      const y = Number(spec.y || 0);
      const size = Number(spec.size || 10);
      const type = spec.type || "text";

      const sourceKey = (spec.source && String(spec.source).trim()) ? String(spec.source).trim() : key;

      if (type === "checkbox") {
        const onValue = spec.on_value;
        const srcVal = data[sourceKey];

        let shouldCheck = false;
        if (onValue !== undefined && onValue !== null && String(onValue).trim() !== "") {
          shouldCheck = String(srcVal ?? "") === String(onValue);
        } else {
          shouldCheck = isTruthy(srcVal);
        }

        if (shouldCheck) {
          page.drawText("V", { x, y, size: size || 12, font, color: rgb(0,0,0) });
        }
        continue;
      }

      const val = data[sourceKey];
      if (val === undefined || val === null || String(val).trim() === "") continue;

      drawMultiline(page, font, String(val), x, y, size);
    }

    const outBytes = await pdfDoc.save();
    const base64 = Buffer.from(outBytes).toString("base64");

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdf_base64: base64 }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
