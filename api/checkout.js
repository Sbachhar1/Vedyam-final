import Razorpay from 'razorpay';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const rzpId = process.env.RAZORPAY_KEY_ID;
    const rzpSecret = process.env.RAZORPAY_KEY_SECRET;

    const { quantity, email, name, phone, address, payMethod } = req.body;

    const parsedQty = parseInt(quantity, 10) || 1;
    const productBaseTotal = parsedQty * 99; // strictly ₹99 per pack

    let onlineCharge = 0; 
    let codDueAmount = 0;

    if (payMethod === 'cod') {
        onlineCharge = 0;
        codDueAmount = productBaseTotal + 49; // Product + ₹49 Delivery
    } else if (payMethod === 'advance') {
        onlineCharge = 49;  // ₹49 Advance Pay Online
        codDueAmount = productBaseTotal - 49;  // Remaining balance on delivery
    } else {
        onlineCharge = productBaseTotal;  // Full online charge
        codDueAmount = 0;
    }

    try {
        let rzpOrderId = null;
        let rzpOrderAmount = onlineCharge * 100; // in paisa

        if (onlineCharge > 0) {
            const razorpay = new Razorpay({ key_id: rzpId, key_secret: rzpSecret });
            const rzpOrder = await razorpay.orders.create({
                amount: rzpOrderAmount,
                currency: 'INR',
                receipt: `receipt_${Date.now()}`
            });
            rzpOrderId = rzpOrder.id;
        }

        // Generate dynamic mock AWB for Cash on Delivery (COD) instantly
        let awb = payMethod === 'cod' ? `NMB-${Math.floor(100000 + Math.random() * 900000)}` : null;

        // Save order inside database (Supabase)
        if (supabaseUrl && supabaseAnonKey) {
            const supabase = createClient(supabaseUrl, supabaseAnonKey);
            await supabase.from('orders').insert([{
                id: rzpOrderId || `COD_${Date.now()}`,
                email,
                customer_name: name,
                phone,
                address,
                quantity: parsedQty,
                payment_method: payMethod,
                amount_paid_online: onlineCharge,
                amount_due_cod: codDueAmount,
                status: payMethod === 'cod' ? 'confirmed' : 'pending_payment',
                awb: awb
            }]);
        }

        return res.status(200).json({
            id: rzpOrderId,
            amount: rzpOrderAmount,
            razorpayKeyId: rzpId,
            awb: awb
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
