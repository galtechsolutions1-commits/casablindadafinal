import express from 'express';
import cors from 'cors'; // 👈 novo

const app = express();
app.use(express.json());
app.use(cors()); // 👈 libera acesso do painel HTML

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE;
const ZAPI_TOKEN = process.env.ZAPI_TOKEN;
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN || '';
const PRODUCT_LINK = process.env.PRODUCT_LINK || '';

async function insertInto(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/webhook', async (req, res) => {
  try {
    const payload = req.body;
    const customer = payload.Customer || {};
    const product = payload.Product || {};
    const commissions = payload.Commissions || {};
    const eventType = payload.webhook_event_type || 'order_approved';

    const nome = customer.full_name || 'Cliente';
    const whatsapp = (customer.mobile || '').replace(/\D/g, '');
    const produtoNome = product.product_name || 'Casa Blindada';
    const valorPago = Number(commissions.charge_amount || 0);
    const minhaComissao = Number(commissions.my_commission || (valorPago * 0.8));

    console.log(`💰 Venda: ${nome} | ${produtoNome} | ${eventType} | R$${valorPago}`);

    await insertInto('vendas', {
      prod: produtoNome,
      valor: valorPago,
      comissao: minhaComissao,
      evento: eventType,
      data: new Date().toLocaleDateString('pt-BR'),
      created_at: new Date().toISOString()
    });

    if (eventType === 'order_approved' || eventType === 'order_paid') {
      await insertInto('leads', {
        nome: nome,
        wpp: whatsapp,
        origem: 'kiwify_automatico',
        status: 'fechado',
        data: new Date().toLocaleDateString('pt-BR'),
        created_at: new Date().toISOString()
      });
    }

    if (whatsapp && ZAPI_INSTANCE && ZAPI_TOKEN) {
      let mensagem = '';
      if (eventType === 'order_approved' || eventType === 'order_paid') {
        mensagem = `🎉 *ACESSO LIBERADO!*\n\nOlá ${nome.split(' ')[0]}! Seu acesso ao *${produtoNome}* está pronto.\n\n👉 ${PRODUCT_LINK}\n\nQualquer dúvida, me chama aqui. 👊`;
      } else if (eventType === 'pix_created' || eventType === 'waiting_payment') {
        mensagem = `⚠️ *PIX GERADO*\n\n${nome.split(' ')[0]}, seu PIX para o *${produtoNome}* está esperando.\n\nPague agora: ${PRODUCT_LINK}`;
      } else if (eventType === 'order_refunded') {
        mensagem = `ℹ️ *REEMBOLSO PROCESSADO*\n\n${nome.split(' ')[0]}, o reembolso foi realizado. Se quiser tentar novamente: ${PRODUCT_LINK}`;
      }

      if (mensagem) {
        await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Client-Token': ZAPI_CLIENT_TOKEN
          },
          body: JSON.stringify({ phone: whatsapp, message: mensagem })
        }).catch(e => console.error('Z-API:', e.message));
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Webhook rodando na porta ${PORT}`));
