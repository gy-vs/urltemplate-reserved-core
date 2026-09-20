export type Variables=Record<string,string|string[]|Record<string,string>|undefined>;

const UNRESERVED='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
const RESERVED=":/?#[]@!$&'()*+,;=";

// Characters allowed to appear literally in the output, per expression operator.
const ALLOWED:Record<string,string>={
  '':UNRESERVED,
  '?':UNRESERVED,
  '&':UNRESERVED,
  ';':UNRESERVED,
  '+':UNRESERVED+RESERVED,
  '#':UNRESERVED+RESERVED,
};

const HEX='0123456789ABCDEF';
const pct=(byte:number)=>'%'+HEX[byte>>4]+HEX[byte&15];
const isHexDigit=(ch:string|undefined)=>ch!=null&&((ch>='0'&&ch<='9')||(ch>='A'&&ch<='F')||(ch>='a'&&ch<='f'));

function utf8Bytes(cp:number):number[]{
  if(cp<0x80)return[cp];
  if(cp<0x800)return[0xC0|(cp>>6),0x80|(cp&0x3F)];
  if(cp<0x10000)return[0xE0|(cp>>12),0x80|((cp>>6)&0x3F),0x80|(cp&0x3F)];
  return[0xF0|(cp>>18),0x80|((cp>>12)&0x3F),0x80|((cp>>6)&0x3F),0x80|(cp&0x3F)];
}

// Encodes one value for the given allowed set. Iterates by Unicode scalar
// value (surrogate pairs combine, lone surrogates become U+FFFD) and emits
// UTF-8 bytes. A pre-existing %HH triplet is preserved (normalized to
// uppercase) only when its decoded byte is itself allowed literally;
// otherwise the percent sign is encoded as %25.
export function encodeValue(text:string,allowed:string):string{
  const chars=[...text];
  let out='';
  for(let i=0;i<chars.length;i++){
    const ch=chars[i];
    if(ch==='%'){
      const h1=chars[i+1],h2=chars[i+2];
      if(isHexDigit(h1)&&isHexDigit(h2)){
        const byte=parseInt(h1+h2,16);
        if(allowed.includes(String.fromCharCode(byte))){out+=pct(byte);i+=2;continue;}
      }
      out+='%25';
      continue;
    }
    let cp=ch.codePointAt(0)!;
    if(cp>=0xD800&&cp<=0xDFFF)cp=0xFFFD;
    if(cp<0x80&&allowed.includes(ch))out+=ch;
    else for(const byte of utf8Bytes(cp))out+=pct(byte);
  }
  return out;
}

type Token=
  |{type:'literal';text:string}
  |{type:'expression';operator:string;name:string;explode:boolean};

export interface Template{tokens:Token[]}

const EXPRESSION=/\{([+#?&;]?)([a-zA-Z0-9_]+)(\*)?\}/g;

// Parses a template into literal/expression tokens. Parsing never encodes
// anything, so a parsed Template can be expanded any number of times with
// identical results.
export function parse(template:string):Template{
  const tokens:Token[]=[];
  let last=0;
  for(const match of template.matchAll(EXPRESSION)){
    if(match.index>last)tokens.push({type:'literal',text:template.slice(last,match.index)});
    tokens.push({type:'expression',operator:match[1],name:match[2],explode:match[3]==='*'});
    last=match.index+match[0].length;
  }
  if(last<template.length)tokens.push({type:'literal',text:template.slice(last)});
  return{tokens};
}

function expandExpression(operator:string,name:string,variables:Variables):string{
  const value=variables[name];
  if(value==null)return '';
  const allowed=ALLOWED[operator]??UNRESERVED;
  const parts=Array.isArray(value)?value:typeof value==='object'?Object.entries(value).flat():[value];
  const encoded=parts.map(part=>encodeValue(part,allowed)).join(',');
  if(operator==='?'||operator==='&'||operator===';')return operator+name+'='+encoded;
  if(operator==='#')return '#'+encoded;
  return encoded;
}

export function expand(template:string|Template,variables:Variables):string{
  const tokens=typeof template==='string'?parse(template).tokens:template.tokens;
  let out='';
  for(const token of tokens){
    out+=token.type==='literal'?token.text:expandExpression(token.operator,token.name,variables);
  }
  return out;
}
