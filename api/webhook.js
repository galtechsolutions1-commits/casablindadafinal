// api/webhook.js
import express from 'express';

const app = express();
app.use(express.json());

app.post('/api/webhook', async (req, res) => {
  console.log("🔔 Webhook chamado. Method:", req.method);

  const secret = req.headers['x-kw-secret'];
  console.log("Secret recebido:", secret);
  if (secret !== process.env.KIWIFY_WEBHOOK_SECRET) {
    console.log("❌ Secret inválido");
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = req.body;
  console.log("Evento recebido:", payload.webhook_event_type);

  if (payload.webhook_event_type !== 'order_approved' && payload.webhook_event_type !== 'order_paid') {
    console.log("ℹ️ Evento ignorado:", payload.webhook_event_type);
    return res.status(200).json({ received: true });
  }

  const order = payload.order;
  if (!order) {
    console.log("❌ Nenhum pedido encontrado no payload");
    return res.status(200).json({ received: true, error: 'no_order' });
  }

  const customer = order.Customer || {};
  const nome = customer.full_name || customer.first_name || 'Cliente';
  const email = customer.email;
  const whatsapp = customer.mobile ? customer.mobile.replace(/\D/g, '') : '';

  const product = order.Product || {};
  const produtoNome = product.product_name || 'Casa Blindada';

  const commissions = order.Commissions || {};
  const valor = commissions.product_base_price || commissions.charge_amount || 0;
  const comissao = commissions.my_commission || (valor * 0.8);

  console.log(`📦 Venda recebida: ${nome}, ${produtoNome}, R$ ${valor}, Comissão R$ ${comissao}`);

  // Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) {
    try {
      const supabaseRes = await fetch(`${supabaseUrl}/rest/v1/vendas`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          prod: produtoNome,
          valor: valor,
          comissao: comissao,
          data: new Date().toLocaleDateString('pt-BR'),
          created_at: new Date().toISOString()
        })
      });
      console.log("✅ Supabase resposta:", supabaseRes.status);
    } catch (err) {
      console.error("❌ Erro Supabase:", err.message);
    }
  } else {
    console.warn("⚠️ Supabase não configurado");
  }

  // Z-API
  const zapiInstance = process.env.ZAPI_INSTANCE;
  const zapiToken = process.env.ZAPI_TOKEN;
  const zapiClientToken = process.env.ZAPI_CLIENT_TOKEN;
  const productLink = process.env.PRODUCT_LINK || 'https://pay.kiwify.com.br/...';

  if (whatsapp && zapiInstance && zapiToken) {
    const msg = `🎉 *VENDA CONFIRMADA!*\nOlá ${nome.split(' ')[0]}, seu acesso ao *${produtoNome}* foi liberado!\n\nAcesse aqui: ${productLink}\n\nQualquer dúvida, responda aqui. Obrigado!`;
    try {
      const zapiRes = await fetch(`https://api.z-api.io/instances/${zapiInstance}/token/${zapiToken}/send-text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Client-Token': zapiClientToken || ''
        },
        body: JSON.stringify({
          phone: whatsapp,
          message: msg
        })
      });
      console.log("📱 Z-API resposta:", zapiRes.status);
    } catch (err) {
      console.error("❌ Erro Z-API:", err.message);
    }
  }

  // Pixel Meta
  const pixelId = process.env.META_PIXEL_ID;
  const pixelAccessToken = process.env.PIXEL_ACCESS_TOKEN;
  if (pixelId && pixelAccessToken && email) {
    try {
      const pixelRes = await fetch(`https://graph.facebook.com/v19.0/${pixelId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: [{
            event_name: 'Purchase',
            event_time: Math.floor(Date.now() / 1000),
            action_source: 'website',
            user_data: { em: [email], ph: [whatsapp] },
            custom_data: { currency: 'BRL', value: valor }
          }],
          access_token: pixelAccessToken
        })
      });
      console.log("🎯 Pixel resposta:", pixelRes.status);
    } catch (err) {
      console.error("❌ Erro Pixel:", err.message);
    }
  }

  res.status(200).json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Webhook rodando na porta ${PORT}`));
