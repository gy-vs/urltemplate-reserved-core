import {expect,it,describe} from 'vitest';
import {expand,parse} from '../src/index.js';

it('expands a value',()=>expect(expand('/{id}',{id:'a b'})).toBe('/a%20b'));

describe('simple expansion',()=>{
  it('encodes reserved characters',()=>{
    expect(expand('{p}',{p:'a/b'})).toBe('a%2Fb');
    expect(expand('{p}',{p:'a?b'})).toBe('a%3Fb');
    expect(expand('{p}',{p:'a#b'})).toBe('a%23b');
    expect(expand('{p}',{p:'a b'})).toBe('a%20b');
  });
  it('keeps a valid triplet only when its byte is unreserved',()=>{
    expect(expand('{p}',{p:'a%41b'})).toBe('a%41b');
    expect(expand('{p}',{p:'a%7Eb'})).toBe('a%7Eb');
    expect(expand('{p}',{p:'a%2Fb'})).toBe('a%252Fb');
    expect(expand('{p}',{p:'a%20b'})).toBe('a%2520b');
  });
});

describe('reserved expansion',()=>{
  it('keeps reserved characters literally',()=>{
    expect(expand('{+p}',{p:'a/b?c#d'})).toBe('a/b?c#d');
    expect(expand('{+p}',{p:'a b'})).toBe('a%20b');
    expect(expand('{#p}',{p:'a/b?c'})).toBe('#a/b?c');
  });
  it('preserves valid triplets whose byte is reserved, normalized to uppercase',()=>{
    expect(expand('{+p}',{p:'a%2Fb'})).toBe('a%2Fb');
    expect(expand('{+p}',{p:'a%2fb'})).toBe('a%2Fb');
    expect(expand('{+p}',{p:'a%3Fb%23c'})).toBe('a%3Fb%23c');
  });
  it('encodes the percent sign when the decoded byte is not allowed',()=>{
    expect(expand('{+p}',{p:'a%20b'})).toBe('a%2520b');
    expect(expand('{+p}',{p:'a%C3%A9b'})).toBe('a%25C3%25A9b');
  });
});

describe('invalid percent sequences',()=>{
  it('encodes the percent sign literally',()=>{
    expect(expand('{+p}',{p:'100%'})).toBe('100%25');
    expect(expand('{+p}',{p:'a%2'})).toBe('a%252');
    expect(expand('{+p}',{p:'a%2Gb'})).toBe('a%252Gb');
    expect(expand('{p}',{p:'a%b'})).toBe('a%25b');
  });
});

describe('unicode',()=>{
  it('encodes non-BMP characters as one UTF-8 sequence',()=>{
    expect(expand('{p}',{p:'😀'})).toBe('%F0%9F%98%80');
    expect(expand('{+p}',{p:'😀'})).toBe('%F0%9F%98%80');
  });
  it('encodes combining and precomposed characters as UTF-8',()=>{
    expect(expand('{p}',{p:'é'})).toBe('e%CC%81');
    expect(expand('{p}',{p:'é'})).toBe('%C3%A9');
    expect(expand('{p}',{p:'中'})).toBe('%E4%B8%AD');
  });
});

describe('arrays and named operators',()=>{
  it('joins array values with a literal comma',()=>{
    expect(expand('{p}',{p:['a b','c/d']})).toBe('a%20b,c%2Fd');
    expect(expand('{+p}',{p:['a/b','c d']})).toBe('a/b,c%20d');
  });
  it('expands query operators with encoded values',()=>{
    expect(expand('{?q}',{q:'a b'})).toBe('?q=a%20b');
    expect(expand('{&q}',{q:'a?b&c'})).toBe('&q=a%3Fb%26c');
    expect(expand('{?q}',{q:['a','b']})).toBe('?q=a,b');
  });
});

describe('parse then expand',()=>{
  it('produces identical output no matter how often it is expanded',()=>{
    const template=parse('/{+path}{?q}');
    const variables={path:'a%2Fb c',q:'x y'};
    const once=expand(template,variables);
    expect(once).toBe('/a%2Fb%20c?q=x%20y');
    expect(expand(template,variables)).toBe(once);
    expect(expand(template,variables)).toBe(once);
    expect(expand('/{+path}{?q}',variables)).toBe(once);
  });
  it('does not add encoding layers to preserved triplets',()=>{
    const once=expand('{+p}',{p:'a%2Fb'});
    expect(expand('{+p}',{p:once})).toBe(once);
  });
});
