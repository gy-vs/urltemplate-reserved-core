import {describe, expect, it} from 'vitest';
import {encodeValue, expand, parse} from '../src/index.js';

/** 用 encodeURIComponent 交叉验证单字符的 UTF-8 百分号编码。 */
const ref = (s: string) => encodeURIComponent(s);

describe('普通扩展（无运算符）', () => {
	it('不编码 unreserved 字符', () => {
		expect(expand('{v}', {v: 'aZ0-._~'})).toBe('aZ0-._~');
	});

	it('空格编码为 %20', () => {
		expect(expand('/{id}', {id: 'a b'})).toBe('/a%20b');
	});

	it('斜杠、问号、井号即使保留也必须编码', () => {
		expect(expand('{v}', {v: 'a/b?c#d'})).toBe('a%2Fb%3Fc%23d');
	});

	it('其他保留字符同样编码（unreserved 仅 ALPHA/DIGIT/-._~）', () => {
		expect(encodeValue(':@!$&\'()*+,;=[]', false)).toBe(
			'%3A%40%21%24%26%27%28%29%2A%2B%2C%3B%3D%5B%5D',
		);
	});

	it('十六进制输出统一为大写', () => {
		expect(expand('{v}', {v: 'a/b'})).toBe('a%2Fb');
	});
});

describe('保留扩展（+ / # 运算符）', () => {
	it('{+path} 保留斜杠', () => {
		expect(expand('{+path}', {path: 'a/b/c'})).toBe('a/b/c');
	});

	it('{+path} 保留问号与井号', () => {
		expect(expand('{+path}', {path: 'a?b#c'})).toBe('a?b#c');
	});

	it('保留全部 gen-delims / sub-delims', () => {
		expect(encodeValue(':/?#[]@!$&\'()*+,;=', true)).toBe(
			':/?#[]@!$&\'()*+,;=',
		);
	});

	it('空格在保留扩展中仍然编码', () => {
		expect(expand('{+v}', {v: 'a b'})).toBe('a%20b');
	});

	it('# 运算符带前缀且保留字符原样', () => {
		expect(expand('{#v}', {v: '/a?b'})).toBe('#/a?b');
	});

	it('# 运算符下空格仍编码', () => {
		expect(expand('{#v}', {v: 'a b'})).toBe('#a%20b');
	});

	it('普通字面百分号即使在保留扩展中也编码为 %25', () => {
		expect(expand('{+v}', {v: '100%'})).toBe('100%25');
	});
});

describe('已有百分号序列', () => {
	it('普通扩展：合法且解码为允许字符时规范保留（小写转大写）', () => {
		// %7E 解码为 '~'，属于 unreserved => 保留并规范化大写
		expect(expand('{v}', {v: '%7e'})).toBe('%7E');
		expect(expand('{v}', {v: '%41'})).toBe('%41');
	});

	it('普通扩展：解码为保留字符时不保留，% 按字面编码', () => {
		// %2F -> '/' 不属于普通允许集合 => % 变 %25，2F 保持
		expect(expand('{v}', {v: '%2F'})).toBe('%252F');
	});

	it('保留扩展：合法且解码为允许字符（含保留字符）时规范保留', () => {
		expect(expand('{+v}', {v: '%2f'})).toBe('%2F');
		expect(expand('{+v}', {v: '%3f'})).toBe('%3F');
		expect(expand('{+v}', {v: '%7E'})).toBe('%7E');
	});

	it('非法序列：十六进制数字缺失时百分号编码为字面 %25', () => {
		expect(expand('{+v}', {v: '%2'})).toBe('%252');
		expect(expand('{+v}', {v: '100%'})).toBe('100%25');
		expect(expand('{v}', {v: '%'})).toBe('%25');
	});

	it('非法序列：非十六进制数字按字面百分号编码', () => {
		expect(expand('{+v}', {v: '%2G'})).toBe('%252G');
		expect(expand('{+v}', {v: '%GG'})).toBe('%25GG');
	});

	it('普通扩展下非法序列中后续字符各自编码', () => {
		// % 非法 => %25；'/' 普通扩展编码 => %2F
		expect(expand('{v}', {v: '%/'})).toBe('%25%2F');
	});

	it('合法但解码为非 ASCII 字节（>=0x80）时不保留', () => {
		// 百分号编码的 UTF-8 字节必须重新编码，避免把任意字节误认作合法 pct-encoding
		expect(expand('{+v}', {v: '%E4%BD%A0'})).toBe(
			'%25E4%25BD%25A0',
		);
	});

	it('十六进制大小写规范化（仅作用于保留的序列）', () => {
		expect(expand('{+v}', {v: '%2f%3F'})).toBe('%2F%3F');
	});

	it('混合合法与非法序列', () => {
		expect(expand('{+path}', {path: '/a%2f/b%zz/%3F'})).toBe(
			'/a%2F/b%25zz/%3F',
		);
	});
});

