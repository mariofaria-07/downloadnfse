'use client';
import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import JSZip from 'jszip';
import { Download, Loader2, Play, StopCircle, FileKey, AlertCircle, CheckCircle2, ShieldCheck, Database, XCircle } from 'lucide-react';

interface ExtractedInvoice {
  nsu: string;
  xml: string;
  number: string;
  value: number;
  issueDate: string;
  providerName: string;
  isCancelled: boolean;
  retentions: number;
}

export default function NfseCrawler() {
  const [pfxFile, setPfxFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [startNsu, setStartNsu] = useState('');
  
  const [isCrawling, setIsCrawling] = useState(false);
  const [currentNsu, setCurrentNsu] = useState('');
  const [invoices, setInvoices] = useState<ExtractedInvoice[]>([]);
  const [errorLog, setErrorLog] = useState('');
  
  // Crawler Ref for stopping loop
  const stopRef = useRef(false);

  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const kpis = {
    totalValue: invoices.filter(i => !i.isCancelled).reduce((acc, curr) => acc + curr.value, 0),
    totalNotes: invoices.length,
    cancelled: invoices.filter(i => i.isCancelled).length,
    withRetentions: invoices.filter(i => i.retentions > 0 && !i.isCancelled).length
  };

  const handleStart = async () => {
    if (!pfxFile || !password || !cnpj || !startNsu) {
       setErrorLog('Por favor, preencha todos os campos do certificado e busca.');
       return;
    }
    
    setErrorLog('');
    setIsCrawling(true);
    stopRef.current = false;
    let loopNsu = startNsu;

    const reader = new FileReader();
    reader.readAsDataURL(pfxFile);
    reader.onload = async () => {
      const base64Pfx = (reader.result as string).split(',')[1];
      
      while (!stopRef.current) {
        setCurrentNsu(loopNsu);
        try {
          const res = await axios.post('/api/nacional', {
            pfxBase64: base64Pfx,
            password,
            nsu: loopNsu,
            cnpjConsulta: cnpj
          });
          
          const data = res.data;
          
          if (!data || !data.documentos || data.documentos.length === 0) {
             setErrorLog(`Fim da fila alcançado no NSU ${loopNsu} ou nenhum documento retornado.`);
             break;
          }

          const parsedDocs: ExtractedInvoice[] = [];
          
          for (const doc of data.documentos) {
            if (doc.xmlDescompactado) {
              const parser = new DOMParser();
              const xmlDoc = parser.parseFromString(doc.xmlDescompactado, "application/xml");
              
              const numTag = xmlDoc.getElementsByTagName("Numero")[0] || xmlDoc.getElementsByTagName("NumeroNfse")[0];
              const valTag = xmlDoc.getElementsByTagName("ValorServicos")[0] || xmlDoc.getElementsByTagName("vServ")[0];
              const dateTag = xmlDoc.getElementsByTagName("DataEmissao")[0] || xmlDoc.getElementsByTagName("dhEmi")[0];
              
              let providerTag = xmlDoc.getElementsByTagName("Prestador")[0] || xmlDoc.getElementsByTagName("PrestadorServico")[0];
              let providerName = 'Desconhecido';
              if (providerTag) {
                 const nameTag = providerTag.getElementsByTagName("RazaoSocial")[0] || providerTag.getElementsByTagName("xNome")[0];
                 providerName = nameTag ? nameTag.textContent || 'Desconhecido' : 'Desconhecido';
              }
              
              const isCancelada = xmlDoc.getElementsByTagName("PedidoCancelamento").length > 0 || xmlDoc.getElementsByTagName("Cancelamento").length > 0;
              const retentionsTag = xmlDoc.getElementsByTagName("vTotalRet")[0];
              
              parsedDocs.push({
                 nsu: doc.nsu,
                 xml: doc.xmlDescompactado,
                 number: numTag ? numTag.textContent || 'S/N' : 'S/N',
                 value: valTag ? parseFloat((valTag.textContent || '0').replace(/,/g, '.')) : 0,
                 issueDate: dateTag ? dateTag.textContent || '' : '',
                 providerName,
                 isCancelled: isCancelada,
                 retentions: retentionsTag ? parseFloat((retentionsTag.textContent || '0').replace(/,/g, '.')) : 0
              });
            }
          }
          
          
          // Eliminar notas duplicadas baseadas no NSU para nao confundir o React
          setInvoices(prev => {
             const novaLista = [...prev, ...parsedDocs];
             const uniqueInvoices = Array.from(new Map(novaLista.map(item => [item.nsu, item])).values());
             return uniqueInvoices;
          });
          
          loopNsu = data.ultNSU || (parseInt(loopNsu) + 50).toString();
          
          // Wait 1.5s to prevent hammering SEFAZ
          await new Promise(r => setTimeout(r, 1500));
          
        } catch(err: any) {
          console.error(err);
          setErrorLog(`Falha no NSU ${loopNsu}: ${err.response?.data?.error || err.message}`);
          break;
        }
      }
      setIsCrawling(false);
    };
  };

  const stopCrawler = () => {
     stopRef.current = true;
     setIsCrawling(false);
  };

  const handleDownloadZip = async () => {
     const zip = new JSZip();
     invoices.forEach(inv => {
        const status = inv.isCancelled ? 'CANCELADA_' : '';
        zip.file(`Nota_${inv.number}_${status}NSU_${inv.nsu}.xml`, inv.xml);
     });
     const blob = await zip.generateAsync({ type: 'blob' });
     const link = document.createElement('a');
     link.href = URL.createObjectURL(blob);
     link.download = `Lote_NFSe_${cnpj}.zip`;
     link.click();
  };

  if (!isMounted) return null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
           <div>
             <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Database className="text-blue-600"/> NFSe Nacional Downloader</h1>
             <p className="text-slate-500 mt-1">Busca contínua, análise instantânea e extração de lote.</p>
           </div>
           {invoices.length > 0 && (
             <button onClick={handleDownloadZip} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-xl shadow-md font-medium flex items-center gap-2 transition-all">
               <Download className="w-5 h-5"/> Baixar Lote ZIP ({invoices.length})
             </button>
           )}
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Controls Sidebar */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
             <h2 className="text-lg font-bold flex items-center gap-2 border-b pb-4"><ShieldCheck className="text-slate-400"/> Credenciais & Busca</h2>
             
             <div className="space-y-4">
               <div>
                 <label className="text-xs font-semibold text-slate-500 uppercase">Certificado A1 (.pfx)</label>
                 <input type="file" accept=".pfx" onChange={(e) => setPfxFile(e.target.files?.[0] || null)} className="w-full mt-1 border border-slate-300 rounded-lg p-2 text-sm"/>
               </div>
               <div>
                 <label className="text-xs font-semibold text-slate-500 uppercase">Senha</label>
                 <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full mt-1 border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500"/>
               </div>
               <div>
                 <label className="text-xs font-semibold text-slate-500 uppercase">CNPJ (Apenas números)</label>
                 <input type="text" value={cnpj} onChange={(e) => setCnpj(e.target.value)} className="w-full mt-1 border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500"/>
               </div>
               <div>
                 <label className="text-xs font-semibold text-slate-500 uppercase">NSU Inicial</label>
                 <input type="number" value={startNsu} onChange={(e) => setStartNsu(e.target.value)} className="w-full mt-1 border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500" placeholder="Ex: 0"/>
               </div>
             </div>

             {errorLog && (
               <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm border border-red-200 break-words">
                 {errorLog}
               </div>
             )}

             <button 
               onClick={isCrawling ? stopCrawler : handleStart} 
               className={`w-full py-3 rounded-xl shadow-md font-bold flex items-center justify-center gap-2 ${isCrawling ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
             >
               {isCrawling ? (
                 <>
                   <StopCircle className="animate-pulse w-5 h-5"/> 
                   <span>Parar Busca... (NSU: {currentNsu})</span>
                 </>
               ) : (
                 <>
                   <Play className="w-5 h-5"/> 
                   <span>Iniciar Crawler</span>
                 </>
               )}
             </button>
          </div>

          {/* Main Dashboard */}
          <div className="col-span-1 lg:col-span-2 space-y-8">
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
               <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-blue-500">
                  <p className="text-xs text-slate-500 font-semibold uppercase">Total Baixadas</p>
                  <p className="text-2xl font-bold text-slate-800">{kpis.totalNotes}</p>
               </div>
               <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-emerald-500">
                  <p className="text-xs text-slate-500 font-semibold uppercase">Valor Total Bruto</p>
                  <p className="text-2xl font-bold text-slate-800">R$ {kpis.totalValue.toLocaleString('pt-BR', {minimumFractionDigits:2})}</p>
               </div>
               <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-rose-500">
                  <p className="text-xs text-slate-500 font-semibold uppercase">Canceladas</p>
                  <p className="text-2xl font-bold text-slate-800">{kpis.cancelled}</p>
               </div>
               <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-amber-500">
                  <p className="text-xs text-slate-500 font-semibold uppercase">Com Retenções</p>
                  <p className="text-2xl font-bold text-slate-800">{kpis.withRetentions}</p>
               </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
               <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                 <h3 className="font-bold text-slate-700 flex items-center gap-2">
                   <FileKey className="w-4 h-4 text-slate-400"/> Monitor ao Vivo
                   {isCrawling && <Loader2 className="w-4 h-4 animate-spin text-blue-600"/>}
                 </h3>
               </div>
               <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                 <table className="w-full text-left text-sm whitespace-nowrap">
                   <thead className="bg-slate-50 text-slate-600 sticky top-0 border-b border-slate-200">
                     <tr>
                       <th className="p-4 font-semibold">Status</th>
                       <th className="p-4 font-semibold">NSU</th>
                       <th className="p-4 font-semibold">Nota</th>
                       <th className="p-4 font-semibold">Fornecedor</th>
                       <th className="p-4 font-semibold">Emissão</th>
                       <th className="p-4 font-semibold text-right">Valor</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-100">
                     {invoices.length === 0 ? (
                        <tr><td colSpan={6} className="p-12 text-center text-slate-400">Nenhum documento baixado ainda...</td></tr>
                     ) : (
                        [...invoices].reverse().map((inv) => (
                           <tr key={`row-${inv.nsu}`} className="hover:bg-slate-50">
                             <td className="p-4">
                                {inv.isCancelled ? (
                                   <span className="bg-red-100 text-red-800 text-[10px] px-2 py-1 rounded-full font-bold flex w-max items-center gap-1"><XCircle className="w-3 h-3"/> CANCELADA</span>
                                ) : (
                                   <span className="bg-green-100 text-green-800 text-[10px] px-2 py-1 rounded-full font-bold flex w-max items-center gap-1"><CheckCircle2 className="w-3 h-3"/> VÁLIDA</span>
                                )}
                             </td>
                             <td className="p-4 font-mono text-xs text-slate-500"><span>{inv.nsu}</span></td>
                             <td className="p-4 font-medium"><span>{inv.number}</span></td>
                             <td className="p-4 truncate max-w-[200px]" title={inv.providerName}><span>{inv.providerName}</span></td>
                             <td className="p-4"><span>{inv.issueDate ? inv.issueDate.substring(0,10).split('-').reverse().join('/') : ''}</span></td>
                             <td className="p-4 text-right font-semibold"><span>R$ {inv.value.toFixed(2)}</span></td>
                           </tr>
                        ))
                     )}
                   </tbody>
                 </table>
               </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
