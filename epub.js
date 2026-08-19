// epub.js - Extracción de texto desde un EPUB (sin DOM, regex sobre XML)
// ======================================================================
// Convierte un archivo .epub (ZIP con XHTML) a texto plano en líneas,
// con el MISMO aspecto que la extracción de PDF (texto + cabeceras):
//   - Cada párrafo/bloque va en su propia línea.
//   - Las cabeceras (h1..h6) van en MAYÚSCULAS en su propia línea, igual que
//     las cabeceras de sección de la Guía de Actividades en el PDF.
// Ese texto se pasa después a convertPdfMidweeks()/normalizeMidweekHeaders()
// sin tocar el resto del pipeline.

// Decodifica entidades XML/HTML comunes (incluidas numéricas).
export function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&ldquo;/gi, '“')
    .replace(/&rdquo;/gi, '”')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&rsquo;/gi, '’')
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&amp;/gi, '&');
}

function safeCodePoint(n) {
  try { return String.fromCodePoint(n); } catch (e) { return ''; }
}

// Convierte el XML de una página XHTML a líneas de texto plano.
// Devuelve un array de líneas (cabeceras en mayúsculas, bloques por línea).
export function xhtmlToLines(xml) {
  let s = String(xml || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<head[\s\S]*?<\/head>/gi, ' ');
  s = s.replace(/<nav[\s\S]*?<\/nav>/gi, ' ');
  // Marcador de cabecera (h1..h6): la línea irá en mayúsculas.
  s = s.replace(/<\s*(h[1-6])\b[^>]*>/gi, '\n@@H');
  s = s.replace(/<\s*\/\s*(h[1-6])\s*>/gi, '\n');
  // Bloques: cada uno inicia una línea nueva.
  s = s.replace(/<\s*\/?(?:p|div|li|blockquote|td|th|tr|section|header|footer|figcaption|dt|dd|table)\b[^>]*>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Tags restantes (inline) se eliminan.
  s = s.replace(/<[^>]*>/g, '');
  s = decodeEntities(s);
  const lines = [];
  for (let raw of s.split('\n')) {
    const heading = raw.startsWith('@@H');
    if (heading) raw = raw.slice(3);
    const t = raw.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    lines.push(heading ? t.toUpperCase() : t);
  }
  return lines;
}

// Lee un archivo del ZIP como texto (null si no existe).
async function zipText(zip, path) {
  const f = zip.file(path);
  return f ? f.async('string') : null;
}

// Atributo de la PRIMERA etiqueta que contenga nombre="valor".
function attr(tagXml, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tagXml);
  return m ? m[1] : '';
}

// Resuelve href relativo al directorio del OPF (p. ej. "text/x.xhtml" → "OEBPS/text/x.xhtml").
export function resolvePath(baseDir, href) {
  const isAbs = String(href).startsWith('/');
  const parts = [];
  if (!isAbs && baseDir) for (const s of String(baseDir).split('/')) if (s) parts.push(s);
  for (const seg of String(href || '').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

// Extrae el texto de un EPUB completo.
//  - arrayBuffer: contenido del archivo .epub.
//  - JSZipImpl: clase JSZip (obligatoria en Node; en el navegador se usa globalThis.JSZip).
// Devuelve el texto plano (string) listo para el parseo de la guía.
export async function extractEpubText(arrayBuffer, JSZipImpl) {
  const JSZip = JSZipImpl || (typeof globalThis !== 'undefined' && globalThis.JSZip);
  if (!JSZip) throw new Error('Motor ZIP (JSZip) no disponible');
  const zip = await JSZip.loadAsync(arrayBuffer);

  const container = await zipText(zip, 'META-INF/container.xml');
  if (!container) throw new Error('EPUB inválido: falta META-INF/container.xml');

  const rootfile = /<rootfile\b[^>]*>/i.exec(container);
  const opfPath = rootfile ? attr(rootfile[0], 'full-path') : '';
  if (!opfPath) throw new Error('EPUB inválido: no se encontró el archivo OPF');

  const opf = await zipText(zip, opfPath);
  if (!opf) throw new Error('EPUB inválido: no se encontró el OPF');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';

  const manifest = {};
  for (const m of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = attr(m[0], 'id');
    const href = attr(m[0], 'href');
    if (id && href) manifest[id] = { href, media: attr(m[0], 'media-type') };
  }

  const spineIds = [];
  for (const s of opf.matchAll(/<itemref\b[^>]*>/gi)) {
    const idref = attr(s[0], 'idref');
    if (idref) spineIds.push(idref);
  }

  const out = [];
  for (const id of spineIds) {
    const item = manifest[id];
    if (!item) continue;
    const media = String(item.media || '').toLowerCase();
    if (media && !media.includes('xhtml') && !media.includes('html')) continue;
    const path = resolvePath(opfDir, item.href);
    const xml = await zipText(zip, path);
    if (xml) out.push(...xhtmlToLines(xml));
  }

  const clean = [];
  for (const l of out) if (l.trim()) clean.push(l.trim());
  return clean.join('\n');
}
