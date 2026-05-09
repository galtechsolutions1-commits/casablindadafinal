// ============================================================
// CASA BLINDADA — Webhook Vercel (api/webhook.js)
// ============================================================
// ⚠️  DIFERENÇA CRÍTICA VERCEL vs RENDER:
//     Render → Express + app.listen(PORT) ✅
//     Vercel → export default function handler(req, res) ✅
//     Vercel com app.listen → 404 SEMPRE ❌
// ============================================================
// VARIÁVEIS DE AMBIENTE (Vercel → Settings → Environment Variables):
//   SUPABASE_URL          https://xxxx.supabase.co
//   SUPABASE_ANON_KEY     eyJhbGci...
//   ZAPI_INSTANCE         sua_instance_id
//   ZAPI_TOKEN            seu_token
//   ZAPI_CLIENT_TOKEN     seu_client_token
//   PRODUCT_LINK          https://pay.kiwify.com.br/apf5ky6
//   WPP_DONO              5519983152150
//   APP_SECRET            casablindada2026
//   KIWIFY_WEBHOOK_SECRET (opcional — para validar assinatura)
// ============================================================

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ── Health Check ─────────────────────────────────────────
  if (req.method === 'GET' || req.query.type === 'health') {
    return res.status(200).json({
      status: 'online',
      service: 'Casa Blindada Webhook',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      env: {
        supabase: !!process.env.SUPABASE_URL,
        zapi: !!process.env.ZAPI_INSTANCE,
        product_link: !!process.env.PRODUCT_LINK
      }
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const tipo = req.query.type || 'kiwify';

  // ── Rota: Simulador de Venda (para testar sem compra real) ─
  if (tipo === 'simulate') {
    const secret = req.headers['x-app-secret'];
    if (secret !== (process.env.APP_SECRET || 'casablindada2026')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const payload = {
      Customer: {
        full_name: body.nome || 'Lead Teste',
        email: body.email || 'teste@email.com',
        mobile: body.wpp || process.env.WPP_DONO || '5519983152150'
      },
      Product: { product_name: 'Casa Blindada — E-book' },
      Commissions: {
        charge_amount: body.valor || 19.90,
        my_commission: (body.valor || 19.90) * 0.80
      },
      webhook_event_type: 'order_approved'
    };

    // Processa como venda real
    const resultado = await processarVenda(payload);
    return res.status(200).json({ ok: true, simulacao: true, resultado });
  }

  // ── Rota: Webhook Kiwify (venda real) ─────────────────────
  if (tipo === 'kiwify' || !tipo) {
    try {
      const evento = body.webhook_event_type || body.status || 'unknown';
      console.log(`[KIWIFY] Evento: ${evento}`);
      console.log(`[KIWIFY] Body: ${JSON.stringify(body).slice(0, 500)}`);

      // Eventos que geram ação
      const eventosAtivos = ['order_approved', 'order_paid', 'paid', 'pix_created', 'waiting_payment', 'order_refunded', 'order_bump'];

      if (!eventosAtivos.includes(evento)) {
        console.log(`[KIWIFY] Evento ignorado: ${evento}`);
        return res.status(200).json({ ok: true, skip: evento });
      }

      const resultado = await processarVenda(body);
      return res.status(200).json({ ok: true, resultado });

    } catch (err) {
      console.error('[KIWIFY] Erro:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Rota: Registrar Lead (Manychat → n8n → aqui) ──────────
  if (tipo === 'lead') {
    const secret = req.headers['x-app-secret'];
    if (secret !== (process.env.APP_SECRET || 'casablindada2026')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { nome, wpp, origem, status } = body;
    if (!nome) return res.status(400).json({ error: 'nome obrigatório' });

    try {
      await supabaseInsert('leads', {
        nome,
        wpp: (wpp || '').replace(/\D/g, ''),
        origem: origem || 'Manychat',
        status: status || 'morno',
        data: new Date().toLocaleDateString('pt-BR'),
        created_at: new Date().toISOString()
      });

      // Notifica dono
      const wppDono = process.env.WPP_DONO;
      if (wppDono) {
        await zapiEnviar(wppDono, `🎯 Novo lead: ${nome}\n📱 ${wpp || '—'}\n📍 ${origem || 'Manychat'}\n⏱ ${new Date().toLocaleTimeString('pt-BR')}`);
      }

      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: 'type inválido. Use: kiwify, lead, simulate, health' });
}

// ── Processar Venda ─────────────────────────────────────────
async function processarVenda(payload) {
  const customer   = payload.Customer || {};
  const product    = payload.Product || {};
  const commission = payload.Commissions || {};
  const evento     = payload.webhook_event_type || payload.status || 'order_approved';

  const nome   = customer.full_name || customer.first_name || 'Cliente';
  const email  = customer.email || '';
  const wpp    = (customer.mobile || '').replace(/\D/g, '');
  const prod   = product.product_name || 'Casa Blindada — E-book';
  const link   = process.env.PRODUCT_LINK || 'https://pay.kiwify.com.br/apf5ky6';
  const dono   = process.env.WPP_DONO || '5519983152150';

  // Extração robusta do valor
  const valor = Number(
    commission.charge_amount ||
    commission.product_base_price ||
    payload.charge_amount ||
    payload.amount ||
    19.90
  );
  const comissao = Number(
    commission.my_commission ||
    (valor * 0.80)
  );

  console.log(`[VENDA] ${nome} | ${prod} | R$${valor} | Comissão: R$${comissao} | Evento: ${evento}`);

  const resultado = { nome, prod, valor, comissao, evento, wpp: wpp ? 'ok' : 'ausente' };

  // 1. Salvar no Supabase ─────────────────────────────────
  try {
    await supabaseInsert('vendas', {
      prod,
      valor,
      comissao,
      evento,
      data: new Date().toLocaleDateString('pt-BR'),
      created_at: new Date().toISOString()
    });
    resultado.supabase = 'ok';
    console.log('[SUPABASE] Venda registrada');
  } catch (e) {
    resultado.supabase = `erro: ${e.message}`;
    console.error('[SUPABASE]', e.message);
  }

  // 2. WhatsApp para o COMPRADOR ──────────────────────────
  if (wpp) {
    let msg = '';

    if (evento === 'order_approved' || evento === 'order_paid' || evento === 'paid') {
      msg = `🎉 *Acesso liberado, ${nome.split(' ')[0]}!*\n\n`
          + `Seu e-book *${prod}* está pronto para você! 📖\n\n`
          + `👉 Acesse aqui: ${link}\n\n`
          + `Qualquer dúvida, responda aqui mesmo. Bom estudo! 🏠🔒`;

    } else if (evento === 'pix_created' || evento === 'waiting_payment') {
      msg = `⏳ *PIX aguardando, ${nome.split(' ')[0]}!*\n\n`
          + `Seu pagamento do *${prod}* está esperando confirmação.\n\n`
          + `Pague agora para liberar o acesso imediato:\n`
          + `👉 ${link}\n\n`
          + `Dúvidas? Me chama aqui!`;

    } else if (evento === 'order_refunded') {
      msg = `ℹ️ ${nome.split(' ')[0]}, seu reembolso foi processado.\n\n`
          + `Se foi um engano ou quiser tentar novamente:\n`
          + `👉 ${link}`;

    } else if (evento === 'order_bump') {
      msg = `✅ *Order Bump confirmado, ${nome.split(' ')[0]}!*\n\n`
          + `Seu material extra foi adicionado ao acesso.\n`
          + `👉 Acesse tudo aqui: ${link}`;
    }

    if (msg) {
      const zapiOk = await zapiEnviar(wpp, msg);
      resultado.zapi_comprador = zapiOk ? 'ok' : 'erro';
    }
  } else {
    resultado.zapi_comprador = 'sem_numero';
  }

  // 3. Notificar DONO ─────────────────────────────────────
  if (dono) {
    const emoji = evento.includes('refund') ? '↩️' : '🔥';
    const msgDono = `${emoji} *VENDA CASA BLINDADA*\n\n`
                  + `👤 ${nome}\n`
                  + `📦 ${prod}\n`
                  + `💰 R$${valor.toFixed(2)} → Comissão: R$${comissao.toFixed(2)}\n`
                  + `📅 ${new Date().toLocaleString('pt-BR')}\n`
                  + `📧 ${email || '—'}\n`
                  + `📱 ${wpp || '—'}\n`
                  + `🏷️ Evento: ${evento}\n\n`
                  + `💤 Máquina rodando!`;
    await zapiEnviar(dono, msgDono);
  }

  return resultado;
}

// ── Z-API Helper ────────────────────────────────────────────
async function zapiEnviar(numero, mensagem) {
  const inst  = process.env.ZAPI_INSTANCE;
  const token = process.env.ZAPI_TOKEN;
  const client= process.env.ZAPI_CLIENT_TOKEN;

  if (!inst || !token || !client) {
    console.warn('[Z-API] Credenciais não configuradas');
    return false;
  }

  const num = numero.replace(/\D/g, '');
  if (!num || num.length < 10) {
    console.warn('[Z-API] Número inválido:', numero);
    return false;
  }

  try {
    const r = await fetch(
      `https://api.z-api.io/instances/${inst}/token/${token}/send-text`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Client-Token': client },
        body: JSON.stringify({ phone: num, message: mensagem })
      }
    );
    const body = await r.text();
    console.log(`[Z-API] ${num}: ${r.status} — ${body.slice(0, 100)}`);
    return r.ok;
  } catch (e) {
    console.error('[Z-API] Erro:', e.message);
    return false;
  }
}

// ── Supabase Helper ─────────────────────────────────────────
async function supabaseInsert(tabela, dados) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.warn('[SUPABASE] Não configurado');
    return null;
  }

  const r = await fetch(`${url}/rest/v1/${tabela}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(dados)
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Supabase ${r.status}: ${err.slice(0, 200)}`);
  }

  return true;
}
