/**
 * URI Template（RFC 6570）扩展。
 *
 * 编码规则：
 * - 输入先按 Unicode 标量（code point）逐字符编码为 UTF-8，非 BMP 字符
 *   （如 emoji）不会被拆成 UTF-16 代理对分别编码；孤立代理替换为 U+FFFD。
 * - 未编码字面字符按表达式运算符区分允许集合：
 *   普通运算符仅允许 unreserved，保留运算符（+、#）还允许 reserved 字符。
 * - 已有的百分号序列只有在“格式合法（% 后紧跟两个十六进制数字）且解码字节
 *   属于当前允许集合（普通：unreserved；保留：unreserved+reserved，均为 ASCII
 *   字面字符）”时才原样保留，十六进制统一规范化为大写；否则把百分号当作字面
 *   字符编码成 %25。因此空格产生的 %20、以及 %25 本身不会被透传，而 / ? # 等
 *   允许字符的 %2F %3F %23 在保留扩展下可以往返。解析与扩展是分离的两步：
 *   parse 不触碰变量值，对同一变量多次扩展结果相同，不会因调用次数增加层数。
 */

export type VariableValue = string | string[] | Record<string, string> | undefined;
export type Variables = Record<string, VariableValue>;

/** unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"（RFC 3986） */
const UNRESERVED = new Set(
	'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~',
);

/**
 * reserved = gen-delims / sub-delims（RFC 3986 第 2.2 节）。
 * 注意 '%' 不属于 reserved，它只出现在 pct-encoded 结构中。
 */
const RESERVED = new Set(UNRESERVED);
for (const ch of ':/?#[]@!$&\'()*+,;=') RESERVED.add(ch);

const HEX = new Set('0123456789abcdefABCDEF');

function isHexDigit(ch: string | undefined): boolean {
	return ch !== undefined && HEX.has(ch);
}

/** 把单个 UTF-8 字节输出为统一大写的百分号序列。 */
function pct(byte: number): string {
	return '%' + byte.toString(16).toUpperCase().padStart(2, '0');
}

/** 把 Unicode 标量编码为 1~4 个 UTF-8 字节。 */
function utf8Bytes(cp: number): number[] {
	if (cp < 0x80) return [cp];
	if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)];
	if (cp < 0x10000) {
		return [
			0xe0 | (cp >> 12),
			0x80 | ((cp >> 6) & 0x3f),
			0x80 | (cp & 0x3f),
		];
	}
	return [
		0xf0 | (cp >> 18),
		0x80 | ((cp >> 12) & 0x3f),
		0x80 | ((cp >> 6) & 0x3f),
		0x80 | (cp & 0x3f),
	];
}

/**
 * 对单个值做百分号编码。
 *
 * @param value 待编码字符串
 * @param allowReserved 是否允许保留字符（运算符 + / # 为 true）
 */
export function encodeValue(value: string, allowReserved: boolean): string {
	const allowed = allowReserved ? RESERVED : UNRESERVED;
	const chars = Array.from(value);
	let out = '';
	for (let i = 0; i < chars.length; i++) {
		const ch = chars[i];

		// 已有百分号序列：仅当 %HH 格式合法且解码字节属于当前允许集合时保留。
		// 统一转换为大写，避免大小写差异。
		if (
			ch === '%' &&
			isHexDigit(chars[i + 1]) &&
			isHexDigit(chars[i + 2])
		) {
			const byte = parseInt(chars[i + 1]! + chars[i + 2], 16);
			if (byte < 0x80 && allowed.has(String.fromCharCode(byte))) {
				out += pct(byte);
				i += 2;
				continue;
			}
		}

		const cp = ch.codePointAt(0)!;
		if (cp > 0xffff) {
			// 非 BMP 标量（含 emoji）：Array.from 已按完整码点切分，
			// 直接编码为 4 字节 UTF-8，不会产生两个坏的 3 字节序列。
			for (const byte of utf8Bytes(cp)) out += pct(byte);
		} else if (cp >= 0xd800 && cp <= 0xdfff) {
			// 孤立代理不是合法标量，按 U+FFFD 处理。
			for (const byte of utf8Bytes(0xfffd)) out += pct(byte);
		} else if (allowed.has(ch)) {
			out += ch;
		} else {
			for (const byte of utf8Bytes(cp)) out += pct(byte);
		}
	}
	return out;
}

