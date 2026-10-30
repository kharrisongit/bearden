// PDF.js 5.6.205 (Apache-2.0), bundled locally; no document upload or CDN.
export function textFromItems(items) {
  const lines=[];
  for(const item of items) {
    if(!item.str?.trim())continue;
    const y=item.transform[5],x=item.transform[4];
    // Table columns often have slightly different baselines (including this
    // utility's meter rows). Half a glyph height keeps them on the same row.
    let line=lines.find(l=>Math.abs(l.y-y)<=Math.max(2,Math.min(l.height,item.height||8)*0.5));
    if(!line){line={y,height:item.height||8,items:[]};lines.push(line);}
    line.items.push({x,text:item.str});
  }
  return lines.sort((a,b)=>b.y-a.y).map(l=>l.items.sort((a,b)=>a.x-b.x).map(i=>i.text).join(' ')).join('\n');
}
export async function readStatementFile(file,onProgress=()=>{}) {
  if(!file || file.size===0)throw Error('Choose a statement with content.');
  if(file.size>15*1024*1024)throw Error('Choose a statement smaller than 15 MB.');
  if(/\.(csv|txt)$/i.test(file.name))return file.text();
  if(!/\.pdf$/i.test(file.name)&&file.type!=='application/pdf')throw Error('Choose a PDF, CSV, or text statement.');
  const pdfjs=await import('./vendor/pdfjs.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs-worker.mjs',import.meta.url).href;
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,useSystemFonts:true,stopAtErrors:true});
  let pdf;
  try {
    pdf=await task.promise;
    if(pdf.numPages>60)throw Error('Choose a statement with 60 pages or fewer.');
    const pages=[];let length=0;
    for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++) {
      onProgress(`Reading page ${pageNumber} of ${pdf.numPages}…`);
      const page=await pdf.getPage(pageNumber),content=await page.getTextContent();
      const text=textFromItems(content.items);length+=text.length;
      if(length>2000000)throw Error('The statement contains too much text. Upload a shorter billing history.');
      pages.push(text);page.cleanup();
    }
    const text=pages.join('\n');
    if(text.trim().length<40)throw Error('This PDF appears to be a scan without readable text. Use a downloadable text PDF or CSV, or enter the monthly totals below.');
    return text;
  } catch(error) {
    if(error.name==='PasswordException')throw Error('This PDF is password protected. Upload an unlocked copy or enter the monthly totals.');
    if(error.name==='InvalidPDFException')throw Error('This PDF could not be read. Download a new copy or use CSV.');
    throw error;
  } finally { await task.destroy(); }
}
