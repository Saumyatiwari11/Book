const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');

app.use(cors());
app.use(express.json());

// Helper: read/write DB
function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ==================== AUTH ====================
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const { password: _, ...safeUser } = user;
  res.json({ user: safeUser, token: 'demo-token-' + user.id });
});

app.get('/api/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const userId = token.replace('demo-token-', '');
  const db = readDB();
  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { password: _, ...safeUser } = user;
  res.json(safeUser);
});

// ==================== DASHBOARD STATS ====================
app.get('/api/stats', (req, res) => {
  const db = readDB();
  res.json({
    totalShops: db.shops.length,
    totalBooks: db.books.length,
    totalOrders: db.orders.length,
    totalUsers: db.users.length,
    pendingOrders: db.orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled').length,
    lowStock: db.inventory.filter(i => i.quantity <= i.minStock).length,
    totalRevenue: db.orders.reduce((sum, o) => sum + o.total, 0),
    activeDeliveries: db.deliveries.filter(d => d.status !== 'delivered').length
  });
});

// ==================== BOOKS ====================
app.get('/api/books', (req, res) => {
  const db = readDB();
  res.json(db.books);
});

app.post('/api/books', (req, res) => {
  const db = readDB();
  const book = { id: 'b' + uuidv4().slice(0, 8), ...req.body };
  db.books.push(book);
  writeDB(db);
  res.status(201).json(book);
});

app.put('/api/books/:id', (req, res) => {
  const db = readDB();
  const idx = db.books.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.books[idx] = { ...db.books[idx], ...req.body };
  writeDB(db);
  res.json(db.books[idx]);
});

app.delete('/api/books/:id', (req, res) => {
  const db = readDB();
  db.books = db.books.filter(b => b.id !== req.params.id);
  writeDB(db);
  res.json({ success: true });
});

// ==================== SHOPS ====================
app.get('/api/shops', (req, res) => {
  const db = readDB();
  res.json(db.shops);
});

app.post('/api/shops', (req, res) => {
  const db = readDB();
  const shop = { id: 's' + uuidv4().slice(0, 8), status: 'active', ...req.body };
  db.shops.push(shop);
  writeDB(db);
  res.status(201).json(shop);
});

// ==================== INVENTORY ====================
app.get('/api/inventory', (req, res) => {
  const db = readDB();
  const enriched = db.inventory.map(inv => {
    const book = db.books.find(b => b.id === inv.bookId);
    const shop = db.shops.find(s => s.id === inv.shopId);
    return { ...inv, book, shop };
  });
  res.json(enriched);
});

app.put('/api/inventory', (req, res) => {
  const { shopId, bookId, quantity } = req.body;
  const db = readDB();
  const inv = db.inventory.find(i => i.shopId === shopId && i.bookId === bookId);
  if (inv) {
    inv.quantity = quantity;
  } else {
    db.inventory.push({ shopId, bookId, quantity, minStock: 5 });
  }
  writeDB(db);
  res.json({ success: true });
});

// ==================== ORDERS ====================
app.get('/api/orders', (req, res) => {
  const db = readDB();
  const enriched = db.orders.map(o => {
    const customer = db.users.find(u => u.id === o.customerId);
    const shop = db.shops.find(s => s.id === o.shopId);
    const items = o.items.map(it => ({
      ...it,
      book: db.books.find(b => b.id === it.bookId)
    }));
    return { ...o, customer, shop, items };
  });
  res.json(enriched);
});

app.post('/api/orders', (req, res) => {
  const db = readDB();
  const order = {
    id: 'o' + uuidv4().slice(0, 8),
    status: 'confirmed',
    paymentStatus: 'paid',
    createdAt: new Date().toISOString(),
    deliveryId: null,
    ...req.body
  };
  // Reduce inventory
  order.items.forEach(it => {
    const inv = db.inventory.find(i => i.shopId === order.shopId && i.bookId === it.bookId);
    if (inv) inv.quantity = Math.max(0, inv.quantity - it.qty);
  });
  db.orders.push(order);
  writeDB(db);
  res.status(201).json(order);
});

app.patch('/api/orders/:id/status', (req, res) => {
  const db = readDB();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  order.status = req.body.status;
  writeDB(db);
  res.json(order);
});

// ==================== PURCHASE ORDERS ====================
app.get('/api/purchase-orders', (req, res) => {
  const db = readDB();
  const enriched = db.purchaseOrders.map(po => {
    const shop = db.shops.find(s => s.id === po.shopId);
    const distributor = db.users.find(u => u.id === po.distributorId);
    const items = po.items.map(it => ({
      ...it,
      book: db.books.find(b => b.id === it.bookId)
    }));
    return { ...po, shop, distributor, items };
  });
  res.json(enriched);
});

app.post('/api/purchase-orders', (req, res) => {
  const db = readDB();
  const po = {
    id: 'po' + uuidv4().slice(0, 8),
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...req.body
  };
  db.purchaseOrders.push(po);
  writeDB(db);
  res.status(201).json(po);
});

app.patch('/api/purchase-orders/:id/status', (req, res) => {
  const db = readDB();
  const po = db.purchaseOrders.find(p => p.id === req.params.id);
  if (!po) return res.status(404).json({ error: 'Not found' });
  po.status = req.body.status;
  writeDB(db);
  res.json(po);
});

// ==================== DELIVERIES ====================
app.get('/api/deliveries', (req, res) => {
  const db = readDB();
  const enriched = db.deliveries.map(d => {
    const order = db.orders.find(o => o.id === d.orderId);
    const partner = db.users.find(u => u.id === d.partnerId);
    return { ...d, order, partner };
  });
  res.json(enriched);
});

app.patch('/api/deliveries/:id/status', (req, res) => {
  const db = readDB();
  const del = db.deliveries.find(d => d.id === req.params.id);
  if (!del) return res.status(404).json({ error: 'Not found' });
  del.status = req.body.status;
  if (req.body.status === 'delivered') {
    del.deliveredAt = new Date().toISOString();
    const order = db.orders.find(o => o.id === del.orderId);
    if (order) order.status = 'delivered';
  }
  writeDB(db);
  res.json(del);
});

// ==================== DISTRIBUTORS ====================
app.get('/api/distributors', (req, res) => {
  const db = readDB();
  const dists = db.users.filter(u => u.role === 'distributor');
  res.json(dists.map(({ password, ...u }) => u));
});

app.get('/api/distributor-inventory', (req, res) => {
  const db = readDB();
  const enriched = db.distributorInventory.map(inv => ({
    ...inv,
    book: db.books.find(b => b.id === inv.bookId)
  }));
  res.json(enriched);
});

// ==================== USERS ====================
app.get('/api/users', (req, res) => {
  const db = readDB();
  res.json(db.users.map(({ password, ...u }) => u));
});

// Fallback
app.get('/', (req, res) => {
  res.json({ message: 'BookFlow API is running', version: '1.0.0' });
});

app.listen(PORT, () => {
  console.log(`📚 BookFlow API running at http://localhost:${PORT}`);
});
