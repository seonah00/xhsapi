export function pageWindow(total:number,requested=1,limit=20){
 const pages=Math.max(1,Math.ceil(total/limit));
 const page=Math.min(pages,Math.max(1,Number.isSafeInteger(requested)?requested:1));
 return {page,pages,total,limit,offset:(page-1)*limit};
}
