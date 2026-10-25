export function chineseReviewKey(value:{title:string;cover:string;body:string;tags:string[]}){return JSON.stringify([value.title.trim(),value.cover.trim(),value.body,value.tags]);}
export function restoreWithSelection<T extends {tags:string[];entryIds:string[]}>(value:T,entries:{id:string;term:string;entryType:string}[]):T{
 if(!entries.length)return value;
 return {...value,entryIds:entries.map(e=>e.id),tags:[...new Set([...value.tags,...entries.filter(e=>e.entryType==='tag').map(e=>e.term)])]};
}
