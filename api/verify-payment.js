import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, shippingDetails, payMethod, quantity } = req.body;
    const rzpSecret = process.env.RAZORPAY_KEY_SECRET;
    const nimbusApiKey = process.env.NIMBUSPOST_API_KEY;

    // Validate Signature mathematically using standard SHA-256
    const expectedSignature = crypto
        .createHmac('sha256', rzpSecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

    if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({ success: false, error: "Payment verification failed." });
    }

    try {
        // Generate fallback tracking AWB
        let generatedAWB = `NMB-${Math.floor(100000 + Math.random() * 900000)}`;

        // REAL NimbusPost Order Creation (If API Key is set in Vercel env)
        if (nimbusApiKey) {
            try {
                const nimbusResponse = await fetch("https://api.nimbuspost.com/v1/shipments", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${nimbusApiKey}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        "order_number": razorpay_order_id,
                        "consignee_name": shippingDetails.name,
                        "consignee_phone": shippingDetails.phone,
                        "consignee_address": shippingDetails.address,
                        "payment_type": payMethod === "full" ? "prepaid" : "cod",
                        "package_weight": 0.1 * quantity, // 100g per pack
                        "declared_value": quantity * 99,
                        "items": [{
                            "name": "VEDYAM Daily Health Mix (100g)",
                            "qty": quantity,
                            "price": 99
                        }]
                    })
                });
                const nimbusData = await nimbusResponse.json();
                if (nimbusData && nimbusData.success && nimbusData.data) {
                    generatedAWB = nimbusData.data.awb_number || generatedAWB;
                }
            } catch (nimbusErr) {
                console.error("NimbusPost API connection error:", nimbusErr);
            }
        }

        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
        
        if (supabaseUrl && supabaseAnonKey) {
            const supabase = createClient(supabaseUrl, supabaseAnonKey);
            
            // Mark the order as paid in database
            await supabase
                .from('orders')
                .update({ 
                    status: 'paid', 
                    razorpay_payment_id: razorpay_payment_id,
                    awb: generatedAWB 
                })
                .eq('id', razorpay_order_id);
        }

        return res.status(200).json({
            success: true,
            orderId: razorpay_order_id,
            awb: generatedAWB
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