/** 运算符配置（RFC 6570 第 3.2.1 节）。 */
interface Operator {
	/** 值之间或键值对之间的分隔符。 */
	sep: string;
	/** 表达式首字符；空串表示无。 */
	first: string;
	/** 是否允许保留字符（reserved set）原样出现。 */
	reserved: boolean;
	/** 命名形式（? & ;）：输出 name=value。 */
	named: boolean;
	/** 空值时 name 之后使用的分隔符（; 为 ';' 形式的 name，其余为 '='）。 */
	ifemp: string;
}

const OPERATORS: Record<string, Operator> = {
	'': { sep: ',', first: '', reserved: false, named: false, ifemp: '' },
	'+': { sep: ',', first: '', reserved: true, named: false, ifemp: '' },
	'#': { sep: ',', first: '#', reserved: true, named: false, ifemp: '' },
	'.': { sep: '.', first: '.', reserved: false, named: false, ifemp: '' },
	'/': { sep: '/', first: '/', reserved: false, named: false, ifemp: '' },
	';': { sep: ';', first: ';', reserved: false, named: true, ifemp: '' },
	'?': { sep: '&', first: '?', reserved: false, named: true, ifemp: '=' },
	'&': { sep: '&', first: '&', reserved: false, named: true, ifemp: '=' },
};

/** 扩展单个表达式；变量缺失（undefined）或为空集合时整体省略。 */
function expandExpression(
	operator: string,
	name: string,
	explode: boolean,
	value: VariableValue,
): string | undefined {
	const op = OPERATORS[operator]!;
	if (value === undefined) return undefined;
	const enc = (v: string): string => encodeValue(v, op.reserved);

	const prefix = (part: string): string => op.first + part;

	// 标量值（含空串）。
	if (typeof value === 'string') {
		if (op.named) {
			return prefix(name + (value.length === 0 ? op.ifemp : '=' + enc(value)));
		}
		return prefix(enc(value));
	}

	// 数组值。
	if (Array.isArray(value)) {
		if (value.length === 0) return undefined;
		if (!explode) {
			const body = value.map(enc).join(',');
			return prefix(op.named ? name + '=' + body : body);
		}
		const parts = value.map((v) =>
			op.named ? name + (v.length === 0 ? op.ifemp : '=' + enc(v)) : enc(v),
		);
		return op.first + parts.join(op.sep);
	}

	// 对象值。
	const entries = Object.entries(value);
	if (entries.length === 0) return undefined;
	if (!explode) {
		const body = entries.flatMap(([k, v]) => [enc(k), enc(v)]).join(',');
		return prefix(op.named ? name + '=' + body : body);
	}
	const parts = entries.map(([k, v]) =>
		enc(k) + (v.length === 0 ? op.ifemp : '=' + enc(v)),
	);
	return op.first + parts.join(op.sep);
}

export interface ParsedExpression {
	operator: string;
	name: string;
	explode: boolean;
	expand(variables: Variables): string;
}

export type TemplatePart = string | ParsedExpression;

const TEMPLATE_RE = /\{([+#./;?&]?)([A-Za-z0-9_]+)(\*)?\}/g;

/** 解析模板为字面量与表达式交替的结构，供后续多次扩展复用。 */
export function parse(template: string): TemplatePart[] {
	const parts: TemplatePart[] = [];
	let last = 0;
	for (const m of template.matchAll(TEMPLATE_RE)) {
		if (m.index! > last) parts.push(template.slice(last, m.index));
		const operator = m[1]!;
		const name = m[2]!;
		const explode = m[3] === '*';
		const expr: ParsedExpression = {
			operator,
			name,
			explode,
			expand(variables: Variables): string {
				return (
					expandExpression(operator, name, explode, variables[name]) ?? ''
				);
			},
		};
		parts.push(expr);
		last = m.index! + m[0].length;
	}
	if (last < template.length) parts.push(template.slice(last));
	return parts;
}

/** 按 RFC 6570 扩展 URI 模板。 */
export function expand(template: string, variables: Variables): string {
	return template.replace(
		TEMPLATE_RE,
		(_all, operator: string, name: string, star: string) =>
			expandExpression(operator, name, star === '*', variables[name]) ?? '',
	);
}
