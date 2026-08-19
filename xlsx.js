// xlsx.js - Plantilla .xlsx de participantes (generación y lectura) con JSZip
// ==========================================================================
// Genera la plantilla como OOXML (XLSX) manual: es un ZIP con XML, y ya tenemos
// JSZip vendored, así que no hace falta librería pesada (SheetJS/etc.).
// Incluye listas desplegables (<dataValidation>) para Sexo, Calificación,
// Cargo y Grupo. La lectura de la hoja llenada también es XML puro.

// Escapa caracteres XML.
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Nombre de columna (A, B, C…).
const COL_A = 65;
function colLetter(i) { return String.fromCharCode(COL_A + i); }

const HEADERS = ['Nombre', 'Sexo', 'Calificación', 'Cargo', 'Grupo'];
const DATA_ROWS = 50; // filas vacías para llenar (2..DATA_ROWS+1)

// Valores de las listas desplegables por columna.
const VALIDATIONS = {
  1: '"Masculino,Femenino"',
  2: '"A,B,C"',
  3: '"Anciano,S. Ministerial,Publicador"',
  4: '"1,2,3,4,5,6,7"',
};

function sheetXml() {
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  xml += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
  xml += '<row r="1">';
  HEADERS.forEach((h, i) => {
    xml += `<c r="${colLetter(i)}1" t="inlineStr"><is><t>${esc(h)}</t></is></c>`;
  });
  xml += '</row>';
  for (let r = 2; r <= DATA_ROWS + 1; r++) xml += `<row r="${r}"/>`;
  xml += '</sheetData>';
  if (Object.keys(VALIDATIONS).length) {
    xml += `<dataValidations count="${Object.keys(VALIDATIONS).length}">`;
    for (const col of Object.keys(VALIDATIONS)) {
      const last = DATA_ROWS + 1;
      xml += `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="${colLetter(Number(col))}2:${colLetter(Number(col))}${last}"><formula1>${VALIDATIONS[col]}</formula1></dataValidation>`;
    }
    xml += '</dataValidations>';
  }
  xml += '</worksheet>';
  return xml;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Participantes" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

// Devuelve un ArrayBuffer con la plantilla .xlsx.
//  - JSZipImpl: clase JSZip (en el navegador se usa globalThis.JSZip).
export async function generatePeopleTemplate(JSZipImpl) {
  const JSZip = JSZipImpl || (typeof globalThis !== 'undefined' && globalThis.JSZip);
  if (!JSZip) throw new Error('Motor ZIP (JSZip) no disponible');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('xl/workbook.xml', WORKBOOK);
  zip.file('xl/_rels/workbook.xml.rels', WORKBOOK_RELS);
  zip.file('xl/worksheets/sheet1.xml', sheetXml());
  return zip.generateAsync({ type: 'arraybuffer' });
}

// ---- Lectura ----

async function zipText(zip, path) {
  const f = zip.file(path);
  return f ? f.async('string') : null;
}

function xmlEscapedToText(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

// Valor de una celda: shared string (t="s"), inlineStr, numérico o booleano.
function cellValue(cellXml, shared) {
  const t = /(?:^|\s)t="([^"]+)"/.exec(cellXml);
  const v = /<v>([\s\S]*?)<\/v>/.exec(cellXml);
  const inline = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/.exec(cellXml);
  if (t && t[1] === 's') {
    if (!v) return '';
    const idx = parseInt(v[1], 10);
    return shared && shared[idx] != null ? shared[idx] : '';
  }
  if (inline) return xmlEscapedToText(inline[1]);
  if (t && t[1] === 'b') return v && v[1] === '1' ? 'VERDADERO' : 'FALSO';
  return v ? xmlEscapedToText(v[1]) : '';
}

// Parsea xl/sharedStrings.xml → array de strings.
function parseSharedStrings(xml) {
  const out = [];
  if (!xml) return out;
  let m;
  const re = /<si>([\s\S]*?)<\/si>/g;
  while ((m = re.exec(xml)) !== null) {
    const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(m[1]);
    out.push(t ? xmlEscapedToText(t[1]) : '');
  }
  return out;
}

// Convierte la referencia de columna ("B") a índice 0-based.
function colIndex(ref) {
  let n = 0;
  for (const ch of String(ref || '').toUpperCase()) {
    if (ch < 'A' || ch > 'Z') break;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

// Extrae la hoja como array de filas (array de arrays), usando los shared strings.
export function xlsxRowsFromXml(sheetXml, sharedStrings) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  let rm;
  while ((rm = rowRe.exec(sheetXml)) !== null) {
    const rowXml = rm[1] || '';
    const cells = [];
    if (rowXml) {
      let cm;
      const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
      while ((cm = cellRe.exec(rowXml)) !== null) {
        const attrs = cm[1] || cm[3] || '';
        const content = cm[2] || '';
        const ref = /(?:^|\s)r="([^"]+)"/.exec(attrs);
        const col = colIndex(ref ? ref[1] : 'A');
        const val = cellValue(`<c ${attrs}>${content}</c>`, sharedStrings);
        cells[col] = val;
      }
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}

// Lee un .xlsx llenado y devuelve las filas (array de arrays).
//  - arrayBuffer: contenido del archivo .xlsx.
//  - JSZipImpl: clase JSZip (en el navegador se usa globalThis.JSZip).
export async function parsePeopleXlsx(arrayBuffer, JSZipImpl) {
  const JSZip = JSZipImpl || (typeof globalThis !== 'undefined' && globalThis.JSZip);
  if (!JSZip) throw new Error('Motor ZIP (JSZip) no disponible');
  const zip = await JSZip.loadAsync(arrayBuffer);
  const workbook = await zipText(zip, 'xl/workbook.xml');
  const rels = await zipText(zip, 'xl/_rels/workbook.xml.rels');
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const rel = rels && /Target="([^"]+)"/.exec(rels);
  if (rel) {
    const t = rel[1];
    sheetPath = t.startsWith('/') ? t.replace(/^\/+/, '') : 'xl/' + t.replace(/^\.\//, '');
  }
  const sheetXml = await zipText(zip, sheetPath);
  if (!sheetXml) throw new Error('XLSX inválido: no se encontró la hoja de participantes');
  const shared = parseSharedStrings(await zipText(zip, 'xl/sharedStrings.xml'));
  return xlsxRowsFromXml(sheetXml, shared);
}
