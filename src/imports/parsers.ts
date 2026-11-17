/** Local-only parsers for bank statements and card invoices. Values are cents. */
export type ImportKind = 'income' | 'expense' | 'transfer' | 'invoice_payment' | 'review';
export interface ImportedTransaction {
  date: string;
  description: string;
  amount: number;
  kind: ImportKind;
  category: string;
  fitId?: string;
  balance?: number;
  installmentNumber?: number;
  installmentCount?: number;
}
export interface StatementImport {
  account?: string;
  period?: string;
  openingBalance?: number;
  transactions: ImportedTransaction[];
  months: Array<{ month: string; inflow: number; outflow: number }>;
}
export interface InvoiceMapping { date: number; description: number; amount: number; installment?: number }
export interface InvoiceImport { headers: string[]; rows: ImportedTransaction[] }

export function parseBrazilianAmount(input: string): number {
  const s = input.trim().replace(/\s/g, '').replace(/^R\$/i, '');
  if (!/^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(s)) throw new Error('Valor inválido: confira o formato numérico.');
  const negative = s.startsWith('-');
  const [whole, fraction = ''] = s.replace(/^[+-]/, '').split(',');
  const cents = Number(whole.replace(/\./g, '')) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('Valor fora do intervalo permitido.');
  return negative ? -cents : cents;
}

function dateISO(value: string): string {
  const text = value.trim();
  const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  const iso = brazilian ? `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}` : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error('Use uma data DD/MM/AAAA ou AAAA-MM-DD.');
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.valueOf()) || d.toISOString().slice(0, 10) !== iso) throw new Error('Data inválida.');
  return iso;
}

export function periodDates(period?: string): { from: string; to: string } | undefined {
  const dates = period?.match(/\d{2}\/\d{2}\/\d{4}/g);
  if (!dates || dates.length < 2) return undefined;
  try {
    const from = dateISO(dates[0]); const to = dateISO(dates[1]);
    return from <= to ? { from, to } : undefined;
  } catch { return undefined; }
}

