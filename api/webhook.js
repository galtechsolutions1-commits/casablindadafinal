export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const secret = req.headers['x-kw-secret'];
  if (secret !== process.env.KIWIFY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { event, data } = req.body;

  if (event !== 'sale.approved') {
    return res.status(200).json({ received: true });
  }

  try {
    const { customer, transaction, product } = data;
    const nome = customer?.full_name || 'Cliente';
    const whatsapp = customer?.mobile || '';
    const valor = transaction?.amount || 0;
    const produto = product?.name || 'Casa Blindada';
    const comissao = valor * 0.8;

    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/vendas`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ prod: produto, valor, comissao, data: new Date().toLocaleDateString('pt-BR') })
      }).catch(() => {});
    }

    if (whatsapp && process.env.ZAPI_INSTANCE && process.env.ZAPI_TOKEN) {
      await fetch(`https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Client-Token': process.env.ZAPI_CLIENT_TOKEN || '' },
        body: JSON.stringify({ phone: whatsapp.replace(/\D/g, ''), message: `Venda confirmada! Acesse: ${process.env.PRODUCT_LINK}` })
      }).catch(() => {});
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Internal error' });
  }
}
