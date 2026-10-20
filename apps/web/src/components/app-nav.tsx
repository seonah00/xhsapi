'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useEffect,useRef} from 'react';
export function AppNav({items,admin}:{items:readonly(readonly[string,string])[];admin:boolean}){
 const path=usePathname(),current=useRef<HTMLAnchorElement>(null);
 const selected=items.filter(([href])=>path===href||(href!=='/app'&&href!=='/admin'&&path.startsWith(href+'/'))).sort((a,b)=>b[0].length-a[0].length)[0]?.[0];
 useEffect(()=>{current.current?.scrollIntoView({block:'nearest',inline:'nearest'});},[path]);
 return <ul className="flex gap-1 whitespace-nowrap pb-2">{items.map(([href,label])=><li key={href}><Link ref={selected===href?current:undefined} aria-current={selected===href?'page':undefined} href={href} className={`block min-h-11 rounded-lg px-3 py-3 text-sm ${selected===href?(admin?'bg-bg/15 font-semibold':'bg-accent-soft font-semibold text-accent'):(admin?'hover:bg-bg/10':'hover:bg-bg')}`}>{label}</Link></li>)}</ul>;
}
