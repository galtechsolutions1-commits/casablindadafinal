// api/webhook.js - Substitua no GitHub
import express from 'express';

const app = express();
app.use(express.json());

app.post('/api/webhook', async (req, res) => {
  console.log('🔔 Webhook chamado');
  console.log('📦 Body completo:', JSON.stringify(req.body));

  const payload = req.body;
  const customer = payload.Customer || {};
  const product = payload.Product || {};
  const commissions = payload.Commissions || {};
  const order = payload.order || payload.Order || {};

  const nome = customer.full_name || customer.first_name || 'Cliente';
  const email = customer.email || '';
  const whatsapp = (customer.mobile || '').replace(/\D/g, '');
  const produtoNome = product.product_name || 'Casa Blindada';

  // Detecta o tipo de evento
  const eventType = payload.webhook_event_type || 'unknown';
  
  // Valor pago (considera order bump e upsell)
  let valorPago = Number(commissions.charge_amount || 0);
  
  // Se for um bump, o valor pode estar em outro lugar
  if (eventType === 'order_bump' || payload.order_bump) {
    valorPago = Number(payload.order_bump?.charge_amount || 0);
    console.log('📦 Bump detectado!');
  }

  const minhaComissao = Number(commissions.my_commission || (valorPago * 0.8));

  console.log(`💰 Venda: ${nome} | ${produtoNome} | Tipo: ${eventType} | Pago: R$${valorPago} | Comissão: R$${minhaComissao}`);

  // 1. Supabase
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_ANON_KEY;
  if (supaUrl && supaKey) {
    try {
      await fetch(`${supaUrl}/rest/v1/vendas`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supaKey,
          'Authorization': `Bearer ${supaKey}`
        },
        body: JSON.stringify({
          prod: produtoNome,
          valor: valorPago,
          comissao: minhaComissao,
          data: new Date().toLocaleDateString('pt-BR'),
          evento: eventType,
          created_at: new Date().toISOString()
        })
      });
      console.log('✅ Venda registrada no Supabase');
    } catch(e) {
      console.error('❌ Erro Supabase:', e.message);
    }
  }

  // 2. Z-API (WhatsApp)
  const zapiInstance = process.env.ZAPI_INSTANCE;
  const zapiToken = process.env.ZAPI_TOKEN;
  const zapiClient = process.env.ZAPI_CLIENT_TOKEN;
  const productLink = process.env.PRODUCT_LINK || '';

  if (whatsapp && zapiInstance && zapiToken && zapiClient) {
    let msg = '';
    
    if (eventType === 'order_approved' || eventType === 'order_paid') {
      msg = `🎉 *VENDA CONFIRMADA!*\nOlá ${nome.split(' ')[0]}, seu acesso ao *${produtoNome}* foi liberado!\n\nAcesse aqui: ${productLink}\n\nQualquer dúvida, responda aqui.`;
    } else if (eventType === 'pix_created' || eventType === 'waiting_payment') {
      msg = `⚠️ *PIX GERADO!*\n${nome.split(' ')[0]}, seu PIX para o *${produtoNome}* está esperando.\n\nPague agora para liberar o acesso imediato: ${productLink}\n\nSe precisar de ajuda, responda aqui.`;
    } else if (eventType === 'order_refunded') {
      msg = `ℹ️ *REEMBOLSO PROCESSADO*\n${nome.split(' ')[0]}, o reembolso do *${produtoNome}* foi realizado.\n\nSe foi um engano ou quer tentar novamente, aqui está o link: ${productLink}`;
    }

    if (msg) {
      try {
        await fetch(`https://api.z-api.io/instances/${zapiInstance}/token/${zapiToken}/send-text`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Client-Token': zapiClient
          },
          body: JSON.stringify({ phone: whatsapp, message: msg })
        });
        console.log('📱 WhatsApp enviado');
      } catch(e) {
        console.error('❌ Erro Z-API:', e.message);
      }
    }
  }

  res.status(200).json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Webhook rodando na porta ${PORT}`));
