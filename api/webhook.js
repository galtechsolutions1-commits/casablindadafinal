import express from 'express';

const app = express();
app.use(express.json());

app.post('/api/webhook', async (req, res) => {
  console.log('🔔 Webhook chamado. Headers:', JSON.stringify(req.headers));
  // Exibe o JSON completo para diagnóstico
  console.log('📦 Body recebido COMPLETO:', JSON.stringify(req.body));

  const secret = req.headers['x-kw-secret'] || req.headers['x-kiwify-secret'];
  const configuredSecret = process.env.KIWIFY_WEBHOOK_SECRET;
  if (configuredSecret && secret !== configuredSecret) {
    console.log('❌ Secret inválido');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = req.body;
  const customer = payload.Customer || payload.customer || {};
  const product = payload.Product || payload.product || {};
  const order = payload.order || payload.Order || {};

  const nome = customer.full_name || customer.first_name || customer.name || 'Cliente';
  const email = customer.email || '';
  const whatsapp = (customer.mobile || customer.phone || '').replace?.(/\D/g, '') || '';
  const produtoNome = product.product_name || product.name || 'Casa Blindada';

  // Extrai o valor real da venda de várias possibilidades
  let valor = Number(
    payload.amount ||
    payload.total ||
    payload.order_amount ||
    order.amount ||
    order.total ||
    order.order_amount ||
    payload.price ||
    order.price ||
    0
  );

  // Se ainda estiver zero, procura em subobjetos conhecidos da Kiwify
  if (valor === 0) {
    valor = Number(
      payload.Commissions?.product_base_price ||
      payload.commissions?.product_base_price ||
      payload.Commission?.product_base_price ||
      payload.Order?.amount ||
      payload.Order?.total ||
      0
    );
  }

  // Comissão
  let comissao = Number(
    payload.commission ||
    order.commission ||
    payload.Commissions?.my_commission ||
    order.Commissions?.my_commission ||
    payload.Commission?.my_commission ||
    0
  );

  // Se a comissão ainda for zero, calcula 80% do valor
  if (comissao === 0 && valor > 0) {
    comissao = valor * 0.8;
  }

  console.log(`📦 Venda processada: ${nome}, ${produtoNome}, R$ ${valor}, Comissão R$ ${comissao}`);

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
      console.log('✅ Supabase resposta:', supabaseRes.status);
    } catch (err) {
      console.error('❌ Erro Supabase:', err.message);
    }
  } else {
    console.warn('⚠️ Supabase não configurado');
  }

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
        body: JSON.stringify({ phone: whatsapp, message: msg })
      });
      console.log('📱 Z-API resposta:', zapiRes.status);
    } catch (err) {
      console.error('❌ Erro Z-API:', err.message);
    }
  }

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
      console.log('🎯 Pixel resposta:', pixelRes.status);
    } catch (err) {
      console.error('❌ Erro Pixel:', err.message);
    }
  }

  res.status(200).json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Webhook rodando na porta ${PORT}`));
