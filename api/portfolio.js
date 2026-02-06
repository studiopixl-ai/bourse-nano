import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  // Clé unique pour stocker ton portefeuille
  const KEY = 'nano_portfolio';

  if (req.method === 'GET') {
    // Récupérer le portefeuille
    const portfolio = await redis.get(KEY) || [];
    return res.status(200).json(portfolio);
  }

  if (req.method === 'POST') {
    // Ajouter / Modifier
    const { symbol, quantity, password } = req.body;
    
    // Sécurité basique
    if (password !== 'nano123') {
      return res.status(401).json({ error: 'Mot de passe incorrect' });
    }

    let portfolio = await redis.get(KEY) || [];
    
    // Vérifier si existe déjà
    const index = portfolio.findIndex(p => p.symbol === symbol);
    if (index >= 0) {
      portfolio[index].quantity = Number(quantity); // Mise à jour
    } else {
      portfolio.push({ symbol, quantity: Number(quantity) }); // Ajout
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
