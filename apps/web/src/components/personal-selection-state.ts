export type SelectedEntry={id:string;term:string;entryType:'tag'|'expression'};
export function toggleSelection(current:SelectedEntry[],entry:SelectedEntry,checked:boolean):SelectedEntry[]{
 const remaining=current.filter(e=>e.id!==entry.id);
 if(!checked)return remaining;
 if(remaining.filter(e=>e.entryType===entry.entryType).length>=(entry.entryType==='tag'?8:3))return current;
 return [...remaining,entry];
}
export function restoreSelection(raw:string|null,scope:string):SelectedEntry[]{
 try{
  const value=JSON.parse(raw??'null');if(value?.scope!==scope||!Array.isArray(value.items))return [];
  let result:SelectedEntry[]=[];
  for(const item of value.items.slice(0,100)){
   if(!item||typeof item.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)||typeof item.term!=='string'||!item.term.trim()||item.term.length>120||!['tag','expression'].includes(item.entryType))continue;
   result=toggleSelection(result,{id:item.id,term:item.term,entryType:item.entryType},true);
  }return result;
 }catch{return [];}
}
