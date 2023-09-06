import{m as p}from"./assets/module.esm-62c37d0d.js";document.addEventListener("alpine:init",()=>{p.data("recoveryCodes",function(){const{codeList:o}=this.$refs,{downloadFileDate:n,downloadFileDescription:i,downloadFileHeader:d,downloadFileName:s}=this.$store.recoveryCodes,a=new Date().toLocaleString(navigator.language),r=o.getElementsByTagName("li"),l=Array.from(r).map(t=>t.innerText).join(`
`);return{copy:()=>navigator.clipboard.writeText(l),download:()=>{const t=document.createElement("a"),c=`${d}

${l}

${i}

${n} ${a}`;t.setAttribute("href","data:text/plain;charset=utf-8,"+encodeURIComponent(c)),t.setAttribute("download",`${s}.txt`),t.click()},print:()=>{const t=o.innerHTML,m=`<html><style>div { font-family: monospace; list-style-type: none }</style><body><title>${s}</title><p>${d}</p><div>${t}</div><p>${i}</p><p>${n} ${a}</p></body></html>`,e=window.open();e&&(e.document.write(m),e.print(),e.close())}}})});