/** CSV scanner supports quoted delimiters, newlines and escaped quotes. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  const data = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (quoted) {
      if (c === '"' && data[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && data[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('Arquivo CSV contém campo entre aspas incompleto.');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function classify(description: string, amount: number): Pick<ImportedTransaction, 'kind' | 'category'> {
  const normalized = description.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\b(pagamento|pagto|pgto|debito)\b.*\bfatura\b|\bfatura\b.*\b(pagamento|pagto|pgto|debito)\b/.test(normalized)) return { kind: 'invoice_payment', category: 'Pagamento de fatura' };
  if (/\b(pix|transferencia|ted|doc)\b/.test(normalized)) return { kind: 'review', category: 'Revisar' };
  return amount >= 0 ? { kind: 'income', category: 'Outras receitas' } : { kind: 'expense', category: 'Outras despesas' };
}

function coverage(transactions: Array<Pick<ImportedTransaction, 'date' | 'amount'>>): StatementImport['months'] {
  const values = new Map<string, { month: string; inflow: number; outflow: number }>();
  for (const t of transactions) {
    const month = t.date.slice(0, 7); const entry = values.get(month) ?? { month, inflow: 0, outflow: 0 };
    if (t.amount > 0) entry.inflow += t.amount; else entry.outflow += -t.amount;
    values.set(month, entry);
  }
  return [...values.values()].sort((a, b) => a.month.localeCompare(b.month));
}
export { coverage as summarizeMonths };

export function parseInterStatement(text: string): StatementImport {
  const rows = parseDelimited(text, ';');
  const expected = ['Data Lançamento', 'Histórico', 'Descrição', 'Valor', 'Saldo'];
  const header = rows.findIndex(row => expected.every((v, i) => row[i]?.trim() === v) && row.length === expected.length);
  if (header < 0) throw new Error('Cabeçalho do extrato Inter não encontrado.');
  const metadata = new Map(rows.slice(0, header).filter(r => r.length >= 2).map(r => [r[0].trim().toLowerCase(), r.slice(1).join(';').trim()]));
  const transactions = rows.slice(header + 1).filter(row => row.some(v => v.trim())).map((row, i) => {
    if (row.length !== 5) throw new Error(`Linha ${header + i + 2}: quantidade de colunas inválida.`);
    const amount = parseBrazilianAmount(row[3]);
    const description = [row[1].trim(), row[2].trim()].filter(Boolean).join(' — ');
    return { date: dateISO(row[0]), description, amount, balance: parseBrazilianAmount(row[4]), ...classify(description, amount) };
  });
  const balance = metadata.get('saldo');
  return { account: metadata.get('conta'), period: metadata.get('período') ?? metadata.get('periodo'), openingBalance: balance ? parseBrazilianAmount(balance) : undefined, transactions, months: coverage(transactions) };
}

function decodeEntity(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, e => {
    const names: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
    if (names[e.toLowerCase()]) return names[e.toLowerCase()];
    const n = e[2].toLowerCase() === 'x' ? parseInt(e.slice(3, -1), 16) : parseInt(e.slice(2, -1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
}
function ofxValue(block: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}\\s*>([^<\\r\\n]*)`, 'i').exec(block);
  return match ? decodeEntity(match[1].trim()) : undefined;
}
export function parseOfx(text: string): StatementImport {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Declarações externas não são permitidas no OFX.');
  if (!/<OFX(?:\s|>)/i.test(text)) throw new Error('Arquivo OFX inválido.');
  const blocks = text.split(/<STMTTRN\s*>/i).slice(1);
  const transactions = blocks.map(block => {
    const date = ofxValue(block, 'DTPOSTED'); const raw = ofxValue(block, 'TRNAMT'); const fitId = ofxValue(block, 'FITID');
    if (!date || !/^\d{8}/.test(date) || !raw || !/^[+-]?\d+(?:\.\d{1,2})?$/.test(raw) || !fitId) throw new Error('Lançamento OFX sem data, valor ou FITID válido.');
    const iso = dateISO(`${date.slice(6, 8)}/${date.slice(4, 6)}/${date.slice(0, 4)}`);
    const amount = parseBrazilianAmount(raw.replace('.', ','));
    const description = [ofxValue(block, 'NAME'), ofxValue(block, 'MEMO')].filter(Boolean).join(' — ') || 'Lançamento';
    return { date: iso, description, amount, fitId, ...classify(description, amount) };
  });
  return { account: ofxValue(text, 'ACCTID'), period: [ofxValue(text, 'DTSTART'), ofxValue(text, 'DTEND')].filter(Boolean).join(' – ') || undefined, transactions, months: coverage(transactions) };
}

export function deduplicateFitIds(rows: ImportedTransaction[], existing: Iterable<string>): ImportedTransaction[] {
  const seen = new Set(existing);
  return rows.filter(row => { if (!row.fitId) return true; if (seen.has(row.fitId)) return false; seen.add(row.fitId); return true; });
}

export function hasPossibleDuplicate(
  row: { date: string; amount: number; description: string },
  entries: Array<{ date: string; amount: number; description: string; accountId?: string }>,
  accountId: string,
): boolean {
  const description = row.description.trim().toLocaleLowerCase('pt-BR');
  return entries.some(entry => entry.accountId === accountId && entry.date === row.date &&
    entry.amount === row.amount && entry.description.trim().toLocaleLowerCase('pt-BR') === description);
}

export function decodeImportFile(bytes: ArrayBuffer, ofx: boolean): string {
  const data = new Uint8Array(bytes);
  if (ofx) {
    const prefix = new TextDecoder('windows-1252').decode(data.subarray(0, 1024));
    if (/CHARSET\s*:\s*(?:1252|WINDOWS-1252)|ENCODING\s*:\s*USASCII/i.test(prefix)) {
      return new TextDecoder('windows-1252').decode(data);
    }
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(data); }
  catch {
    if (ofx) return new TextDecoder('windows-1252').decode(data);
    throw new Error('O CSV precisa estar em UTF-8.');
  }
}

export function parseInvoiceCsv(text: string, mapping: InvoiceMapping, delimiter = ';'): InvoiceImport {
  const [headers, ...data] = parseDelimited(text, delimiter);
  const columns = [mapping.date, mapping.description, mapping.amount];
  if (mapping.installment !== undefined) columns.push(mapping.installment);
  if (!headers?.length || new Set(columns).size !== columns.length ||
      columns.some(i => !Number.isInteger(i) || i < 0 || i >= headers.length)) {
    throw new Error('Selecione uma coluna diferente para cada campo.');
  }
  const rows = data.filter(row => row.some(v => v.trim())).map(row => {
    if (row.length !== headers.length) throw new Error('Quantidade de colunas inválida na fatura.');
    const value = row[mapping.amount].trim();
    const normalized = /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)\.\d{1,2}$/.test(value)
      ? value.replaceAll(',', '').replace('.', ',') : value;
    const amount = parseBrazilianAmount(normalized);
    const description = row[mapping.description].trim();
    if (!description) throw new Error('Descrição da fatura está vazia.');
    const installment = mapping.installment === undefined ? '' : row[mapping.installment].trim();
    const parcel = installment ? installmentKey(installment.replace(/\s+de\s+/i, '/')) : installmentKey(description);
    if (installment && !parcel) throw new Error('Use a parcela no formato 2/6.');
    return {
      date: dateISO(row[mapping.date]), description, amount, kind: 'expense' as const,
      category: 'Outras despesas', installmentNumber: parcel?.installment, installmentCount: parcel?.total,
    };
  });
  return { headers, rows };
}

export function installmentKey(description: string): { name: string; installment: number; total: number } | undefined {
  const match = /(?:^|\s)(\d{1,2})\s*\/\s*(\d{1,2})(?:\s|$)/.exec(description);
  if (!match || +match[1] < 1 || +match[2] < 2 || +match[1] > +match[2]) return undefined;
  return { name: description.replace(match[0], ' ').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR'), installment: +match[1], total: +match[2] };
}
