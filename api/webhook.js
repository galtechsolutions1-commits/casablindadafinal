import express from 'express';

const app = express();
app.use(express.json());

app.post('/api/webhook', async (req, res) => {
  console.log('🔔 Webhook chamado. Headers:', JSON.stringify(req.headers));
  console.log('📦 Body recebido:', JSON.stringify(req.body).substring(0, 500));

  // Validação opcional do secret (não trava se não existir)
  const secret = req.headers['x-kw-secret'] || req.headers['x-kiwify-secret'];
  const configuredSecret = process.env.KIWIFY_WEBHOOK_SECRET;
  if (configuredSecret && secret !== configuredSecret) {
    console.log('❌ Secret inválido. Recebido:', secret, 'Esperado:', configuredSecret);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = req.body;

  // Extrai dados do cliente, produto e valores do payload real da Kiwify
  const customer = payload.Customer || payload.customer || {};
  const product = payload.Product || payload.product || {};
  const order = payload.order || payload.Order || {};

  const nome = customer.full_name || customer.first_name || customer.name || 'Cliente';
  const email = customer.email || '';
  const whatsapp = (customer.mobile || customer.phone || '').replace?.(/\D/g, '') || '';
  const produtoNome = product.product_name || product.name || 'Casa Blindada';

  // Valor da venda: prioriza campos reais do payload Kiwify
  const valor = Number(
    payload.amount ||
    order.amount ||
    order.total ||
    order.order_amount ||
    payload.total ||
    0
  );

  // Comissão: procura em vários lugares, senão calcula 80%
  const comissao = Number(
    payload.commission ||
    order.commission ||
    order.my_commission ||
    payload.Commission ||
    order.Commissions?.my_commission ||
    order.Commissions?.commission ||
    (valor * 0.8)
  );

  console.log(`📦 Venda processada: ${nome}, ${produtoNome}, R$ ${valor}, Comissão R$ ${comissao}`);

  // ======================
  // 1. Registrar no Supabase
  // ======================
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
      if (!supabaseRes.ok) {
        const errText = await supabaseRes.text();
        console.error('❌ Erro Supabase:', errText);
      }
    } catch (err) {
      console.error('❌ Erro ao conectar Supabase:', err.message);
    }
  } else {
    console.warn('⚠️ Supabase não configurado');
  }

  // ======================
  // 2. Enviar WhatsApp via Z-API (se configurado)
  // ======================
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
      console.log('📱 Z-API resposta:', zapiRes.status);
    } catch (err) {
      console.error('❌ Erro Z-API:', err.message);
    }
  }

  // ======================
  // 3. Disparar Pixel Meta (opcional)
  // ======================
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
