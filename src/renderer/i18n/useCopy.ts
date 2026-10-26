import {useI18n} from './index';
export function useCopy(){const {lang}=useI18n();return (ru:string,en:string)=>lang==='en'?en:ru;}
