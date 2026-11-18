import { describe, expect, it } from 'vitest';
import { VdfParseError, parseVdf } from '../src/vdf-parser.js';

describe('parseVdf', () => {
  it('parses libraryfolders.vdf with escaped Windows paths and nested apps', () => {
    const content = `
// Library folders config
"libraryfolders"
{
\t"0"
\t{
\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"
\t\t"label"\t\t""
\t\t"apps"
\t\t{
\t\t\t"620"\t\t"123456789"
\t\t\t"1086940"\t\t"155489619569"
\t\t}
\t}
\t"1"
\t{
\t\t"path"\t\t"D:\\\\SteamLibrary"
\t\t"label"\t\t"Games \\"SSD\\""
\t\t"apps"
\t\t{
\t\t}
\t}
}
`;

    const parsed = parseVdf(content);
    expect(parsed.libraryfolders['0'].path).toBe('C:\\Program Files (x86)\\Steam');
    expect(parsed.libraryfolders['0'].label).toBe('');
    expect(parsed.libraryfolders['0'].apps['620']).toBe('123456789');
    expect(parsed.libraryfolders['1'].path).toBe('D:\\SteamLibrary');
    expect(parsed.libraryfolders['1'].label).toBe('Games "SSD"');
    expect(parsed.libraryfolders['1'].apps).toEqual({});
  });

  it('parses appmanifest_*.acf files and ignores // inside quoted strings', () => {
    const content = `\uFEFF"AppState"
{
\t"appid"\t\t"1086940"
\t"name"\t\t"Baldur's Gate 3"
\t"StateFlags"\t\t"4"
\t"installdir"\t\t"Baldurs Gate 3"
\t"LastUpdated"\t\t"1790734314"
\t"SizeOnDisk"\t\t"155489619569"
\t"Homepage"\t\t"https://baldursgate3.game" // inline comment
}
`;

    const parsed = parseVdf(content);
    expect(parsed.AppState.appid).toBe('1086940');
    expect(parsed.AppState.name).toBe("Baldur's Gate 3");
    expect(parsed.AppState.StateFlags).toBe('4');
    expect(parsed.AppState.Homepage).toBe('https://baldursgate3.game');
  });

  it('protects Object.prototype against prototype pollution keys', () => {
    const parsed = parseVdf(`
"__proto__"
{
\t"polluted"\t\t"true"
}
`);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(true);
  });

  it('throws VdfParseError with line and column on malformed input', () => {
    expect(() => parseVdf('"Root"\n{\n\t"key" "unterminated\n}')).toThrow(VdfParseError);
    expect(() => parseVdf('"Root"\n{\n\t"key"\n}')).toThrow(VdfParseError);
    expect(() => parseVdf('"Root"\n{\n\t"a" "b"\n')).toThrow(VdfParseError);
    expect(() => parseVdf('}')).toThrow(VdfParseError);
  });

  it('returns an empty object for empty or comment-only input', () => {
    expect(parseVdf('  \n // only comment \n ')).toEqual({});
  });
});
