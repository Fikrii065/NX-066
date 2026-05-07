'use strict';
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const rateLimit  = require('express-rate-limit');
const migrate    = require('./lib/migrate');

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files - no cache untuk HTML
app.use(express.static(path.join(__dirname,'public'), {
  setHeaders(res, fp) {
    if (fp.endsWith('.html')) res.setHeader('Cache-Control','no-store');
  }
}));

// API no-cache
app.use('/api', (_,res,next)=>{ res.setHeader('Cache-Control','no-store,no-cache'); next(); });

// Rate limit
const limiter = rateLimit({ windowMs:60*1000, max:60 });
app.use('/api/orders', limiter);

// Routes
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/games',    require('./routes/games'));
app.use('/api/packages', require('./routes/packages'));
app.use('/api/orders',   require('./routes/orders'));
app.use('/api/banners',  require('./routes/banners'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/check-nickname', require('./routes/check_nickname'));
app.use('/api/webhook',          require('./routes/webhook'));
app.use('/api/check-nickname',   require('./routes/check_nickname'));

// SPA pages
const fs   = require('fs');
const pages = { '/':'/index.html', '/order':'/order.html', '/cek-order':'/cek-order.html', '/admin':'/admin.html', '/login':'/login.html' };
Object.entries(pages).forEach(([route,file])=>{
  app.get(route, (_,res)=>{
    const fp = path.join(__dirname,'public',file);
    if(fs.existsSync(fp)) return res.sendFile(fp);
    res.status(404).send('Halaman tidak ditemukan');
  });
});

app.use((err,_,res,__)=>{ console.error(err.message); res.status(500).json({success:false,message:err.message}); });

const PORT = process.env.PORT||3000;
migrate().then(()=>app.listen(PORT,()=>console.log(`[Server] Running on port ${PORT} ✅`))).catch(console.error);
