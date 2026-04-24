import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import https from 'https';
import zlib from 'zlib';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pfxBase64, password, nsu, cnpjConsulta } = body;

    if (!pfxBase64 || !password || !nsu) {
      return NextResponse.json({ error: 'Parâmetros ausentes' }, { status: 400 });
    }

    const environmentUrl = 'https://adn.nfse.gov.br/contribuintes';
    const pfxBuffer = Buffer.from(pfxBase64, 'base64');

    const httpsAgent = new https.Agent({
      pfx: pfxBuffer,
      passphrase: password,
      rejectUnauthorized: false
    });

    const apiResponse = await axios.get(`${environmentUrl}/DFe/${nsu}`, {
      httpsAgent,
      params: {
        cnpjConsulta: cnpjConsulta || undefined,
        lote: true
      },
      headers: {
        'Accept': 'application/json'
      }
    });

    const data = apiResponse.data;
    
    // Descompactação Server-Side (mesma lógica do App principal)
    if (data && data.documentos) {
       for (const doc of data.documentos) {
          if (doc.nsu && doc.xmlDFe) {
             try {
                const buffer = Buffer.from(doc.xmlDFe, 'base64');
                const unzipped = zlib.gunzipSync(buffer).toString('utf-8');
                doc.xmlDescompactado = unzipped;
                delete doc.xmlDFe; // Limpa peso na resposta
             } catch(err) {
                console.error("Erro ao descompactar documento", doc.nsu, err);
                doc.xmlDescompactado = null;
             }
          }
       }
    }

    return NextResponse.json(data);

  } catch (error: any) {
    console.error("API Nacional Error:", error.response?.data || error.message);
    const statusCode = error.response?.status || 500;
    const errorMsg = error.response?.data?.message || error.message || 'Falha na comunicação com a API Nacional';
    return NextResponse.json({ error: errorMsg }, { status: statusCode });
  }
}
