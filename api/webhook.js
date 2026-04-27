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

  const nome = customer.full_name || customer.first_name || 'Cliente';
  const email = customer.email || '';
  const whatsapp = (customer.mobile || '').replace(/\D/g, '');
  const produtoNome = product.product_name || 'Casa Blindada';

  // ============================================================
  // EXTRAÇÃO CORRETA DO VALOR PAGO PELO CLIENTE
  // ============================================================
  // A Kiwify envia o valor real da transação em "settlement_amount"
  // que é o valor líquido após descontos. Para o valor bruto pago
  // pelo cliente, usamos "charge_amount" que já considera descontos.
  // Se houver cupom, o "charge_amount" será o valor final pago.
  const valorPago = Number(
    commissions.charge_amount ||   // Valor cobrado do cliente (já com desconto)
    commissions.product_base_price || // Fallback: preço base sem desconto
    payload.charge_amount ||
    payload.amount ||
    0
  );

  // Comissão do produtor (você)
  const minhaComissao = Number(
    commissions.my_commission ||
    commissions.commission ||
    (valorPago * 0.8) // Fallback: 80% do valor pago
  );

  console.log(`📦 Venda: ${nome} | ${produtoNome} | Pago: R$${valorPago} | Comissão: R$${minhaComissao}`);
  console.log(`📱 WhatsApp extraído: "${whatsapp}"`);

  // ============================================================
  // 1. SUPABASE
  // ============================================================
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_ANON_KEY;
  if (supaUrl && supaKey) {
    try {
      const r = await fetch(`${supaUrl}/rest/v1/vendas`, {
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
          data: new Date().toLocaleDateString('pt-BR')
        })
      });
      console.log('✅ Supabase:', r.status);
    } catch(e) {
      console.error('❌ Supabase:', e.message);
    }
  } else {
    console.warn('⚠️ Supabase não configurado');
  }

  // ============================================================
  // 2. Z-API (WHATSAPP)
  // ============================================================
  const zapiInstance = process.env.ZAPI_INSTANCE;
  const zapiToken = process.env.ZAPI_TOKEN;
  const zapiClient = process.env.ZAPI_CLIENT_TOKEN;
  const productLink = process.env.PRODUCT_LINK || '';

  console.log('🔍 Z-API configurada?', {
    instance: zapiInstance ? 'SIM' : 'NÃO',
    token: zapiToken ? 'SIM' : 'NÃO',
    client: zapiClient ? 'SIM' : 'NÃO',
    link: productLink ? 'SIM' : 'NÃO',
    whatsapp: whatsapp || 'NÃO'
  });

  if (whatsapp && zapiInstance && zapiToken && zapiClient) {
    const msg = `🎉 *VENDA CONFIRMADA!*\nOlá ${nome.split(' ')[0]}, seu acesso ao *${produtoNome}* foi liberado!\n\nAcesse aqui: ${productLink}\n\nQualquer dúvida, responda aqui.`;
    try {
      const zapiRes = await fetch(
        `https://api.z-api.io/instances/${zapiInstance}/token/${zapiToken}/send-text`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Client-Token': zapiClient
          },
          body: JSON.stringify({ phone: whatsapp, message: msg })
        }
      );
      const zapiBody = await zapiRes.text();
      console.log('📱 Z-API resposta:', zapiRes.status, zapiBody);
    } catch(e) {
      console.error('❌ Z-API erro:', e.message);
    }
  } else {
    console.warn('⚠️ WhatsApp NÃO enviado. Motivo:');
    if (!whatsapp) console.warn('   - Número do cliente não encontrado no payload');
    if (!zapiInstance) console.warn('   - ZAPI_INSTANCE não configurado');
    if (!zapiToken) console.warn('   - ZAPI_TOKEN não configurado');
    if (!zapiClient) console.warn('   - ZAPI_CLIENT_TOKEN não configurado');
    if (!productLink) console.warn('   - PRODUCT_LINK não configurado');
  }

  res.status(200).json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Webhook rodando na porta ${PORT}`));
