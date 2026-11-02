import {useState} from 'react';
export function readLocal(key,fallback){try{return JSON.parse(localStorage.getItem(`phonofilm:${key}`))??fallback;}catch{return fallback;}}
export function writeLocal(key,value){try{localStorage.setItem(`phonofilm:${key}`,JSON.stringify(value));return true;}catch{return false;}}
export function useLocal(key,fallback){const [value,setValue]=useState(()=>readLocal(key,fallback));return [value,next=>setValue(old=>{const result=typeof next==='function'?next(old):next;writeLocal(key,result);return result;})];}