describe('Unicode：按标量编码为 UTF-8（不使用 UTF-16 code unit）', () => {
	it('非 BMP 字符 emoji 编码为 4 个 UTF-8 字节，而不是两个坏 3 字节序列', () => {
		// U+1F600 => F0 9F 98 80
		expect(expand('{v}', {v: '😀'})).toBe('%F0%9F%98%80');
		expect(expand('{+v}', {v: '😀'})).toBe('%F0%9F%98%80');
	});

	it('emoji 与 ASCII 混排不错位、不吞字符', () => {
		expect(expand('{v}', {v: 'x😀y'})).toBe('x%F0%9F%98%80y');
		expect(expand('{v}', {v: '😀😀'})).toBe(
			'%F0%9F%98%80%F0%9F%98%80',
		);
	});

	it('与 encodeURIComponent 的 UTF-8 结果一致', () => {
		for (const s of ['你好', 'Ω', '€', '😴', '👨‍👩‍👧']) {
			expect(encodeValue(s, false)).toBe(ref(s));
		}
	});

	it('组合字符按各自标量顺序编码', () => {
		// 'e' + U+0301（组合重音）=> 65 CC 81
		expect(expand('{v}', {v: 'e\u0301'})).toBe('e%CC%81');
		// 预组合 é = U+00E9 => C3 A9
		expect(expand('{v}', {v: '\u00E9'})).toBe('%C3%A9');
	});

	it('孤立代理替换为 U+FFFD（EF BF BD）', () => {
		expect(encodeValue('a\uD800b', false)).toBe('a%EF%BF%BDb');
		expect(encodeValue('a\uDC00b', false)).toBe('a%EF%BF%BDb');
	});
});

describe('数组值', () => {
	it('普通扩展：逗号连接，成员按普通规则编码', () => {
		expect(expand('{v}', {v: ['a b', 'c/d']})).toBe('a%20b,c%2Fd');
	});

	it('保留扩展：逗号分隔，成员保留保留字符', () => {
		expect(expand('{+v}', {v: ['a/b', 'c?d#e']})).toBe('a/b,c?d#e');
	});

	it('explode：使用运算符分隔符并带正确前缀', () => {
		expect(expand('{/v*}', {v: ['a b', 'c']})).toBe('/a%20b/c');
		expect(expand('{+v*}', {v: ['a/b', 'c']})).toBe('a/b,c');
	});

	it('explode 命名形式', () => {
		expect(expand('{?v*}', {v: ['a b', 'c']})).toBe('?v=a%20b&v=c');
	});

	it('成员中百分号序列按成员允许集合处理', () => {
		expect(expand('{+v}', {v: ['%2f', '%2G', 'x']})).toBe(
			'%2F,%252G,x',
		);
	});

	it('emoji 数组元素按 UTF-8 编码', () => {
		expect(expand('{v}', {v: ['😀', 'a']})).toBe(
			'%F0%9F%98%80,a',
		);
	});

	it('空数组与 undefined 一样省略表达式', () => {
		expect(expand('a{v}b', {v: []})).toBe('ab');
		expect(expand('a{v}b', {v: undefined})).toBe('ab');
	});
});

