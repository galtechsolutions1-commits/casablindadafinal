import express from 'express';
const app = express();
app.use(express.json());

app.post('/api/webhook', async (req, res) => {
  console.log('Webhook recebido:', JSON.stringify(req.body).substring(0, 200));
  const b = req.body;
  const customer = b.Customer || {};
  const product = b.Product || {};
  const commissions = b.Commissions || {};
  const eventType = b.webhook_event_type || 'order_approved';
  const nome = customer.full_name || 'Cliente';
  const wpp = (customer.mobile || '').replace(/\D/g, '');
  const prodNome = product.product_name || 'Casa Blindada';
  const valor = Number(commissions.charge_amount || 0);
  const comissao = Number(commissions.my_commission || (valor * 0.8));

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
          prod: prodNome, valor, comissao,
          evento: eventType,
          data: new Date().toLocaleDateString('pt-BR')
        })
      });
      console.log('Supabase:', r.status);
    } catch(e) { console.error('Supabase:', e.message); }
  }

  res.status(200).json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Webhook rodando na porta ${PORT}`));
