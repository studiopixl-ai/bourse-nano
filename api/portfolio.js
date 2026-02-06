import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  const KEY = 'nano_portfolio_v2';

  if (req.method === 'GET') {
    const data = await redis.get(KEY) || { lines: [], accounts: { 'PEA': { initial: 150000 }, 'PME': { initial: 75000 }, 'CTO': { initial: 0 } } };
    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    const { action, payload, password } = req.body;
    if (password !== 'nano123') return res.status(401).json({ error: 'Mot de passe incorrect' });

    let data = await redis.get(KEY) || { lines: [], accounts: {} };

    if (action === 'update_line') {
      // Ajout du champ url
      const { id, symbol, quantity, pru, account, url } = payload;
      const uniqueId = id || `${symbol}_${account}`; 
      
      const index = data.lines.findIndex(l => (l.id === uniqueId) || (l.symbol === symbol && l.account === account));
      
      const newItem = { 
        id: uniqueId,
        symbol, 
        quantity: Number(quantity),
        pru: Number(pru) || 0,
        account,
        url: url || '' // Nouvelle propriété
      };

      if (index >= 0) data.lines[index] = newItem;
      else data.lines.push(newItem);
    }

    if (action === 'delete_line') {
      const { id } = payload;
      data.lines = data.lines.filter(l => l.id !== id);
    }

    if (action === 'update_account') {
      const { account, initial } = payload;
      if (!data.accounts[account]) data.accounts[account] = {};
      data.accounts[account].initial = Number(initial);
    }

    await redis.set(KEY, data);
    return res.status(200).json(data);
  }
}
