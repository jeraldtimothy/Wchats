import { strToU8, zipSync } from 'fflate';

const x = (s: string) => strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${s}`);

export function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': x('<Types/>'),
    'word/document.xml': x(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    ),
  });
}

export const para = (...runs: string[]) => `<w:p>${runs.map((r) => `<w:r><w:t xml:space="preserve">${r}</w:t></w:r>`).join('')}</w:p>`;

export function xlsx(): Uint8Array {
  return zipSync({
    'xl/workbook.xml': x(
      '<workbook xmlns:r="r"><sheets><sheet name="Budget &amp; Plan" sheetId="1" r:id="rId1"/><sheet name="Empty" sheetId="2" r:id="rId2"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': x(
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    ),
    'xl/sharedStrings.xml': x('<sst><si><t>Item</t></si><si><t>Cost</t></si><si><r><t>Coffee </t></r><r><t>beans</t></r></si></sst>'),
    'xl/worksheets/sheet1.xml': x(
      '<worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>12.5</v></c><c r="D2" t="b"><v>1</v></c></row>' +
        '<row r="3"><c r="A3" t="inlineStr"><is><t>Tea &lt;green&gt;</t></is></c></row>' +
        '</sheetData></worksheet>',
    ),
    'xl/worksheets/sheet2.xml': x('<worksheet><sheetData/></worksheet>'),
  });
}

const slide = (...paras: string[]) =>
  x(`<p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree>${paras.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:spTree></p:cSld></p:sld>`);

export function pptx(): Uint8Array {
  // slide2.xml is shown first: order comes from presentation.xml, not file names.
  return zipSync({
    'ppt/presentation.xml': x('<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>'),
    'ppt/_rels/presentation.xml.rels': x(
      '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>',
    ),
    'ppt/slides/slide1.xml': slide('Second slide', 'Details'),
    'ppt/slides/slide2.xml': slide('Title slide'),
  });
}

export const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a70000000049454e44ae426082', 'hex');
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
