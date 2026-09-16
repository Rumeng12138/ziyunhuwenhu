const db=require('../config/db');
const {releaseOrder}=require('./commerce');
// Only newly created, never-initiated payments can expire automatically.
// Legacy orders, displayed personal QR codes, unknown provider states and money
// already under review require the existing verified cancellation workflow.
const expireUnstarted=db.transaction((now=Date.now())=>{
  const orders=db.prepare(`SELECT id FROM orders WHERE status='pending' AND expires_at IS NOT NULL AND expires_at<=?
    AND payment_method IS NULL AND manual_receipt IS NULL AND COALESCE(payment_busy_until,0)<? LIMIT 100`).all(now,now);
  for(const order of orders)releaseOrder(order.id);
  return orders.length;
});
module.exports={expireUnstarted};
