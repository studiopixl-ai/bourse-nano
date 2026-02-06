import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  const KEY = 'nano_portfolio';

  if (req.method === 'GET') {
    const portfolio = await redis.get(KEY) || [];
    return res.status(200).json(portfolio);
  }

  if (req.method === 'POST') {
    // Ajouter / Modifier (Avec PRU maintenant)
    const { symbol, quantity, pru, password } = req.body;
    
    if (password !== 'nano123') return res.status(401).json({ error: 'Mot de passe incorrect' });

    let portfolio = await redis.get(KEY) || [];
    
    const index = portfolio.findIndex(p => p.symbol === symbol);
    const newItem = { 
      symbol, 
      quantity: Number(quantity),
      pru: Number(pru) || 0 // Nouveau champ
    };

    if (index >= 0) {
      portfolio[index] = newItem;
    } else {
      portfolio.push(newItem);
    }

    await redis.set(KEY, portfolio);
    return res.status(200).json(portfolio);
  }

  if (req.method === 'DELETE') {
    const { symbol, password } = req.body;
    if (password !== 'nano123') return res.status(401).json({ error: 'Mot de passe incorrect' });

    let portfolio = await redis.get(KEY) || [];
    portfolio = portfolio.filter(p => p.symbol !== symbol);
    
    await redis.set(KEY, portfolio);
    return res.status(200).json(portfolio);
  }
}