describe('解析再扩展不增加编码层数', () => {
	it('parse 只解析一次，多次 expand 结果一致', () => {
		const t = parse('{+path}');
		expect(t.length).toBe(1);
		const vars = {path: '/a%2f/b?x=1'};
		const once = t.map((p) => (typeof p === 'string' ? p : p.expand(vars))).join('');
		const twice = t
			.map((p) => (typeof p === 'string' ? p : p.expand(vars)))
			.join('');
		expect(twice).toBe(once);
		expect(once).toBe('/a%2F/b?x=1');
	});

	it('expand 与 parse().expand 完全等价（不因解析多编一层）', () => {
		const template = '/{a}/{+b}{?c*}';
		const vars = {a: 'a b', b: '/x%2f/y', c: ['p q', 'r/s']};
		const viaParse = parse(template)
			.map((p) => (typeof p === 'string' ? p : p.expand(vars)))
			.join('');
		expect(viaParse).toBe(expand(template, vars));
		expect(viaParse).toBe('/a%20b//x%2F/y?c=p%20q&c=r%2Fs');
	});

	it('允许集合内的合法序列在 + 扩展下是固定点（不累积 %25）', () => {
		const vars1 = {v: 'a%2f%3Fz'};
		const first = expand('{+v}', vars1);
		expect(first).toBe('a%2F%3Fz');
		expect(expand('{+v}', {v: first})).toBe(first);
		expect(expand('{+v}', {v: expand('{+v}', {v: first})})).toBe(first);
	});

	it('层数差异来自规则本身而非解析/调用次数：同一变量多次 parse.expand 一致', () => {
		const t = parse('{v}/{+v}');
		const vars = {v: '%7e'}; // 解码为 '~'，普通与保留集合均允许
		const run = () =>
			t.map((p) => (typeof p === 'string' ? p : p.expand(vars))).join('');
		expect(run()).toBe('%7E/%7E');
		expect(run()).toBe(run());
	});
});

describe('对象值、其余运算符与空值', () => {
	it('对象普通形式为 k,v 列表', () => {
		expect(expand('{v}', {v: {a: 'x y', b: 'p/q'}})).toBe(
			'a,x%20y,b,p%2Fq',
		);
	});

	it('对象 explode 使用键值对与运算符分隔符', () => {
		expect(expand('{?v*}', {v: {a: 'x y', b: 'p/q'}})).toBe(
			'?a=x%20y&b=p%2Fq',
		);
		expect(expand('{&v*}', {v: {a: 'x y'}})).toBe('&a=x%20y');
	});

	it('路径风格运算符', () => {
		expect(expand('{.v}', {v: 'a b'})).toBe('.a%20b');
		expect(expand('{/v}', {v: 'a b'})).toBe('/a%20b');
	});

	it('分号风格运算符', () => {
		expect(expand('{;v}', {v: 'a b'})).toBe(';v=a%20b');
		expect(expand('{;v}', {v: ''})).toBe(';v');
	});

	it('问号风格运算符与空串', () => {
		expect(expand('{?v}', {v: ''})).toBe('?v=');
		expect(expand('{&v}', {v: ''})).toBe('&v=');
	});

	it('空串普通/保留扩展本身为空', () => {
		expect(expand('x{v}y', {v: ''})).toBe('xy');
		expect(expand('x{+v}y', {v: ''})).toBe('xy');
	});

	it('变量缺失时带前缀的表达式整体省略', () => {
		expect(expand('a{?v}b', {v: undefined})).toBe('ab');
		expect(expand('a{#v}b', {v: undefined})).toBe('ab');
	});
});

describe('编码层数语义（规则驱动，与调用次数无关）', () => {
	it('普通扩展始终不透明：已编码的空格再加一层，+ 扩展保持单层', () => {
		// 输入是一次普通扩展的输出 a%20b
		expect(expand('{v}', {v: 'a%20b'})).toBe('a%2520b');
		// 同样输入在 + 下：%20 解码为空格，空格不在允许集合 => 同样再加一层
		expect(expand('{+v}', {v: 'a%20b'})).toBe('a%2520b');
	});

	it('字面 %25：% 永远不是允许字符，始终编码为 %25（' + '序列本身不被当作 %25 透传）', () => {
		// RFC 6570 保留扩展默认透传任意 %HH；本实现按“解码字节须属于允许集合”
		// 判定，而 '%' 不属于 reserved 字面字符集合。
		expect(expand('{+v}', {v: '%25'})).toBe('%2525');
		expect(expand('{v}', {v: '%25'})).toBe('%2525');
		// 孤立的百分号两种模式都编码
		expect(expand('{+v}', {v: '%'})).toBe('%25');
	});
});
