'use strict';
const router  = require('express').Router();
const db      = require('../lib/db');
const auth    = require('../middleware/auth');
const tokopay = require('../lib/tokopay');
const digi    = require('../lib/digiflazz');
const fonnte  = require('../lib/fonnte');
const { v4: uuidv4 } = require('uuid');

const fmt = n => 'Rp '+Math.round(n||0).toLocaleString('id-ID');

function genOrderId() {
  const d=new Date();
  return 'TXN'+d.getFullYear().toString().slice(2)+
    String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+
    String(d.getHours()).padStart(2,'0')+String(d.getMinutes()).padStart(2,'0')+
    String(Math.floor(Math.random()*9000)+1000);
}

// Public: buat order
router.post('/', async (req,res) => {
  try {
    const { game_code, package_id, customer_no, zone_id, customer_name, customer_wa, payment_method } = req.body;
    if (!game_code||!package_id||!customer_no||!payment_method)
      return res.status(400).json({success:false,message:'Data tidak lengkap'});

    const [[game]] = await db.query('SELECT * FROM games WHERE code=? AND is_active=1',[game_code]);
    if (!game) return res.status(404).json({success:false,message:'Game tidak ditemukan'});

    const [[pkg]] = await db.query('SELECT * FROM packages WHERE id=? AND is_active=1',[package_id]);
    if (!pkg) return res.status(404).json({success:false,message:'Paket tidak ditemukan'});

    const [[cfgRows]] = await db.query("SELECT value FROM settings WHERE key_name='tokopay_base_url'");
    const siteUrl = process.env.SITE_URL || `https://${req.hostname}`;

    const orderId = genOrderId();
    const fee = 0; // bisa tambah fee per metode
    const total = pkg.sell_price + fee;
    const expiredAt = new Date(Date.now() + 60*60*1000);

    // Buat invoice Tokopay
    let payUrl='', payCode='', payQr='';
    try {
      const inv = await tokopay.createInvoice({
        orderId, amount: total, method: payment_method,
        customerName: customer_name||'Pelanggan',
        callbackUrl: `${siteUrl}/api/webhook/tokopay`,
        returnUrl: `${siteUrl}/cek-order?id=${orderId}`
      });
      if (inv.status==='Success'||inv.data) {
        const d = inv.data||inv;
        payUrl  = d.pay_url||d.checkout_url||'';
        payCode = d.pay_code||d.nomor_va||'';
        payQr   = d.qr_string||d.qr_url||'';
      }
    } catch(e) { console.error('[Order] Tokopay error:', e.message); }

    await db.query(`INSERT INTO orders (order_id,game_id,game_code,game_name,package_id,package_name,sku,
      customer_no,zone_id,customer_name,customer_wa,sell_price,fee,total,payment_method,pay_url,pay_code,pay_qr,expired_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [orderId,game.id,game.code,game.name,pkg.id,pkg.name,pkg.sku,
       customer_no,zone_id||'',customer_name||'',customer_wa||'',
       pkg.sell_price,fee,total,payment_method,payUrl,payCode,payQr,expiredAt]);

    // Notif WA admin
    const [[notifAdmin]] = await db.query("SELECT value FROM settings WHERE key_name='wa_notif_admin'");
    if (notifAdmin?.value==='1') {
      const order = {order_id:orderId,game_name:game.name,package_name:pkg.name,customer_no,zone_id,total,payment_method,customer_wa};
      fonnte.notifyAdmin(fonnte.orderCreatedAdmin(order)).catch(()=>{});
    }

    res.json({success:true,order_id:orderId,pay_url:payUrl,pay_code:payCode,pay_qr:payQr,total,expired_at:expiredAt});
  } catch(e){console.error(e);res.status(500).json({success:false,message:e.message});}
});

// Public: cek status order
router.get('/:orderId', async (req,res) => {
  try {
    const [[order]] = await db.query('SELECT * FROM orders WHERE order_id=?',[req.params.orderId]);
    if (!order) return res.status(404).json({success:false,message:'Order tidak ditemukan'});
    res.json({success:true,order});
  } catch(e){res.status(500).json({success:false});}
});

// Admin: list orders
router.get('/admin/list', auth, async (req,res) => {
  try {
    const {page=1,limit=20,search='',status='',payment_status=''} = req.query;
    const off = (page-1)*limit;
    let where='WHERE 1=1'; const params=[];
    if (search) { where+=' AND (o.order_id LIKE ? OR o.customer_no LIKE ? OR o.game_name LIKE ?)'; params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
    if (status) { where+=` AND o.topup_status=?`; params.push(status); }
    if (payment_status) { where+=` AND o.payment_status=?`; params.push(payment_status); }
    const [[{total}]] = await db.query(`SELECT COUNT(*) as total FROM orders o ${where}`,params);
    const [orders] = await db.query(`SELECT * FROM orders o ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,[...params,parseInt(limit),parseInt(off)]);
    res.json({success:true,orders,total,page:parseInt(page),limit:parseInt(limit)});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});

// Admin: update status manual
router.put('/admin/:orderId/status', auth, async (req,res) => {
  try {
    const { topup_status, payment_status, sn } = req.body;
    await db.query('UPDATE orders SET topup_status=COALESCE(?,topup_status),payment_status=COALESCE(?,payment_status),sn=COALESCE(?,sn) WHERE order_id=?',
      [topup_status||null,payment_status||null,sn||null,req.params.orderId]);
    res.json({success:true,message:'Status diupdate'});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});

// Admin: proses ulang topup
router.post('/admin/:orderId/retry', auth, async (req,res) => {
  try {
    const [[order]] = await db.query('SELECT * FROM orders WHERE order_id=?',[req.params.orderId]);
    if (!order) return res.status(404).json({success:false,message:'Order tidak ditemukan'});
    const customerNo = order.zone_id ? `${order.customer_no}/${order.zone_id}` : order.customer_no;
    const result = await digi.topup(order.order_id, order.sku, customerNo);
    const status = result.status==='Sukses'?'success':result.status==='Gagal'?'failed':'processing';
    await db.query('UPDATE orders SET topup_status=?,sn=?,digiflazz_ref=?,completed_at=? WHERE order_id=?',
      [status,result.sn||null,result.trx_id||null,status==='success'?new Date():null,order.order_id]);
    res.json({success:true,result,status});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});

// Admin: statistik
router.get('/admin/stats/summary', auth, async (req,res) => {
  try {
    const [[today]] = await db.query("SELECT COUNT(*) as count,COALESCE(SUM(total),0) as revenue FROM orders WHERE DATE(created_at)=CURDATE() AND payment_status='paid'");
    const [[month]] = await db.query("SELECT COUNT(*) as count,COALESCE(SUM(total),0) as revenue FROM orders WHERE MONTH(created_at)=MONTH(NOW()) AND payment_status='paid'");
    const [[all]]   = await db.query("SELECT COUNT(*) as count,COALESCE(SUM(total),0) as revenue FROM orders WHERE payment_status='paid'");
    const [[pending]] = await db.query("SELECT COUNT(*) as count FROM orders WHERE payment_status='unpaid'");
    const [[failed]]  = await db.query("SELECT COUNT(*) as count FROM orders WHERE topup_status='failed'");
    const [chart]   = await db.query("SELECT DATE(created_at) as date,COUNT(*) as count,COALESCE(SUM(total),0) as revenue FROM orders WHERE payment_status='paid' AND created_at>=DATE_SUB(NOW(),INTERVAL 7 DAY) GROUP BY DATE(created_at) ORDER BY date");
    const [topGames]= await db.query("SELECT game_name,COUNT(*) as count,SUM(total) as revenue FROM orders WHERE payment_status='paid' GROUP BY game_name ORDER BY count DESC LIMIT 5");
    res.json({success:true,today,month,all,pending,failed,chart,topGames});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});

module.exports = router;
