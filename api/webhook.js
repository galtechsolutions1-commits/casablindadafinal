// webhook.js — Render (Express + Supabase SDK)
// Suba no GitHub → conecte no Render → adicione variáveis de ambiente
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(express.json());

// Conexão com Supabase (variáveis de ambiente)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Endpoint de saúde (para testar se o servidor está online)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Webhook principal
app.post('/api/webhook', async (req, res) => {
  try {
    console.log('🔔 Webhook recebido:', JSON.stringify(req.body));
    const payload = req.body;
    const customer = payload.Customer || {};
    const product = payload.Product || {};
    const commissions = payload.Commissions || {};
    const eventType = payload.webhook_event_type || 'order_approved';

    // Dados do cliente
    const nome = customer.full_name || 'Cliente';
    const whatsapp = (customer.mobile || '').replace(/\D/g, '');

    // Dados do produto
    const produtoNome = product.product_name || 'Casa Blindada';
    const valorPago = Number(commissions.charge_amount || 0);
    const minhaComissao = Number(commissions.my_commission || (valorPago * 0.8));

    console.log(`💰 Venda: ${nome} | ${produtoNome} | ${eventType} | R$${valorPago}`);

    // 1. Registrar venda no Supabase
    const { data: venda, error: errVenda } = await supabase
      .from('vendas')
      .insert({
        prod: produtoNome,
        valor: valorPago,
        comissao: minhaComissao,
        evento: eventType,
        data: new Date().toLocaleDateString('pt-BR'),
        created_at: new Date().toISOString()
      })
      .select();

    if (errVenda) {
      console.error('❌ Erro Supabase (vendas):', errVenda.message);
    } else {
      console.log('✅ Venda registrada no Supabase');
    }

    // 2. Se for venda aprovada, registrar lead automaticamente
    if (eventType === 'order_approved' || eventType === 'order_paid') {
      const { error: errLead } = await supabase
        .from('leads')
        .insert({
          nome: nome,
          wpp: whatsapp,
          origem: 'kiwify_automatico',
          status: 'fechado',
          data: new Date().toLocaleDateString('pt-BR'),
          created_at: new Date().toISOString()
        });

      if (errLead) {
        console.error('❌ Erro Supabase (leads):', errLead.message);
      } else {
        console.log('✅ Lead registrado automaticamente');
      }
    }

    // 3. Enviar WhatsApp via Z-API (se configurada)
    const zapiInstance = process.env.ZAPI_INSTANCE;
    const zapiToken = process.env.ZAPI_TOKEN;
    const zapiClient = process.env.ZAPI_CLIENT_TOKEN;
    const productLink = process.env.PRODUCT_LINK || '';

    if (whatsapp && zapiInstance && zapiToken) {
      let mensagem = '';

      if (eventType === 'order_approved' || eventType === 'order_paid') {
        mensagem = `🎉 *ACESSO LIBERADO!*\n\nOlá ${nome.split(' ')[0]}! Seu acesso ao *${produtoNome}* está pronto.\n\n👉 Acesse aqui: ${productLink}\n\nQualquer dúvida, me chama aqui. 👊`;
      } else if (eventType === 'pix_created' || eventType === 'waiting_payment') {
        mensagem = `⚠️ *PIX GERADO*\n\n${nome.split(' ')[0]}, seu PIX para o *${produtoNome}* está esperando.\n\nPague agora para liberar seu acesso: ${productLink}`;
      } else if (eventType === 'order_refunded') {
        mensagem = `ℹ️ *REEMBOLSO PROCESSADO*\n\n${nome.split(' ')[0]}, o reembolso do *${produtoNome}* foi realizado. Se foi engano ou quer tentar novamente, aqui está o link: ${productLink}`;
      }

      if (mensagem) {
        try {
          const url = `https://api.z-api.io/instances/${zapiInstance}/token/${zapiToken}/send-text`;
          const zapiRes = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Client-Token': zapiClient
            },
            body: JSON.stringify({
              phone: whatsapp,
              message: mensagem
            })
          });

          const zapiData = await zapiRes.json();
          if (zapiRes.ok) {
            console.log('📱 WhatsApp enviado com sucesso');
          } else {
            console.error('❌ Z-API:', zapiData);
          }
        } catch (err) {
          console.error('❌ Erro Z-API:', err.message);
        }
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('💥 Erro interno:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook rodando na porta ${PORT}`);
});
