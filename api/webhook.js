import express from 'express';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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

    // 1. Registrar venda
    await supabase.from('vendas').insert({
      prod: produtoNome,
      valor: valorPago,
      comissao: minhaComissao,
      evento: eventType,
      data: new Date().toLocaleDateString('pt-BR'),
      created_at: new Date().toISOString()
    });

    // 2. Se venda aprovada, registrar lead
    if (eventType === 'order_approved' || eventType === 'order_paid') {
      await supabase.from('leads').insert({
        nome: nome,
        wpp: whatsapp,
        origem: 'kiwify_automatico',
        status: 'fechado',
        data: new Date().toLocaleDateString('pt-BR'),
        created_at: new Date().toISOString()
      });
    }

    // 3. WhatsApp via Z-API (opcional)
    if (whatsapp && process.env.ZAPI_INSTANCE && process.env.ZAPI_TOKEN) {
      let msg = '';
      if (eventType === 'order_approved' || eventType === 'order_paid') {
        msg = `🎉 *ACESSO LIBERADO!*\\n\\nOlá ${nome.split(' ')[0]}! Seu acesso ao *${produtoNome}* está pronto.\\n\\n👉 ${process.env.PRODUCT_LINK}`;
      } else if (eventType === 'pix_created') {
        msg = `⚠️ *PIX AGUARDANDO*\\n${nome.split(' ')[0]}, pague agora: ${process.env.PRODUCT_LINK}`;
      }
      if (msg) {
        await fetch(`https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Client-Token': process.env.ZAPI_CLIENT_TOKEN || '' },
          body: JSON.stringify({ phone: whatsapp, message: msg })
        });
      }
    }

    res.status(200).json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Webhook rodando na porta ${PORT}`));
